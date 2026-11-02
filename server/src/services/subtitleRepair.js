import fs from 'fs'
import os from 'os'
import path from 'path'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { mgOCR } from './aiProviders.js'
import { ocrWithTiling } from './ocrWithTiling.js'

// 画面文字修复：把视频以裸字节 POST 给 VSR 服务，拿回修复后的视频。
// 不依赖共享卷，服务放哪台机器都能用；未配置时整步跳过，不阻断出片。
const BASE = (process.env.SUBTITLE_REPAIR_BASE_URL || '').replace(/\/$/, '')
const TIMEOUT = Number(process.env.SUBTITLE_REPAIR_TIMEOUT_MS) || 900000
const BAND_TOP = Number(process.env.SUBTITLE_REPAIR_BAND_TOP) || 0.86
const MODE = process.env.SUBTITLE_REPAIR_MODE || 'sttn-det'
const MAX_BYTES = 200 * 1024 * 1024
// 只有“像字幕”的框才修：横向长条、够宽、不太高。
// 商品 logo、杯身徽标这类短方块必须排除，否则会被一起擦掉。
const MIN_ASPECT = 2.5
const MIN_WIDTH_RATIO = 0.22
const MAX_HEIGHT_RATIO = 0.1
const MAX_AREAS = 6

export function subtitleRepairStatus() {
  if (!BASE) return { available: false, reason: 'not_configured', provider: 'vsr' }
  return { available: true, reason: 'configured', provider: 'vsr', mode: MODE, bandTop: BAND_TOP }
}

function looksLikeSubtitle(bbox, frameWidth, frameHeight, scale) {
  const [x, y, w, h] = bbox.map(Number)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
  const aspect = w / h
  const widthRatio = w / (frameWidth * scale)
  const heightRatio = h / (frameHeight * scale)
  if (aspect < MIN_ASPECT || widthRatio < MIN_WIDTH_RATIO || heightRatio > MAX_HEIGHT_RATIO) return null
  return {
    left: x / (frameWidth * scale),
    width: widthRatio,
    top: y / (frameHeight * scale),
    height: heightRatio,
  }
}

// 只检查下半部分有没有“像字幕”的文字，并返回这些框的归一化区域。
// 之前用所有文字框的最小外接矩形当修复区域，商品上的徽标会把区域一路撑大，
// 结果连杯子上的字一起被重绘。
export async function bandTextDetected(videoUrl) {
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file)) return null
  let info
  try { info = await probeMedia(file) } catch { return null }
  if (!Number.isFinite(info.duration) || info.duration <= 0 || !info.width || !info.height) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'band-'))
  const cropTop = 0.5
  const scale = 2
  const areas = []
  let samples = 0
  try {
    const crop = `crop=iw:ih*${1 - cropTop}:0:ih*${cropTop},scale=iw*${scale}:-2`
    for (const ratio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const png = path.join(dir, `frame-${ratio}.png`)
      await runMedia(FFMPEG, ['-y', '-ss', String((info.duration * ratio).toFixed(3)), '-i', file,
        '-frames:v', '1', '-vf', crop, png], 60000)
      if (!fs.existsSync(png)) continue
      const result = await ocrWithTiling(png, mgOCR)
      samples++
      for (const line of result?.lines || []) {
        const text = String(line?.text || '').replace(/[\s\p{P}\p{S}]/gu, '')
        const length = Array.from(text).length
        const conf = Number.isFinite(Number(line?.conf)) ? Number(line.conf) : 1
        if (!((length >= 3 && conf >= 0.35) || (length === 2 && conf >= 0.5) || (length === 1 && conf >= 0.9))) continue
        if (!Array.isArray(line?.bbox) || line.bbox.length < 4) continue
        const box = looksLikeSubtitle(line.bbox, info.width, info.height, scale)
        if (!box) continue
        areas.push({
          top: Math.max(0, cropTop + box.top - 0.02),
          bottom: Math.min(1, cropTop + box.top + box.height + 0.02),
          left: Math.max(0, box.left - 0.01),
          right: Math.min(1, box.left + box.width + 0.01),
        })
      }
    }
    if (!samples) return null
    if (!areas.length) return { detected: false, samples }
    // 合并重复框，最多保留 6 个区域
    const merged = []
    for (const area of areas) {
      const hit = merged.find((item) => Math.abs(item.top - area.top) < 0.04 && Math.abs(item.left - area.left) < 0.06)
      if (hit) {
        hit.top = Math.min(hit.top, area.top)
        hit.bottom = Math.max(hit.bottom, area.bottom)
        hit.left = Math.min(hit.left, area.left)
        hit.right = Math.max(hit.right, area.right)
      } else merged.push({ ...area })
    }
    return { detected: true, samples, areas: merged.slice(0, MAX_AREAS) }
  } catch {
    return null
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

export async function repairSubtitleBand(videoUrl, { onStage, areas = null, bandTop, bandBottom } = {}) {
  if (!BASE) return { applied: false, reason: 'not_configured', url: videoUrl }
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file)) throw new Error('待修复的视频文件不存在')
  const size = fs.statSync(file).size
  if (!size || size > MAX_BYTES) throw new Error('视频超过修复服务的大小限制')

  const params = new URLSearchParams({ mode: MODE })
  if (Array.isArray(areas) && areas.length) {
    params.set('areas', areas.map((a) => [a.top, a.bottom, a.left, a.right].map((v) => Number(v).toFixed(4)).join(',')).join(';'))
  } else {
    params.set('bandTop', String(bandTop ?? BAND_TOP))
    params.set('bandBottom', String(bandBottom ?? 1))
  }

  onStage?.('正在清理画面文字')
  // VSR 刚跑过大区域修复时可能短暂占满显存，5xx 重试一次再放弃
  const send = () => fetch(`${BASE}/repair?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body: fs.readFileSync(file),
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'error',
  })
  let response = await send()
  if (response.status >= 500 && response.status !== 504) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    response = await send()
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try { message = JSON.parse(text)?.error || text } catch {}
    throw new Error(`画面文字修复返回 HTTP ${response.status}${message ? '：' + String(message).slice(0, 220) : ''}`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length < 1024) throw new Error('画面文字修复返回的文件为空')

  const output = `clean_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp4`
  fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(MEDIA_UPLOAD_DIR, output), data, { mode: 0o600 })
  return { applied: true, url: `/uploads/${output}`, seconds: Number(response.headers.get('x-repair-seconds')) || null, bytes: data.length }
}
