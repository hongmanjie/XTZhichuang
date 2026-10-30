// ============================================================
// AI Providers 服务层：封装真实接口
//  - ModelGate：统一网关，实际费用以网关配置和账单为准
//    对话/向量/重排/语音转写/OCR/目标分割/文生图/音视频生成
//  - 第三方商业接口（万界/即梦/可灵/Qwen商用/SiliconFlow）已全部移除，避免计费
// 所有产物统一转存到本地 uploads，避免外链过期
// ============================================================
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import dotenv from 'dotenv'
import { FFMPEG, localMediaPath, probeImage, probeMedia, trimVideo } from './mediaTools.js'
import { validateH3Frames, validateH3Size } from './h3Spec.js'

// 关键：本模块被静态 import 时可能早于 index.js 的 dotenv.config()，
// 必须在读取任何 process.env 前先加载 .env（dotenv 不覆盖已存在变量，幂等安全）
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || './uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// ---------- ModelGate 统一网关 ----------
const MG_KEY = process.env.MODELGATE_API_KEY || ''
const MG_BASE = (process.env.MODELGATE_BASE || 'http://219.140.87.218:888/xt-platform/models/v1').replace(/\/$/, '')
const MG_ORIGIN = MG_BASE.replace(/\/xt-platform\/models\/v1$/, '')
const MG_CHAT_MODEL = process.env.MODELGATE_CHAT_MODEL || 'Qwen3.6-35B-A3B-FP8'
const MG_EMBED_MODEL = process.env.MODELGATE_EMBED_MODEL || 'qwen3-vl-embedding-2b'
const MG_RERANK_MODEL = process.env.MODELGATE_RERANK_MODEL || 'qwen3-vl-reranker-2b'
const MG_ASR_MODEL = process.env.MODELGATE_ASR_MODEL || 'FunASR-Nano'
const MG_OCR_MODEL = process.env.MODELGATE_OCR_MODEL || 'PPOCR-v5-Server'
const MG_SAM_MODEL = process.env.MODELGATE_SAM_MODEL || 'SAM3-Image'
const MG_IMAGE_MODEL = process.env.MODELGATE_IMAGE_MODEL || 'Qwen-Image-2.1-Turbo'
const MG_VIDEO_MODEL = process.env.MODELGATE_VIDEO_MODEL || 'MiniMax-H3'

export const mgEnabled = () => process.env.MODELGATE_ENABLED !== 'false' && !!MG_KEY
// 向量维度由 embedding 模型决定（ModelGate qwen3-vl-embedding-2b = 2048）
export const EMBED_DIMS = Number(process.env.EMBED_DIMS || 2048)

export const realEnabled = () => (process.env.AI_REAL_ENABLED || 'true') === 'true'

// An inexpensive read-only connection check before a new asynchronous submit.
// Any HTTP response counts as reachable; only network failure prevents submission.
async function requireModelGateConnection() {
  try {
    await fetch(MG_BASE, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000) })
  } catch (cause) {
    const error = new Error('模型网关暂时无法连接，任务未提交，请检查网络后重试')
    error.code = 'MG_CONNECTION_UNAVAILABLE'
    error.cause = cause
    throw error
  }
}

// ---------- 通用 HTTP ----------
async function httpJson(url, { method = 'POST', headers = {}, body, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { status: r.status, data }
  } finally {
    clearTimeout(t)
  }
}

// ---------- 媒体落盘 ----------
export function saveBase64ToUploads(b64, ext = 'jpg') {
  const name = `ai_${Date.now()}_${crypto.randomInt(1000, 9999)}.${ext}`
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(b64, 'base64'))
  return `/uploads/${name}`
}

