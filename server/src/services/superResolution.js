import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { mgVideoRestore } from './aiProviders.js'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeMedia, runMedia } from './mediaTools.js'

export const SUPER_RES_MAX_BYTES = 10 * 1024 * 1024
export const SUPER_RES_MAX_SECONDS = 10
export const SUPER_RES_MAX_LONG_SIDE = 719
const configuredRate = Number(process.env.SUPER_RES_POINTS_PER_SECOND || 20)
export const SUPER_RES_POINTS_PER_SECOND = Number.isSafeInteger(configuredRate) && configuredRate > 0 && configuredRate <= 10000 ? configuredRate : 20

export async function inspectSuperResolutionInput(videoUrl) {
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file) || path.extname(file).toLowerCase() !== '.mp4') throw new Error('请选择本地 MP4 视频')
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size <= 0 || stat.size > SUPER_RES_MAX_BYTES) throw new Error('视频大小须在 10 MB 以内')
  let video
  try { video = await probeMedia(file) } catch { throw new Error('视频文件无效或无法读取') }
  if (!video.width || !video.height || !Number.isFinite(video.duration) || video.duration < 0.2 || video.duration > SUPER_RES_MAX_SECONDS) {
    throw new Error('视频时长须为 0.2–10 秒')
  }
  if (Math.max(video.width, video.height) > SUPER_RES_MAX_LONG_SIDE) {
    throw new Error('当前增强服务输出约 720 像素长边，请选择长边小于 720 像素的视频')
  }
  return { file, bytes: stat.size, ...video }
}

export async function enhanceVideo(videoUrl, context = {}) {
  const source = await inspectSuperResolutionInput(videoUrl)
  const restored = await mgVideoRestore({ videoUrl, ...context })
  const downloaded = localMediaPath(restored.videoUrl)
  let finalFile = null
  try {
    const enhanced = await probeMedia(downloaded)
    const aspectDiff = Math.abs((enhanced.width / enhanced.height) / (source.width / source.height) - 1)
    if (!enhanced.width || !enhanced.height || enhanced.width < source.width || enhanced.height < source.height ||
        enhanced.width * enhanced.height <= source.width * source.height || aspectDiff > 0.05 ||
        Math.abs(enhanced.duration - source.duration) > 0.25) {
      const error = new Error('模型输出的尺寸、画幅或时长不符合增强要求，请检查素材后重试')
      error.code = 'MG_RESULT_INVALID'; error.taskId = restored.task_id; throw error
    }
    let finalUrl = restored.videoUrl
    let finalInfo = enhanced
    // Preserve the source soundtrack rather than relying on the model's returned audio.
    if (source.hasAudio || enhanced.hasAudio) {
      const name = `enhanced_${crypto.randomUUID()}.mp4`
      finalFile = path.join(MEDIA_UPLOAD_DIR, name)
      const audioArgs = source.hasAudio ? ['-i', source.file, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-af', 'apad', '-t', String(enhanced.duration)] : ['-map', '0:v:0', '-c:v', 'copy', '-an']
      await runMedia(FFMPEG, ['-y', '-i', downloaded, ...audioArgs, '-movflags', '+faststart', finalFile], 180000)
      finalInfo = await probeMedia(finalFile)
      if (source.hasAudio !== finalInfo.hasAudio || Math.abs(finalInfo.duration - enhanced.duration) > 0.25) throw new Error('增强视频音轨或时长校验失败')
      finalUrl = `/uploads/${name}`
      try { fs.unlinkSync(downloaded) } catch {}
    }
    return {
      title: '视频画质增强', engine: 'real', provider: restored.provider, model: restored.model,
      task_id: restored.task_id, generatedAt: new Date().toISOString(), sourceUrl: videoUrl,
      videos: [{ name: '增强视频', url: finalUrl, ...finalInfo, resolution: `${finalInfo.width}x${finalInfo.height}` }], images: [],
      warnings: ['模型会重新生成部分细节，商品文字、标识和人脸可能发生变化，请核对后使用。', '如果原视频有音轨，成片会保留；此功能不进行补帧或口型同步。'],
    }
  } catch (cause) {
    if (finalFile) { try { fs.unlinkSync(finalFile) } catch {} }
    try { fs.unlinkSync(downloaded) } catch {}
    if (cause.code === 'MG_RESULT_INVALID') throw cause
    const error = new Error('上游已完成，但增强结果处理失败；可重新检查结果')
    error.code = 'MG_TASK_UNCERTAIN'; error.taskId = restored.task_id; error.cause = cause; throw error
  }
}
