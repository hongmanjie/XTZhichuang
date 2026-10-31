import fs from 'fs'
import os from 'os'
import path from 'path'
import { FFMPEG, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { mgOCR } from './aiProviders.js'
import { inspectVideoOverlays, videoVisionProvider } from './visionProvider.js'

// Sampling and inference are read-only; tolerate one transient failure while
// still refusing to add subtitles if the second attempt is inconclusive.
async function retryReadOnly(operation) {
  try { return await operation() }
  catch {
    await new Promise((resolve) => setTimeout(resolve, 750))
    return operation()
  }
}

// This is a sampled check, not a guarantee: short-lived text may fall between samples,
// and product labels in the checked areas may be mistaken for subtitles.
export async function inspectVideoText(videoUrl, { includeTop = false, onStage = () => {}, ocr = mgOCR, preferVisionSemantics = false } = {}) {
  const input = localMediaPath(videoUrl)
  if (!input || !fs.existsSync(input)) return { status: 'unavailable', samples: 0, method: 'sampled_ocr' }
  let dir
  let samples = 0
  let phase = 'probe'
  try {
    const { duration } = await probeMedia(input)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yimetai-text-check-'))
    // Small, low-contrast model-generated captions are often below OCR's
    // recognition threshold at the original 540p size. Enlarge each crop,
    // capped at 1920 px, before recognition; this is still a sampled check.
    const upscale = "scale=w='min(1920,iw*2)':h=-2:flags=lanczos"
    const regions = includeTop
      ? [['top', `crop=iw:ih*0.3:0:0,${upscale}`], ['bottom', `crop=iw:ih*0.5:0:ih*0.5,${upscale}`]]
      : [['bottom', `crop=iw:ih*0.5:0:ih*0.5,${upscale}`]]
    const visionFrames = []
    let ambiguousText = false
    const useVision = videoVisionProvider() !== 'disabled'
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const time = Math.max(0, Math.min(duration - 0.04, duration * fraction))
      for (const [region, filter] of regions) {
        onStage('正在抽帧检查画面文字')
        const frame = path.join(dir, `${region}-${samples}.png`)
        phase = `extract_${region}`
        await retryReadOnly(() => runMedia(FFMPEG, ['-y', '-ss', String(time), '-i', input, '-vf', filter, '-frames:v', '1', frame], 60000))
        phase = `ocr_${region}`
        const result = await retryReadOnly(() => ocr(frame))
        samples++
        // OCR may label shapes as a weak single character. For longer lines,
        // favor avoiding a second subtitle over a potentially cleaner picture:
        // actual AI-generated gibberish tested at ~0.48 confidence before scaling.
        // This may still miss text and may flag product labels.
        const lines = Array.isArray(result?.lines) ? result.lines : [{ text: result?.text }]
        for (const line of lines) {
          const text = String(line?.text || '').replace(/[\s\p{P}\p{S}]/gu, '')
          const length = Array.from(text).length
          const confidence = Number.isFinite(Number(line?.conf)) ? Number(line.conf) : 1
          if (!((length >= 3 && confidence >= 0.35) || (length === 2 && confidence >= 0.5) || (length === 1 && confidence >= 0.9))) continue
          let aspect = null
          if (Array.isArray(line?.bbox) && line.bbox.length >= 4) {
            const width = Number(line.bbox[2]), height = Number(line.bbox[3])
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) aspect = width / height
          }
          // Short or nearly square low-confidence boxes are frequently clothing,
          // microphones, and small product marks. Let visual semantics decide.
          if (aspect !== null && aspect < 1.3) continue
          const strong = confidence >= 0.9 || (length >= 3 && (aspect === null || aspect >= 2.5))
          if (strong && !(preferVisionSemantics && useVision)) return { status: 'text_detected', samples, method: 'sampled_ocr' }
          ambiguousText = true
        }
      }
      if (useVision) {
        const frame = path.join(dir, `vision-${visionFrames.length}.jpg`)
        phase = 'extract_vision'
        await retryReadOnly(() => runMedia(FFMPEG, ['-y', '-ss', String(time), '-i', input, '-vf', "scale=w='min(768,iw)':h=-2:flags=lanczos", '-frames:v', '1', '-q:v', '4', frame], 60000))
        visionFrames.push({ path: frame, time })
      }
    }
    if (useVision) {
      onStage('正在复核画面字幕')
      phase = 'vision'
      const visual = await retryReadOnly(() => inspectVideoOverlays(visionFrames))
      if (visual?.status === 'present') return { status: 'text_detected', samples, visionSamples: visionFrames.length, method: 'sampled_ocr_and_vision' }
      if (visual?.status !== 'absent') return { status: 'unavailable', samples, visionSamples: visionFrames.length, method: 'sampled_ocr_and_vision', failedAt: 'vision_uncertain' }
      return { status: 'clear', samples, visionSamples: visionFrames.length, method: 'sampled_ocr_and_vision' }
    }
    return { status: ambiguousText ? 'text_detected' : 'clear', samples, method: 'sampled_ocr' }
  } catch (error) {
    // Avoid logging frames, OCR text or credentials; report only the failed
    // operation and a coarse error category to make repeated failures diagnosable.
    const message = String(error?.message || '')
    const http = message.match(/HTTP\s+(\d{3})/i)?.[1]
    const errorType = http ? `http_${http}` : /resource temporarily unavailable/i.test(message) ? 'resource_unavailable' : /out of memory|cannot allocate memory/i.test(message) ? 'out_of_memory' : error?.name === 'AbortError' ? 'timeout' : 'processing_error'
    console.warn(`[\u5b57\u5e55\u68c0\u67e5] ${phase}: ${errorType}`)
    return { status: 'unavailable', samples, method: 'sampled_ocr', failedAt: phase, errorType }
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