// 读本地/远端图为 base64（供 ModelGate 图生图/多模态输入）
export async function imageToBase64(src) {
  if (src.startsWith('data:')) return src.split(',')[1]
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src)
    if (!r.ok) throw new Error(`读取图片失败 HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer()).toString('base64')
  }
  // 平台素材 URL（/api/files/... 或历史遗留 /api/material/files/...）→ 本地物理路径
  // 注意：必须放在 isAbsolute 之前，Windows 下以 / 开头的字符串会被视为盘符根目录绝对路径
  const m = src.match(/^\/api\/(?:material\/)?files\/(.+)$/)
  if (m) return fs.readFileSync(path.join(UPLOAD_DIR, m[1])).toString('base64')
  if (src.startsWith('/uploads/')) return fs.readFileSync(path.join(UPLOAD_DIR, src.slice('/uploads/'.length))).toString('base64')
  if (path.isAbsolute(src)) return fs.readFileSync(src).toString('base64')
  // 本地 uploads 路径（相对文件名）
  const p = path.join(UPLOAD_DIR, path.basename(src))
  return fs.readFileSync(p).toString('base64')
}

// ============================================================
// ModelGate 统一网关
// 统一入口 POST /infer，按 model 字段分流；异步模型 202 + 轮询
// ============================================================

function mgHeaders(idempotencyKey = crypto.randomUUID()) {
  return {
    Authorization: `Bearer ${MG_KEY}`,
    'Idempotency-Key': idempotencyKey,
  }
}

// 统一解析响应体：兼容 { status, result } 与裸 OpenAI 风格
function mgResult(data) {
  return data?.result ?? data
}

function mgErr(label, status, data) {
  return new Error(`${label} HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`)
}

// ---------- 1. Qwen3.6 对话（非流式） ----------
export async function mgChat(messages, { model = MG_CHAT_MODEL, temperature = 0.7, max_tokens = 2048, timeoutMs = 180000 } = {}) {
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body: { model, messages, max_tokens, temperature, stream: false, enable_thinking: false },
    timeoutMs,
  })
  if (status !== 200) throw mgErr('ModelGate对话失败', status, data)
  const content = (mgResult(data)?.choices?.[0]?.message?.content || '').trim()
  if (!content) throw new Error('ModelGate对话返回空内容')
  return content
}

// ---------- 2. Qwen3.6 对话（SSE 流式），yield { delta } / { reasoning } ----------
export async function* mgChatStream(messages, { model = MG_CHAT_MODEL, temperature = 0.7, max_tokens = 4096, signal } = {}) {
  const ctrl = new AbortController()
  const abort = () => ctrl.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const t = setTimeout(() => ctrl.abort(), 300000)
  let reader
  try {
    const r = await fetch(`${MG_BASE}/infer`, {
      method: 'POST',
      headers: { ...mgHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens, stream: true, enable_thinking: false }),
      signal: ctrl.signal,
    })
    if (!r.ok || !r.body) throw new Error(`ModelGate流式失败 HTTP ${r.status}`)
    reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const j = JSON.parse(payload)
          const d = j?.choices?.[0]?.delta || j?.result?.choices?.[0]?.delta || {}
          if (d.content) yield { delta: d.content }
          else if (d.reasoning_content) yield { reasoning: d.reasoning_content }
        } catch {}
      }
    }
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', abort)
    ctrl.abort()
    if (reader) { try { await reader.cancel() } catch {} }
  }
}

// ---------- 3. 文本向量（2048维） ----------
export async function mgEmbed(texts) {
  if (!Array.isArray(texts)) texts = [texts]
  if (texts.length > 64) texts = texts.slice(0, 64)
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body: { model: MG_EMBED_MODEL, input: texts, encoding_format: 'float' },
    timeoutMs: 60000,
  })
  const arr = mgResult(data)?.data
  if (status !== 200 || !Array.isArray(arr)) throw mgErr('ModelGate向量化失败', status, data)
  return arr.map((d) => d.embedding)
}

export async function mgEmbedQuery(text) {
  const [v] = await mgEmbed([text])
  return v
}

// ---------- 4. 文本重排 ----------
export async function mgRerank(query, documents, topN = 10) {
  if (documents.length > 100) documents = documents.slice(0, 100)
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body: { model: MG_RERANK_MODEL, query, documents, top_n: topN },
    timeoutMs: 60000,
  })
  const results = mgResult(data)?.results
  if (status !== 200 || !Array.isArray(results)) throw mgErr('ModelGate重排失败', status, data)
  return results.map((x) => ({ index: x.index, score: x.relevance_score ?? x.score }))
}

// ---------- 通用输入转 base64（本地uploads/HTTP/dataURL/裸base64） ----------
async function toB64(src) {
  if (/^data:/.test(src)) return src.split(',')[1]
  if (/^https?:\/\//.test(src)) return imageToBase64(src)
  if (/\.(png|jpe?g|webp|bmp|gif|wav|mp3|flac|m4a|ogg|webm)$/i.test(src)) return imageToBase64(src)
  return src // 视为裸 base64
}

// 输入图统一压缩转 JPEG base64（视频生成提交用）
// 原因：网关对原始请求体积有限制，大 PNG（>5MB）会被拒；JPEG 重编码可缩至数百KB
export async function imageToJpegB64(src, { q = 4 } = {}) {
  const input = localMediaPath(src)
  if (!input || !fs.existsSync(input)) throw new Error('帧图片不存在或不是本地素材')
  const tmp = path.join(os.tmpdir(), `i2vjpg_${Date.now()}_${Math.round(Math.random() * 1e6)}.jpg`)
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-y', '-i', input, '-q:v', String(q), '-frames:v', '1', tmp], { windowsHide: true, timeout: 30000 }, (e) => {
      if (e) return reject(new Error(`首帧JPEG压缩失败: ${e.message}`))
      resolve()
    })
  })
  try {
    const data = fs.readFileSync(tmp)
    if (data.length > 10 * 1024 * 1024) throw new Error('压缩后的帧图片超过 10 MB')
    return data.toString('base64')
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* 忽略清理失败 */ }
  }
}

// ---------- 5. FunASR 语音转写（≤600s / ≤24MiB） ----------
export async function mgASRDetails(audioSrc, { format } = {}) {
  const b64 = await toB64(audioSrc)
  let fmt = format
  if (!fmt) {
    const m = (String(audioSrc).split('?')[0].match(/\.(\w{2,5})$/) || [])[1]
    fmt = (m || 'wav').toLowerCase()
  }
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body: { model: MG_ASR_MODEL, audio_data: b64, audio_format: fmt },
    timeoutMs: 180000,
  })
  const r = mgResult(data)
  // 适配 FunASR 结构：{ prediction: { results: [{ text, start_time, end_time }] } }
  const segs = r?.prediction?.results
  let text
  if (Array.isArray(segs)) text = segs.map((s) => s?.text || '').join('').trim()
  else text = r?.text ?? r?.transcript
  if (status !== 200 || text === undefined) throw mgErr('ModelGate转写失败', status, data)
  return {
    text: String(text),
    segments: Array.isArray(segs) ? segs.map((segment) => ({ text: String(segment.text || ''), start: Number.isFinite(Number(segment.start_time)) ? Number(segment.start_time) : null, end: Number.isFinite(Number(segment.end_time)) ? Number(segment.end_time) : null })) : [],
  }
}

export async function mgASR(audioSrc, options = {}) {
  return (await mgASRDetails(audioSrc, options)).text
}

// ---------- 6. PPOCR 图片文字识别（≤16MiB），返回 { text, lines } ----------
export async function mgOCR(imageSrc) {
  const b64 = await toB64(imageSrc)
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body: { model: MG_OCR_MODEL, image: `data:image/png;base64,${b64}` },
    timeoutMs: 120000,
  })
  const lines = mgResult(data)?.lines
  if (status !== 200 || !Array.isArray(lines)) throw mgErr('ModelGate OCR失败', status, data)
  return { text: lines.map((l) => l.text).join('\n'), lines }
}

// ---------- 7. SAM3 目标分割，返回 masks[{conf,name,bbox}] ----------
export async function mgSAM(imageSrc, { text, boxes, points, conf = 0.4 } = {}) {
  const b64 = await toB64(imageSrc)
  const body = { model: MG_SAM_MODEL, image: `data:image/png;base64,${b64}`, mode: 'auto', conf }
  if (text) body.text = text
  if (boxes) body.boxes = boxes
  if (points) body.points = points
  const { status, data } = await httpJson(`${MG_BASE}/infer`, {
    headers: mgHeaders(),
    body,
    timeoutMs: 180000,
  })
  const masks = mgResult(data)?.masks
  if (status !== 200 || !Array.isArray(masks)) throw mgErr('ModelGate SAM失败', status, data)
  return masks
}

// ---------- 异步任务轮询（queued→submitting→running→saving→succeeded） ----------
export async function mgTaskWait(taskId, { maxPoll = 240, intervalMs = 5000, onProgress } = {}) {
  for (let i = 0; i < maxPoll; i++) {
    const initialDelay = process.env.MODELGATE_POLL_INITIAL_MS === undefined ? 4000 : Math.max(0, Number(process.env.MODELGATE_POLL_INITIAL_MS) || 0)
    await new Promise((r) => setTimeout(r, i === 0 ? initialDelay : intervalMs))
    let response
    try {
      response = await httpJson(`${MG_BASE}/tasks/${taskId}`, {
        method: 'GET', headers: mgHeaders(), timeoutMs: 30000,
      })
    } catch {
      // A lost poll does not mean the upstream job failed. Keep polling the same task.
      continue
    }
    const { status, data } = response
    if ([429, 500, 502, 503, 504].includes(status)) continue
    if (status !== 200) {
      const error = mgErr('ModelGate任务查询失败', status, data)
      error.code = 'MG_TASK_UNCERTAIN'
      error.taskId = taskId
      throw error
    }
    const t = mgResult(data)
    const st = t?.status
    if (onProgress) await onProgress(st)
    if (st === 'succeeded') {
      if (!t.resultUrl) {
        const error = new Error('上游显示已完成，但结果地址尚不可用；请稍后检查')
        error.code = 'MG_TASK_UNCERTAIN'; error.taskId = taskId; throw error
      }
      return t
    }
    if (st === 'failed' || st === 'cancelled') {
      const error = new Error(`ModelGate任务${st === 'cancelled' ? '已取消' : '失败'}: ${t?.error || t?.message || ''}`)
      error.code = st === 'cancelled' ? 'MG_TASK_CANCELLED' : 'MG_TASK_FAILED'
      error.taskId = taskId
      throw error
    }
    if (st === 'pending_reconciliation') {
      const error = new Error('上游任务结果待核对，请保留任务编号并稍后检查')
      error.code = 'MG_TASK_UNCERTAIN'
      error.taskId = taskId
      throw error
    }
  }
  const error = new Error('等待上游任务超时，任务可能仍在运行，请勿重复提交')
  error.code = 'MG_TASK_UNCERTAIN'
  error.taskId = taskId
  throw error
}

export async function mgCancelTask(taskId) {
  if (!taskId || typeof taskId !== 'string') throw new Error('上游任务编号无效')
  const { status, data } = await httpJson(`${MG_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE', headers: mgHeaders(), timeoutMs: 30000,
  })
  if (status !== 200 && status !== 202) throw mgErr('上游取消请求未确认', status, data)
  const task = mgResult(data)
  if (!task?.status) throw new Error('上游未返回取消状态，请稍后核对')
  return task
}

