import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })
export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeInstaller.path || 'ffprobe'
export const MEDIA_UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads')

export function runMedia(bin, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`媒体处理失败: ${(stderr || err.message).slice(-350)}`))
      resolve({ stdout, stderr })
    })
  })
}

export function localMediaPath(url) {
  if (typeof url !== 'string') return null
  const match = url.split('?')[0].match(/^\/(?:uploads|api\/(?:material\/)?files)\/(.+)$/)
  if (!match) return null
  let rel
  try { rel = decodeURIComponent(match[1]) } catch { return null }
  const absolute = path.resolve(MEDIA_UPLOAD_DIR, rel)
  if (!absolute.startsWith(MEDIA_UPLOAD_DIR + path.sep)) return null
  return absolute
}

export async function probeMedia(file) {
  const { stdout } = await runMedia(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate',
    '-of', 'json', file,
  ], 30000)
  const data = JSON.parse(stdout)
  const video = (data.streams || []).find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video?.height) throw new Error('生成文件不包含有效视频')
  const duration = Number(data.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('生成视频时长无效')
  return { width: video.width, height: video.height, fps: video.avg_frame_rate, duration, hasAudio: (data.streams || []).some((stream) => stream.codec_type === 'audio') }
}

export async function probeAudio(file) {
  const { stdout } = await runMedia(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], 30000)
  const data = JSON.parse(stdout)
  const duration = Number(data.format?.duration)
  if (!(data.streams || []).some((stream) => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('音频文件无效')
  }
  return { duration }
}

export async function probeImage(file) {
  const { stdout } = await runMedia(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], 30000)
  const image = JSON.parse(stdout).streams?.[0]
  if (!image?.width || !image?.height) throw new Error('生成文件不包含有效图片')
  return { width: image.width, height: image.height }
}

// Trim to the user-requested length without pretending a longer model result is already exact.
export async function trimVideo(url, seconds, { preserveEnd = false } = {}) {
  const input = localMediaPath(url)
  if (!input || !fs.existsSync(input)) throw new Error('视频文件不存在或不是本地素材')
  const target = Number(seconds)
  if (!Number.isFinite(target) || target <= 0) throw new Error('视频时长无效')
  const before = await probeMedia(input)
  if (before.duration + 0.1 < target) throw new Error('生成视频短于要求的时长')
  if (Math.abs(before.duration - target) <= 0.08) return { url, ...before }
  const name = `trim_${crypto.randomUUID()}.mp4`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  try {
    const timeArgs = preserveEnd
      ? ['-filter_complex', before.hasAudio
          ? `[0:v]setpts=${target / before.duration}*PTS[v];[0:a]atempo=${before.duration / target}[a]`
          : `[0:v]setpts=${target / before.duration}*PTS[v]`, '-map', '[v]', ...(before.hasAudio ? ['-map', '[a]'] : [])]
      : ['-map', '0:v:0', '-map', '0:a?']
    await runMedia(FFMPEG, ['-y', '-i', input, ...timeArgs, '-t', String(target), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', output])
    const info = await probeMedia(output)
    if (Math.abs(info.duration - target) > 0.15) throw new Error('裁剪后视频时长与要求不一致')
    return { url: `/uploads/${name}`, ...info }
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  }
}

export async function extractLastFrame(url) {
  const input = localMediaPath(url)
  if (!input || !fs.existsSync(input)) throw new Error('前一段视频不存在')
  const info = await probeMedia(input)
  const name = `frame_${crypto.randomUUID()}.jpg`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  try {
    await runMedia(FFMPEG, ['-y', '-ss', String(Math.max(0, info.duration - 0.15)), '-i', input, '-frames:v', '1', '-q:v', '3', output], 60000)
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('未能提取上一段视频的结尾画面')
    return `/uploads/${name}`
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  }
}

// Normalize stream formats and join real segments, filling silence only when a segment has no audio.
export async function concatenateVideos(urls) {
  if (!Array.isArray(urls) || urls.length < 2 || urls.length > 12) throw new Error('拼接视频片段数量无效')
  const files = urls.map(localMediaPath)
  if (files.some((file) => !file || !fs.existsSync(file))) throw new Error('视频片段不存在')
  const metadata = await Promise.all(files.map(probeMedia))
  const { width, height } = metadata[0]
  const filters = []
  for (let i = 0; i < files.length; i++) {
    filters.push(`[${i}:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v${i}]`)
    const source = metadata[i].hasAudio ? `[${i}:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad` : 'anullsrc=channel_layout=stereo:sample_rate=44100'
    filters.push(`${source},atrim=duration=${metadata[i].duration},asetpts=PTS-STARTPTS[a${i}]`)
  }
  filters.push(`${files.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${files.length}:v=1:a=1[v][a]`)
  const name = `long_${crypto.randomUUID()}.mp4`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  try {
    await runMedia(FFMPEG, ['-y', ...files.flatMap((file) => ['-i', file]), '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', output], 900000)
    const info = await probeMedia(output)
    const expected = metadata.reduce((sum, clip) => sum + clip.duration, 0)
    if (Math.abs(info.duration - expected) > Math.max(0.5, files.length * 0.15)) throw new Error('拼接结果时长与片段不一致')
    return { url: `/uploads/${name}`, ...info }
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  }
}
