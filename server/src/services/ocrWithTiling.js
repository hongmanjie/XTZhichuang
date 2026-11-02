import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FFMPEG, probeImage, runMedia } from './mediaTools.js'

// OCR backends can reject an image when their recognition batch exceeds the
// model limit. Retry once, then split into overlapping bands and, if needed,
// smaller tiles. Any failing tile makes the whole check inconclusive.
export async function ocrWithTiling(imagePath, ocr) {
  if (typeof ocr !== 'function') throw new Error('OCR 适配器无效')
  let dir = null
  let counter = 0
  let tiled = false
  async function inspect(file, offsetX, offsetY, depth) {
    let result
    try {
      try { result = await ocr(file) }
      catch {
        await new Promise((resolve) => setTimeout(resolve, 750))
        result = await ocr(file)
      }
      if (!Array.isArray(result?.lines)) throw new Error('OCR 返回格式无效')
    } catch (error) {
      if (depth >= 4) throw error
      const { width, height } = await probeImage(file)
      const horizontal = depth % 2 === 0
      const axis = horizontal ? height : width
      if (axis < 64) throw error
      // 16% overlap helps avoid cutting text on a tile boundary.
      const span = Math.min(axis - 1, Math.ceil(axis * 0.58))
      const starts = [0, axis - span]
      dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'yimetai-ocr-tiles-'))
      tiled = true
      const lines = []
      for (const start of starts) {
        const x = horizontal ? 0 : start
        const y = horizontal ? start : 0
        const w = horizontal ? width : span
        const h = horizontal ? span : height
        const tile = path.join(dir, `tile-${counter++}.png`)
        await runMedia(FFMPEG, ['-y', '-i', file, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', tile], 60000)
        lines.push(...await inspect(tile, offsetX + x, offsetY + y, depth + 1))
      }
      return lines
    }
    return result.lines.map((line) => {
      if (!Array.isArray(line?.bbox) || line.bbox.length < 4) return line
      const [x, y, w, h] = line.bbox.map(Number)
      if (![x, y, w, h].every(Number.isFinite)) return line
      return { ...line, bbox: [x + offsetX, y + offsetY, w, h] }
    })
  }
  try {
    const lines = await inspect(imagePath, 0, 0, 0)
    return { lines, text: lines.map((line) => line?.text || '').join('\n'), tiled }
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  }
}