// 下载产物（resultUrl 支持相对路径；需带 Authorization）
export async function mgDownload(resultUrl, fallbackExt = 'png') {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 300000)
  try {
    const url = new URL(resultUrl, MG_ORIGIN)
    if (url.origin !== new URL(MG_BASE).origin) throw new Error('ModelGate 结果地址不属于已配置的网关')
    const r = await fetch(url, { headers: { Authorization: `Bearer ${MG_KEY}` }, redirect: 'error', signal: ctrl.signal })
    if (!r.ok) throw new Error(`ModelGate下载失败 HTTP ${r.status}`)
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('json') || ct.includes('text/html')) throw new Error('网关返回的不是媒体文件')
    const maxSize = fallbackExt === 'mp4' ? 512 * 1024 * 1024 : 32 * 1024 * 1024
    if (Number(r.headers.get('content-length') || 0) > maxSize) throw new Error('网关返回的媒体文件过大')
    let ext = fallbackExt
    const m = (url.pathname.match(/\.(\w{3,5})$/) || [])[1]
    if (m && ['mp4', 'png', 'jpg', 'jpeg', 'webp'].includes(m.toLowerCase())) ext = m.toLowerCase()
    else {
      if (ct.includes('mp4') || ct.includes('video')) ext = 'mp4'
      else if (ct.includes('png')) ext = 'png'
      else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg'
    }
    const name = `ai_${crypto.randomUUID()}.${ext}`
    const output = path.join(UPLOAD_DIR, name)
    let count = 0
    const limiter = new Transform({ transform(chunk, encoding, callback) {
      count += chunk.length
      callback(count > maxSize ? new Error('网关返回的媒体文件过大') : null, chunk)
    } })
    try { await pipeline(Readable.fromWeb(r.body), limiter, fs.createWriteStream(output, { flags: 'wx' })) }
    catch (error) { try { fs.unlinkSync(output) } catch {}; throw error }
    return `/uploads/${name}`
  } finally {
    clearTimeout(t)
  }
}

