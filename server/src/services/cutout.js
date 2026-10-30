import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { MEDIA_UPLOAD_DIR, localMediaPath, probeImage } from './mediaTools.js'
import { inspectStudioProduct } from './studio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const model = path.join(root, 'models', 'u2netp.onnx')
const script = path.join(root, 'src', 'tools', 'cutout.py')
const expectedHash = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'
const python = process.env.CUTOUT_PYTHON || (process.platform === 'win32' ? path.join(root, '.venv-cutout', 'Scripts', 'python.exe') : 'python3')
let checkedModel = false
let tail = Promise.resolve()
let queued = 0

function runCutout(input, output) {
  return new Promise((resolve, reject) => {
    execFile(python, ['-I', script, input, output, model], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`自动抠图未完成：${String(stderr || error.message).slice(-250)}`))
      resolve()
    })
  })
}

export async function cutoutProduct(imageUrl) {
  if (queued >= 4) throw new Error('自动抠图任务较多，请稍后再试')
  const input = localMediaPath(imageUrl)
  if (!input || !fs.existsSync(input) || !/\.(?:png|jpe?g|webp)$/i.test(input)) throw new Error('请使用 JPG、PNG 或 WebP 商品图片')
  const stat = fs.statSync(input)
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('商品图片不能超过 10 MB')
  const info = await probeImage(input)
  if (info.width > 8192 || info.height > 8192 || info.width * info.height > 40_000_000) throw new Error('商品图片尺寸过大')
  // Requests can enter the queue while another image's metadata is being read.
  if (queued >= 4) throw new Error('自动抠图任务较多，请稍后再试')
  if (!checkedModel) {
    if (!fs.existsSync(model)) throw new Error('本地抠图模型尚未安装')
    const hash = crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex')
    if (hash !== expectedHash) throw new Error('本地抠图模型校验失败')
    checkedModel = true
  }
  queued++
  const previous = tail
  let release
  tail = new Promise((resolve) => { release = resolve })
  await previous
  const name = `cutout_${crypto.randomUUID()}.png`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  try {
    await runCutout(input, output)
    const url = `/uploads/${name}`
    await inspectStudioProduct(url)
    return { url, size: fs.statSync(output).size }
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  } finally {
    queued--
    release()
  }
}
