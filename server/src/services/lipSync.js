import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Transform, Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { FFMPEG, probeMedia, runMedia } from './mediaTools.js'

const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const MAX_OUTPUT_BYTES = 150 * 1024 * 1024
export const LIPSYNC_MAX_SECONDS = 30

export function lipSyncProvider() {
  return (process.env.LIPSYNC_PROVIDER || 'disabled').trim().toLowerCase()
}

function directUrl(resource) {
  const base = process.env.LIPSYNC_DIRECT_BASE_URL || ''
  if (!base) throw new Error('口型同步服务地址尚未配置')
  const parsed = new URL(base)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('口型同步服务地址无效')
  return base.replace(/\/+$/, '') + resource
}

export async function lipSyncStatus() {
  const provider = lipSyncProvider()
  if (provider === 'disabled') return { available: false, reason: 'not_configured', provider }
  if (provider !== 'direct') return { available: false, reason: 'unsupported_provider', provider }
  try {
    const response = await fetch(directUrl('/healthz'), { redirect: 'error', signal: AbortSignal.timeout(3000) })
    const data = await response.json()
    return { available: response.ok && data.status === 'ok', reason: response.ok && data.status === 'ok' ? 'reachable' : 'unavailable', provider }
  } catch (error) {
    // The current service can block its health endpoint during an active inference.
    // A timeout is inconclusive; a refused connection remains definitively unavailable.
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return { available: null, reason: 'busy_or_unknown', provider }
    return { available: false, reason: 'unreachable', provider }
  }
}

export async function applyLipSync(videoPath, speechPath) {
  if (lipSyncProvider() !== 'direct') throw new Error('口型同步服务尚未配置')
  const video = await probeMedia(videoPath)
  const size = fs.statSync(videoPath).size
  if (!size || size > MAX_VIDEO_BYTES || video.duration > LIPSYNC_MAX_SECONDS) throw new Error('口型同步仅支持不超过 30 秒、100 MB 的视频')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtzc-lipsync-'))
  const padded = path.join(dir, 'speech.wav')
  const output = path.join(dir, 'result.mp4')
  try {
    // The service stops at the shorter input; pad clean TTS speech to preserve the full video.
    await runMedia(FFMPEG, ['-y', '-i', speechPath, '-af', 'apad,atrim=duration=' + (video.duration + 0.5), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', padded], 120000)
    const form = new FormData()
    form.append('video', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), 'video.mp4')
    form.append('audio', new Blob([fs.readFileSync(padded)], { type: 'audio/wav' }), 'speech.wav')
    // 默认 20 步 / 1.5 引导偏激进，脸小时容易糊和走形；调高步数、降低引导更稳
    form.append('steps', String(Number(process.env.LIPSYNC_STEPS) || 30))
    form.append('guidance_scale', String(Number(process.env.LIPSYNC_GUIDANCE) || 1.2))
    const timeout = Math.min(1800000, Math.max(120000, Number(process.env.LIPSYNC_TIMEOUT_MS) || 900000))
    let response
    try { response = await fetch(directUrl('/v1/lipsync'), { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(timeout) }) }
    catch (cause) {
      const error = new Error(cause.name === 'TimeoutError' ? '口型同步超时，服务可能仍在处理' : '口型同步服务连接中断，服务可能仍在处理')
      error.code = 'LIPSYNC_UNCERTAIN'; error.cause = cause; throw error
    }
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json()).detail || '').slice(0, 180) } catch {}
      const error = new Error('口型同步失败（HTTP ' + response.status + '）' + (detail ? '：' + detail : '，请检查人物是否清晰正面'))
      error.code = 'LIPSYNC_FAILED'
      throw error
    }
    if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('video/')) throw new Error('口型服务没有返回有效视频')
    if (Number(response.headers.get('content-length') || 0) > MAX_OUTPUT_BYTES || !response.body) throw new Error('口型同步结果过大或为空')
    let received = 0
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length
      callback(received > MAX_OUTPUT_BYTES ? new Error('口型同步结果过大') : null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(output, { mode: 0o600 }))
    const result = await probeMedia(output)
    // Some services extend the rendered video through the padded silence; the final
    // composition trims it back to the source duration. Short output is not safe.
    if (result.width !== video.width || result.height !== video.height || result.duration < video.duration - 0.3 || result.duration > video.duration + 1) {
      throw new Error('口型同步结果尺寸或时长不符合原视频')
    }
    return { path: output, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