// ---------- 8a. Qwen-Image 文生图（202 异步任务，约1~5分钟） ----------
export async function mgImageGen({ prompt, negative_prompt, size = [1024, 1024], seed, model = MG_IMAGE_MODEL, idempotencyKey, resumeTaskId, onSubmitted, onProgress } = {}) {
  const body = { model, task: 't2i', prompt, size }
  if (negative_prompt) body.negative_prompt = negative_prompt
  if (seed !== undefined) body.seed = seed
  let taskId = resumeTaskId
  if (!taskId) {
    await requireModelGateConnection()
    let response
    try { response = await httpJson(`${MG_BASE}/infer`, { headers: mgHeaders(idempotencyKey), body, timeoutMs: 60000 }) }
    catch (cause) {
      const error = new Error('图片提交的结果未知，请勿重复提交')
      error.code = 'MG_SUBMIT_UNCERTAIN'; error.cause = cause; throw error
    }
    const { status, data } = response
    if (status !== 202 && status !== 200) {
      const error = mgErr('ModelGate图像提交失败', status, data)
      if (status >= 500 || status === 408 || status === 409) error.code = 'MG_SUBMIT_UNCERTAIN'
      throw error
    }
    taskId = mgResult(data)?.task_id
    if (!taskId) {
      const error = new Error('提交已响应，但没有返回任务编号，需人工核对')
      error.code = 'MG_SUBMIT_UNCERTAIN'; throw error
    }
    if (onSubmitted) {
      try { await onSubmitted(taskId) } catch (cause) {
        const error = new Error('任务已提交，但本地记录失败；请核对上游任务')
        error.code = 'MG_TASK_UNCERTAIN'; error.taskId = taskId; error.cause = cause; throw error
      }
    }
  }
  const done = await mgTaskWait(taskId, { maxPoll: 240, intervalMs: 5000, onProgress })
  try {
    const local = await mgDownload(done.resultUrl, 'png')
    await probeImage(localMediaPath(local))
    return { provider: 'modelgate', model, task_id: taskId, images: [local] }
  } catch (cause) {
    const error = new Error('上游已完成，但图片下载失败；可重新检查结果')
    error.code = 'MG_TASK_UNCERTAIN'; error.taskId = taskId; error.cause = cause; throw error
  }
}

