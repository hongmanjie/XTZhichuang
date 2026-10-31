import fs from 'fs'
import os from 'os'
import path from 'path'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { mgOCR } from './aiProviders.js'

// 画面文字修复：把视频以裸字节 POST 给 VSR 服务，拿回修复后的视频。
// 不依赖共享卷，服务放哪台机器都能用；未配置时整步跳过，不阻断出片。
const BASE = (process.env.SUBTITLE_REPAIR_BASE_URL || '').replace(/\/$/, '')
const TIMEOUT = Number(process.env.SUBTITLE_REPAIR_TIMEOUT_MS) || 900000
const BAND_TOP = Number(process.env.SUBTITLE_REPAIR_BAND_TOP) || 0.86
const MODE = process.env.SUBTITLE_REPAIR_MODE || 'sttn-det'
const MAX_BYTES = 200 * 1024 * 1024

export function subtitleRepairStatus() {
  if (!BASE) return { available: false, reason: 'not_configured', provider: 'vsr' }
  return { available: true, reason: 'configured', provider: 'vsr', mode: MODE, bandTop: BAND_TOP }
}

// 只检查字幕带那一小条有没有字。
// 整幅检测会把桌面商品标签当成字幕（之前就是这么误伤的），带内检测准得多；
// 检测不到字就完全不动画面，避免把商品和桌面一起重绘。
export async function bandTextDetected(videoUrl) {
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file)) return null
  let info
  try { info = await probeMedia(file) } catch { return null }
  if (!Number.isFinite(info.duration) || info.duration <= 0) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'band-'))
  let found = false, minY = 1, maxY = 0, samples = 0
  const cropTop = 0.55
  try {
    const crop = `crop=iw:ih*${1 - cropTop}:0:ih*${cropTop},scale=iw*2:-2`
    for (const ratio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const png = path.join(dir, `frame-${ratio}.png`)
      await runMedia(FFMPEG, ['-y', '-ss', String((info.duration * ratio).toFixed(3)), '-i', file,
        '-frames:v', '1', '-vf', crop, png], 60000)
      if (!fs.existsSync(png)) continue
      const result = await mgOCR(png)
      samples++
      for (const line of result?.lines || []) {
        const text = String(line?.text || '').replace(/[\s\p{P}\p{S}]/gu, '')
        const length = Array.from(text).length
        const conf = Number.isFinite(Number(line?.conf)) ? Number(line.conf) : 1
        if (!((length >= 3 && conf >= 0.35) || (length === 2 && conf >= 0.5) || (length === 1 && conf >= 0.9))) continue
        found = true
        const bbox = line?.bbox
        if (!Array.isArray(bbox) || bbox.length < 4) continue
        const [, y, w, h] = bbox.map(Number)
        if (![y, w, h].every(Number.isFinite) || y < 0 || w <= 0 || h <= 0 || w < h * 1.3) continue
        minY = Math.min(minY, cropTop + y / (info.height * 2))
        maxY = Math.max(maxY, cropTop + (y + h) / (info.height * 2))
      }
    }
    if (!samples) return null
    if (!found) return { detected: false, samples }
    if (maxY <= minY || minY < cropTop || maxY > 1.02) return { detected: true, samples, top: null, bottom: null }
    return { detected: true, samples, top: Math.max(cropTop, minY - 0.035), bottom: Math.min(1, maxY + 0.035) }
  } catch {
    return null
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

export async function repairSubtitleBand(videoUrl, { onStage, bandTop = BAND_TOP, bandBottom = 1 } = {}) {
  if (!BASE) return { applied: false, reason: 'not_configured', url: videoUrl }
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file)) throw new Error('待修复的视频文件不存在')
  const size = fs.statSync(file).size
  if (!size || size > MAX_BYTES) throw new Error('视频超过修复服务的大小限制')

  if (!Number.isFinite(bandTop) || !Number.isFinite(bandBottom) || bandTop < 0 || bandBottom > 1 || bandTop >= bandBottom) throw new Error('字幕修复区域无效')
  onStage?.('正在清理画面文字')
  const response = await fetch(`${BASE}/repair?bandTop=${bandTop.toFixed(4)}&bandBottom=${bandBottom.toFixed(4)}&mode=${encodeURIComponent(MODE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body: fs.readFileSync(file),
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: 'error',
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try { message = JSON.parse(text)?.error || text } catch {}
    throw new Error(`画面文字修复返回 HTTP ${response.status}${message ? '：' + String(message).slice(0, 160) : ''}`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length < 1024) throw new Error('画面文字修复返回的文件为空')

  const output = `clean_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp4`
  fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(MEDIA_UPLOAD_DIR, output), data, { mode: 0o600 })
  return { applied: true, url: `/uploads/${output}`, seconds: Number(response.headers.get('x-repair-seconds')) || null, bytes: data.length }
}
