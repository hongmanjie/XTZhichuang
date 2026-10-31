import crypto from 'node:crypto'
import net from 'node:net'

function pack(args) {
  const buffers = [Buffer.from(`*${args.length}\r\n`)]
  for (const arg of args) {
    const data = Buffer.from(String(arg))
    buffers.push(Buffer.from(`$${data.length}\r\n`), data, Buffer.from('\r\n'))
  }
  return Buffer.concat(buffers)
}

function parse(buffer, offset) {
  if (offset >= buffer.length) return null
  const end = buffer.indexOf('\r\n', offset)
  if (end < 0) return null
  const kind = String.fromCharCode(buffer[offset])
  const line = buffer.subarray(offset + 1, end).toString()
  if (kind === '$') {
    const len = Number(line)
    if (len === -1) return { value: null, next: end + 2 }
    if (!Number.isInteger(len) || len < 0 || len > 65536) throw new Error('协调服务响应无效')
    const next = end + 2 + len + 2
    if (buffer.length < next) return null
    return { value: buffer.subarray(end + 2, end + 2 + len).toString(), next }
  }
  if (kind === '-') throw new Error('协调服务拒绝请求')
  if (kind === '+') return { value: line, next: end + 2 }
  if (kind === ':') return { value: Number(line), next: end + 2 }
  throw new Error('协调服务响应无效')
}

async function command(url, args) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'redis:') throw new Error('H3 协调服务地址无效')
  const cmds = []
  if (endpoint.password) {
    const password = decodeURIComponent(endpoint.password)
    const username = decodeURIComponent(endpoint.username || '')
    cmds.push(username ? ['AUTH', username, password] : ['AUTH', password])
  }
  const database = endpoint.pathname.replace(/^\//, '')
  if (database && database !== '0') cmds.push(['SELECT', database])
  cmds.push(args)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.hostname, port: Number(endpoint.port) || 6379 })
    let buffer = Buffer.alloc(0), offset = 0, replies = 0, last
    const fail = () => { socket.destroy(); reject(new Error('H3 排队协调服务不可用')) }
    socket.setTimeout(5000, fail)
    socket.on('error', fail)
    socket.on('connect', () => socket.write(Buffer.concat(cmds.map(pack))))
    socket.on('data', (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk])
        while (replies < cmds.length) {
          const result = parse(buffer, offset)
          if (!result) return
          offset = result.next; last = result.value; replies++
        }
        socket.end()
        resolve(last)
      } catch { fail() }
    })
  })
}

const RENEW = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end"
const RELEASE = "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"

// Optional shared lease for app processes connected to the same private Redis.
// Unknown submissions deliberately retain their lease until expiry.
export async function withSharedH3Lock(run, { idempotencyKey, onWait } = {}) {
  const url = process.env.H3_LOCK_URL
  if (!url) return run()
  const key = process.env.H3_LOCK_KEY || 'xtzc:h3:generation'
  const token = idempotencyKey || crypto.randomUUID()
  const lease = Math.max(600000, Math.min(7200000, Number(process.env.H3_LOCK_LEASE_MS) || 1800000))
  let acquired = false
  while (!acquired) {
    const set = await command(url, ['SET', key, token, 'NX', 'PX', lease])
    if (set === 'OK') acquired = true
    else if ((await command(url, ['GET', key])) === token) {
      acquired = (await command(url, ['EVAL', RENEW, 1, key, token, lease])) === 1
    }
    if (!acquired) {
      onWait?.()
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  const timer = setInterval(() => {
    command(url, ['EVAL', RENEW, 1, key, token, lease]).catch(() => {})
  }, Math.min(60000, Math.floor(lease / 4)))
  timer.unref()
  let uncertain = false
  try { return await run() }
  catch (error) {
    uncertain = ['MG_TASK_UNCERTAIN', 'MG_SUBMIT_UNCERTAIN'].includes(error?.code)
    throw error
  } finally {
    clearInterval(timer)
    if (!uncertain) {
      try { await command(url, ['EVAL', RELEASE, 1, key, token]) } catch { /* lease will expire */ }
    }
  }
}
