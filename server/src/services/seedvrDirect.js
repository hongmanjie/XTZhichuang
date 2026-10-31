import crypto from 'node:crypto'
import fs, { openAsBlob } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MEDIA_UPLOAD_DIR, localMediaPath } from './mediaTools.js'

const PREFIX = 'seedvr-direct:'
const MAX_RESULT_BYTES = 512 * 1024 * 1024

export function isSeedVRDirectId(id) { return typeof id === 'string' && id.startsWith(PREFIX) }
function modelUrl(resource) {
  const base = new URL(process.env.SEEDVR_DIRECT_BASE_URL || '')
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('超分模型服务地址无效')
  return base.toString().replace(/\/+$/, '') + resource
}
function uncertain(message, taskId, code = 'MG_TASK_UNCERTAIN') {
  const error = new Error(message)
  error.code = code
  if (taskId) error.taskId = taskId
  return error
}
function safeJobId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('超分模型任务编号无效')
  return value
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The direct service accepts multipart video and a target bounding box. It does
// not support idempotent submission or cancellation, so only a known job id may
// be resumed. Never submit a replacement after an ambiguous network failure.
export async function seedvrDirect({ videoUrl, width, height, resumeTaskId, onSubmitted, onProgress } = {}) {
  const prefix = '/services/aigc/video-restoration'
  let jobId
  let providerId = resumeTaskId
  if (resumeTaskId) {
    if (!isSeedVRDirectId(resumeTaskId)) throw new Error('超分任务与配置的服务不匹配')
    jobId = safeJobId(resumeTaskId.slice(PREFIX.length))
  } else {
    const file = localMediaPath(videoUrl)
    if (!file || !fs.existsSync(file)) throw new Error('待增强视频不存在')
    try {
      const health = await fetch(modelUrl('/health'), { redirect: 'error', signal: AbortSignal.timeout(4000) })
      const status = await health.json()
      if (!health.ok || status.model_loaded !== true) throw new Error('模型未就绪')
    } catch (cause) {
      const error = new Error('超分模型服务暂不可用，任务尚未提交')
      error.code = 'MG_CONNECTION_UNAVAILABLE'
      error.cause = cause
      throw error
    }
    const form = new FormData()
    form.append('file', await openAsBlob(file, { type: 'video/mp4' }), 'source.mp4')
    form.append('res_w', String(width))
    form.append('res_h', String(height))
    form.append('seed', '666')
    let response
    try {
      response = await fetch(modelUrl(prefix + '/generation'), { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(120000) })
    } catch (cause) {
      const error = uncertain('超分任务提交状态未知，请勿重复提交', null, 'MG_SUBMIT_UNCERTAIN')
      error.cause = cause
      throw error
    }
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json()).detail || '').slice(0, 200) } catch {}
      if (response.status >= 500 || [408, 409, 429].includes(response.status)) throw uncertain('超分服务未确认提交结果，请核对后重试', null, 'MG_SUBMIT_UNCERTAIN')
      const error = new Error('超分服务拒绝任务：' + (detail || 'HTTP ' + response.status))
      error.code = 'MG_TASK_FAILED'
      throw error
    }
    let payload
    try { payload = await response.json(); jobId = safeJobId(payload.job_id) }
    catch { throw uncertain('超分服务响应缺少有效任务编号，请勿重复提交', null, 'MG_SUBMIT_UNCERTAIN') }
    providerId = PREFIX + jobId
    try { await onSubmitted?.(providerId) }
    catch (cause) { const error = uncertain('超分已提交，但任务编号保存失败，请人工核对', providerId); error.cause = cause; throw error }
  }

  const waitMs = Math.min(7200000, Math.max(60000, Number(process.env.SEEDVR_DIRECT_WAIT_MS) || 5400000))
  const pollMs = Math.min(30000, Math.max(1000, Number(process.env.SEEDVR_DIRECT_POLL_MS) || 5000))
  const deadline = Date.now() + waitMs
  let complete = false
  while (Date.now() < deadline) {
    let response
    try { response = await fetch(modelUrl(prefix + '/jobs/' + encodeURIComponent(jobId)), { redirect: 'error', signal: AbortSignal.timeout(30000) }) }
    catch { await delay(pollMs); continue }
    if (response.status === 404) throw uncertain('超分服务已找不到该任务，不能自动重新提交，请人工核对', providerId)
    if ([429, 500, 502, 503, 504].includes(response.status)) { await delay(pollMs); continue }
    if (!response.ok) throw uncertain('超分任务状态查询失败：HTTP ' + response.status, providerId)
    let payload
    try { payload = await response.json() } catch { throw uncertain('超分任务状态响应无效，请稍后核对', providerId) }
    if (payload.job_id !== jobId) throw uncertain('超分任务状态与已保存编号不一致', providerId)
    await onProgress?.(payload.status === 'pending' ? 'queued' : payload.status)
    if (payload.status === 'failed') {
      const error = new Error('超分模型任务失败：' + String(payload.error || '未知原因').slice(0, 250))
      error.code = 'MG_TASK_FAILED'; error.taskId = providerId
      throw error
    }
    if (payload.status === 'succeeded') { complete = true; break }
    if (!['pending', 'running'].includes(payload.status)) throw uncertain('超分任务状态未知，请稍后核对', providerId)
    await delay(pollMs)
  }
  if (!complete) throw uncertain('等待超分模型超时，任务可能仍在运行，请勿重复提交', providerId)

  let output
  try {
    const response = await fetch(modelUrl(prefix + '/jobs/' + encodeURIComponent(jobId) + '/result'), { redirect: 'error', signal: AbortSignal.timeout(600000) })
    if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().startsWith('video/')) throw new Error('结果尚不可下载')
    if (Number(response.headers.get('content-length') || 0) > MAX_RESULT_BYTES) throw new Error('增强结果超过下载大小限制')
    const name = `ai_${crypto.randomUUID()}.mp4`
    output = path.join(MEDIA_UPLOAD_DIR, name)
    let total = 0
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      total += chunk.length
      callback(total > MAX_RESULT_BYTES ? new Error('增强结果超过下载大小限制') : null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(output, { mode: 0o600 }))
    if (!total) throw new Error('增强结果为空')
    return { provider: 'seedvr-direct', model: 'SeedVR2-3B', task_id: providerId, videoUrl: `/uploads/${name}` }
  } catch (cause) {
    if (output) { try { fs.unlinkSync(output) } catch {} }
    const error = uncertain('超分已完成，但结果下载失败，可稍后恢复查询', providerId)
    error.cause = cause
    throw error
  }
}