// ---------- 8b. MiniMax-H3 音视频生成（202 异步任务，约5~25分钟） ----------
// MiniMax-H3 要求三段式 JSON prompt（集成描述/环境声/配乐）
export function buildMiniMaxPrompt(prompt, { soundscape = '', music = '' } = {}) {
  return JSON.stringify({
    integrated_multimodal_description: prompt,
    overall_soundscape: soundscape || '与画面内容匹配的真实环境音，自然克制，突出主体动作声',
    non_diegetic_music: music || '轻快现代的电商风格背景音乐，节奏与画面剪辑点匹配，音量不抢主体',
  })
}

export async function mgVideoGen({ prompt, soundscape, music, task = 't2av', size = [896, 512], num_frames = 124, fps = 24, imageSrc, lastFrameSrc, model = MG_VIDEO_MODEL, targetDuration, idempotencyKey, resumeTaskId, onSubmitted, onProgress } = {}) {
  const frames = validateH3Frames(num_frames)
  const validatedSize = validateH3Size(size)
  if (fps !== 24) throw new Error('当前视频模型仅支持 24 帧/秒')
  const expected = { t2av: [false, false], i2av: [true, false], l2av: [false, true], fl2av: [true, true] }[task]
  if (!expected || expected[0] !== !!imageSrc || expected[1] !== !!lastFrameSrc) throw new Error('首尾帧与视频生成模式不匹配')
  const body = { model, task, prompt: buildMiniMaxPrompt(prompt, { soundscape, music }), size: validatedSize, num_frames: frames, fps }
  if (!resumeTaskId && imageSrc) body.image_path = await toB64(imageSrc)
  if (!resumeTaskId && lastFrameSrc) body.last_frame_path = await toB64(lastFrameSrc)
  let taskId = resumeTaskId
  if (!taskId) {
    await requireModelGateConnection()
    let response
    try {
      response = await httpJson(`${MG_BASE}/infer`, { headers: mgHeaders(idempotencyKey), body, timeoutMs: 60000 })
    } catch (cause) {
      const error = new Error('提交请求的结果未知，请勿重复提交')
      error.code = 'MG_SUBMIT_UNCERTAIN'
      error.cause = cause
      throw error
    }
    const { status, data } = response
    if (status !== 202 && status !== 200) {
      const error = mgErr('ModelGate视频提交失败', status, data)
      if (status >= 500 || status === 408 || status === 409) error.code = 'MG_SUBMIT_UNCERTAIN'
      throw error
    }
    taskId = mgResult(data)?.task_id
    if (!taskId) {
      const error = new Error('提交已响应，但没有返回任务编号，需人工核对')
      error.code = 'MG_SUBMIT_UNCERTAIN'
      throw error
    }
    if (onSubmitted) {
      try { await onSubmitted(taskId) } catch (cause) {
        const error = new Error('任务已提交，但本地记录失败；请核对上游任务')
        error.code = 'MG_TASK_UNCERTAIN'; error.taskId = taskId; error.cause = cause; throw error
      }
    }
  }
  const done = await mgTaskWait(taskId, { maxPoll: 300, intervalMs: 5000, onProgress })
  try {
    const local = await mgDownload(done.resultUrl, 'mp4')
    const file = localMediaPath(local)
    const info = targetDuration ? await trimVideo(local, targetDuration, { preserveEnd: !!lastFrameSrc }) : { url: local, ...await probeMedia(file) }
    if (info.url !== local) {
      // The freshly downloaded intermediate is no longer needed once the trimmed output is verified.
      try { fs.unlinkSync(file) } catch {}
    }
    return { provider: 'modelgate', model, task_id: taskId, videos: [{ url: info.url, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio }] }
  } catch (cause) {
    const error = new Error('上游已完成，但结果下载或处理失败；可重新检查结果')
    error.code = 'MG_TASK_UNCERTAIN'
    error.taskId = taskId
    error.cause = cause
    throw error
  }
}

