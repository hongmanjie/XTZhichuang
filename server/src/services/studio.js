import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { mgImageGen } from './aiProviders.js'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeImage, runMedia } from './mediaTools.js'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const SAMPLE_SIZE = 128

function alphaSample(file) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-v', 'error', '-i', file, '-vf', `scale=${SAMPLE_SIZE}:${SAMPLE_SIZE}:flags=neighbor,format=rgba,alphaextract`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: SAMPLE_SIZE * SAMPLE_SIZE * 2, timeout: 60000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`无法读取图片透明通道: ${String(stderr || error.message).slice(-200)}`))
        resolve(stdout)
      })
  })
}

// Validate transparency before creating or charging a task. The foreground remains the user's pixels.
export async function inspectStudioProduct(url) {
  const file = localMediaPath(url)
  if (!file || !fs.existsSync(file)) throw new Error('商品图片不存在')
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('商品图片须为 10 MB 以内的 PNG')
  const signature = Buffer.alloc(PNG_SIGNATURE.length)
  const handle = fs.openSync(file, 'r')
  try { fs.readSync(handle, signature, 0, signature.length, 0) } finally { fs.closeSync(handle) }
  if (!signature.equals(PNG_SIGNATURE)) throw new Error('请上传透明背景的 PNG 商品图')
  const image = await probeImage(file)
  if (image.width > 8192 || image.height > 8192 || image.width * image.height > 40_000_000) throw new Error('商品图片尺寸过大')
  const alpha = await alphaSample(file)
  if (alpha.length !== SAMPLE_SIZE * SAMPLE_SIZE) throw new Error('无法读取商品图片透明通道')
  let transparent = 0
  let visible = 0
  let minX = SAMPLE_SIZE, minY = SAMPLE_SIZE, maxX = -1, maxY = -1
  for (let y = 0; y < SAMPLE_SIZE; y++) for (let x = 0; x < SAMPLE_SIZE; x++) {
    const value = alpha[y * SAMPLE_SIZE + x]
    if (value < 245) transparent++
    if (value > 16) { visible++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  }
  if (transparent < alpha.length * 0.01 || visible < alpha.length * 0.01) throw new Error('请上传已去除背景的透明 PNG 商品图；当前不支持自动抠图')
  const marginX = Math.ceil(image.width * 0.015)
  const marginY = Math.ceil(image.height * 0.015)
  const left = Math.max(0, Math.floor(minX * image.width / SAMPLE_SIZE) - marginX)
  const top = Math.max(0, Math.floor(minY * image.height / SAMPLE_SIZE) - marginY)
  const right = Math.min(image.width, Math.ceil((maxX + 1) * image.width / SAMPLE_SIZE) + marginX)
  const bottom = Math.min(image.height, Math.ceil((maxY + 1) * image.height / SAMPLE_SIZE) + marginY)
  return { file, ...image, crop: { x: left, y: top, width: right - left, height: bottom - top } }
}

export async function composeStudioImage(backgroundUrl, productUrl, inspected) {
  const background = localMediaPath(backgroundUrl)
  const product = inspected || await inspectStudioProduct(productUrl)
  if (!background || !fs.existsSync(background)) throw new Error('背景图片不存在')
  const name = `studio_${crypto.randomUUID()}.png`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  const crop = product.crop
  const filters = `[0:v]scale=1024:1024:force_original_aspect_ratio=increase,crop=1024:1024,setsar=1[bg];[1:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=650:650:force_original_aspect_ratio=decrease,format=rgba[product];[bg][product]overlay=(W-w)/2:0.78*H-h:format=auto,format=rgb24[out]`
  try {
    await runMedia(FFMPEG, ['-y', '-filter_complex_threads', '1', '-i', background, '-i', product.file, '-filter_complex', filters, '-map', '[out]', '-frames:v', '1', '-c:v', 'png', '-threads', '1', '-update', '1', output], 120000)
    const info = await probeImage(output)
    if (info.width !== 1024 || info.height !== 1024) throw new Error('商拍成图尺寸异常')
    return { url: `/uploads/${name}`, width: info.width, height: info.height, resolution: `${info.width}x${info.height}` }
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  }
}

export async function generateStudio(params, context) {
  const product = await inspectStudioProduct(params.imageUrl)
  context.onStage('正在生成商拍背景')
  const style = String(params.prompt || '').trim().slice(0, 400)
  const prompt = `Create an empty premium e-commerce product photography background. ${style || 'A clean minimal studio with soft natural light'}. Square composition; an empty small flat pedestal in the lower middle; reserve the center for a product to be added later. No products, people, lettering, logos, labels, or watermarks.`
  const background = await mgImageGen({ prompt, size: [1024, 1024], idempotencyKey: context.idempotencyKey, resumeTaskId: context.resumeTaskId, onSubmitted: context.onSubmitted, onProgress: context.onProgress })
  const backgroundUrl = background.images?.[0]
  if (!backgroundUrl) throw new Error('背景生成结果为空')
  try {
    context.onStage('正在合成商品原图')
    const composed = await composeStudioImage(backgroundUrl, params.imageUrl, product)
    return { title: 'AI商品场景图', desc: style, engine: 'real', provider: 'modelgate + ffmpeg', model: background.model,
      generatedAt: new Date().toISOString(), images: [{ name: '商品场景图', ...composed }], videos: [],
      warnings: ['商品主体来自上传的透明图；背景与商品的光影融合需要人工检查，当前不支持自动抠图。'] }
  } finally {
    const file = localMediaPath(backgroundUrl)
    if (file && file !== product.file && /^ai_[\w-]+\.(?:png|jpe?g|webp)$/i.test(path.basename(file))) { try { fs.unlinkSync(file) } catch {} }
  }
}
