import fs from 'fs'
import os from 'os'
import path from 'path'
import { FFMPEG, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { mgOCR } from './aiProviders.js'

// This is a sampled check, not a guarantee: short-lived text may fall between samples,
// and product labels in the checked areas may be mistaken for subtitles.
export async function inspectVideoText(videoUrl, { includeTop = false, onStage = () => {}, ocr = mgOCR } = {}) {
  const input = localMediaPath(videoUrl)
  if (!input || !fs.existsSync(input)) return { status: 'unavailable', samples: 0, method: 'sampled_ocr' }
  let dir
  let samples = 0
  try {
    const { duration } = await probeMedia(input)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yimetai-text-check-'))
    const regions = includeTop
      ? [['top', 'crop=iw:ih*0.3:0:0'], ['bottom', 'crop=iw:ih*0.5:0:ih*0.5']]
      : [['bottom', 'crop=iw:ih*0.5:0:ih*0.5']]
    for (const fraction of [0.2, 0.5, 0.8]) {
      const time = Math.max(0, Math.min(duration - 0.04, duration * fraction))
      for (const [region, filter] of regions) {
        onStage('正在抽帧检查画面文字')
        const frame = path.join(dir, `${region}-${samples}.png`)
        await runMedia(FFMPEG, ['-y', '-ss', String(time), '-i', input, '-vf', filter, '-frames:v', '1', frame], 60000)
        const result = await ocr(frame)
        samples++
        // OCR can label a neckline or other shapes as a low-confidence single
        // character. Keep strong single-character results, or two characters
        // with moderate confidence; this may miss short or faint text.
        const lines = Array.isArray(result?.lines) ? result.lines : [{ text: result?.text }]
        const detected = lines.some((line) => {
          const text = String(line?.text || '').replace(/[\s\p{P}\p{S}]/gu, '')
          const length = Array.from(text).length
          const confidence = Number.isFinite(Number(line?.conf)) ? Number(line.conf) : 1
          return (length >= 2 && confidence >= 0.5) || (length === 1 && confidence >= 0.9)
        })
        if (detected) return { status: 'text_detected', samples, method: 'sampled_ocr' }
      }
    }
    return { status: 'clear', samples, method: 'sampled_ocr' }
  } catch {
    return { status: 'unavailable', samples, method: 'sampled_ocr' }
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  }
}

export function textCheckWarning(check, wantsSubtitle) {
  if (check?.status === 'text_detected') {
    return wantsSubtitle
      ? '抽帧发现画面可能已有文字或旧字幕，已暂停添加新字幕，避免叠成多行；请先检查原片，必要时更换原片或处理旧字幕。'
      : '抽帧发现画面可能已有文字或旧字幕，请检查是否有乱码或多行字幕；原画面文字不会自动移除。'
  }
  if (check?.status !== 'clear') {
    return wantsSubtitle
      ? '画面文字检查未完成，已暂停添加新字幕；请检查原片后再处理字幕。'
      : '画面文字检查未完成，请检查成片是否有乱码或旧字幕。'
  }
  return ''
}