// ---------- 统一入口：仅走 ModelGate，失败直接抛错 ----------
function mgRequired() {
  if (!mgEnabled()) throw new Error('ModelGate 未启用或未配置 API Key')
}

export async function embedTexts(texts) {
  mgRequired()
  return mgEmbed(texts)
}

export async function embedQuery(text) {
  mgRequired()
  return mgEmbedQuery(text)
}

export async function rerankDocs(query, documents, topN) {
  mgRequired()
  return mgRerank(query, documents, topN)
}

export async function chat(messages, opts = {}) {
  mgRequired()
  return mgChat(messages, opts)
}

export async function* chatStream(messages, opts = {}) {
  mgRequired()
  yield* mgChatStream(messages, opts)
}

// ---------- 模型清单（前端展示用） ----------
export const MODEL_CATALOG = {
  chat: [
    { key: MG_CHAT_MODEL, name: 'Qwen3.6 35B (ModelGate)', provider: 'modelgate' },
  ],
  image: [
    { key: MG_IMAGE_MODEL, name: 'Qwen图像Turbo (ModelGate)', provider: 'modelgate' },
  ],
  video: [
    { key: MG_VIDEO_MODEL, name: 'MiniMax H3 音视频 (ModelGate)', provider: 'modelgate' },
  ],
  embed: [
    { key: MG_EMBED_MODEL, name: 'Qwen3 VL 向量 (ModelGate)', provider: 'modelgate' },
  ],
  rerank: [
    { key: MG_RERANK_MODEL, name: 'Qwen3 VL 重排 (ModelGate)', provider: 'modelgate' },
  ],
  tools: [
    { key: MG_ASR_MODEL, name: 'FunASR 语音转写 (ModelGate)', provider: 'modelgate' },
    { key: MG_OCR_MODEL, name: 'PPOCR 图文识别 (ModelGate)', provider: 'modelgate' },
    { key: MG_SAM_MODEL, name: 'SAM3 目标分割 (ModelGate)', provider: 'modelgate' },
  ],
}
