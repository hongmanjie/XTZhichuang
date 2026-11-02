import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { mgVideoRestore } from './aiProviders.js'
import { isSeedVRDirectId, seedvrDirect } from './seedvrDirect.js'
import { segmentedSeedVR } from './superResolutionSegments.js'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeMedia, runMedia } from './mediaTools.js'

export const SUPER_RES_MAX_BYTES = 10 * 1024 * 1024
export const SUPER_RES_MAX_SECONDS = 10
export const SUPER_RES_MAX_LONG_SIDE = 719
const configuredRate = Number(process.env.SUPER_RES_POINTS_PER_SECOND || 20)
export const SUPER_RES_POINTS_PER_SECOND = Number.isSafeInteger(configuredRate) && configuredRate > 0 && configuredRate <= 10000 ? configuredRate : 20

export function superResolutionProvider() {
  return String(process.env.SUPER_RES_PROVIDER || 'modelgate').trim().toLowerCase()
}

export function superResolutionSettings(provider = superResolutionProvider()) {
  if (provider === 'modelgate') return { provider, model: 'SeedVR2-3B', maxBytes: SUPER_RES_MAX_BYTES, maxSeconds: SUPER_RES_MAX_SECONDS, maxLongSide: SUPER_RES_MAX_LONG_SIDE, targetLabel: '约 720 像素长边', pointsPerSecond: SUPER_RES_POINTS_PER_SECOND }
  if (provider === 'direct') return { provider, model: 'SeedVR2-3B', maxBytes: 100 * 1024 * 1024, maxSeconds: 60, maxLongSide: 1919, targetLabel: '适配画幅的 1080P 目标框', pointsPerSecond: SUPER_RES_POINTS_PER_SECOND }
  throw new Error('超分服务类型无效')
}

export function directTargetBox(video) {
  const portrait = video.height > video.width
  const square = video.width === video.height
  const width = square ? 1440 : portrait ? 1080 : 1920
  const height = square ? 1440 : portrait ? 1920 : 1080
  const ratio = Math.min(width / video.width, height / video.height)
  return { width, height, ratio, expectedWidth: Math.round(video.width * ratio), expectedHeight: Math.round(video.height * ratio) }
}

export async function inspectSuperResolutionInput(videoUrl, { provider = superResolutionProvider() } = {}) {
  const settings = superResolutionSettings(provider)
  const file = localMediaPath(videoUrl)
  if (!file || !fs.existsSync(file) || path.extname(file).toLowerCase() !== '.mp4') throw new Error('请选择本地 MP4 视频')
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size <= 0 || stat.size > settings.maxBytes) throw new Error(`视频大小须在 ${settings.maxBytes / 1024 / 1024} MB 以内`)
  let video
  try { video = await probeMedia(file) } catch { throw new Error('视频文件无效或无法读取') }
  if (!video.width || !video.height || !Number.isFinite(video.duration) || video.duration < 0.2 || video.duration > settings.maxSeconds) {
    throw new Error(`视频时长须为 0.2–${settings.maxSeconds} 秒`)
  }
  if (provider === 'modelgate' && Math.max(video.width, video.height) > settings.maxLongSide) {
    throw new Error('当前网关输出约 720 像素长边，请选择长边小于 720 像素的视频')
  }
  const target = provider === 'direct' ? directTargetBox(video) : null
  if (target && target.ratio <= 1.01) throw new Error('视频已达到当前模型目标尺寸，不能作为超分输入')
  return { file, bytes: stat.size, ...video, target }
}

export async function enhanceVideo(videoUrl, context = {}) {
  const provider = context.provider || (context.resumeTaskId ? (isSeedVRDirectId(context.resumeTaskId) ? 'direct' : 'modelgate') : superResolutionProvider())
  const source = await inspectSuperResolutionInput(videoUrl, { provider })
  const restored = provider === 'direct'
    ? (context.taskId ? await segmentedSeedVR(source, videoUrl, context) : await seedvrDirect({ videoUrl, width: source.target.width, height: source.target.height, ...context }))
    : await mgVideoRestore({ videoUrl, ...context })
  const downloaded = localMediaPath(restored.videoUrl)
  let finalFile = null
  try {
    const enhanced = await probeMedia(downloaded)
    const aspectDiff = Math.abs((enhanced.width / enhanced.height) / (source.width / source.height) - 1)
    const belowRequestedTarget = source.target && (enhanced.width < source.target.expectedWidth * 0.96 || enhanced.height < source.target.expectedHeight * 0.96)
    if (!enhanced.width || !enhanced.height || enhanced.width < source.width || enhanced.height < source.height ||
        enhanced.width * enhanced.height <= source.width * source.height || aspectDiff > 0.05 || belowRequestedTarget ||
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
      warnings: ['模型会重新生成部分细节，商品文字、标识和人脸可能发生变化，请核对后使用。', '如果原视频有音轨，成片会保留；此功能不进行补帧或口型同步。',
        ...(restored.segmentCount > 1 ? ['为适配共享显存已分段增强，片段衔接处可能出现闪烁，请检查成片。'] : [])],
    }
  } catch (cause) {
    if (finalFile) { try { fs.unlinkSync(finalFile) } catch {} }
    try { fs.unlinkSync(downloaded) } catch {}
    if (cause.code === 'MG_RESULT_INVALID') throw cause
    const error = new Error('上游已完成，但增强结果处理失败；可重新检查结果')
    error.code = 'MG_TASK_UNCERTAIN'; error.taskId = restored.task_id; error.cause = cause; throw error
  }
}
