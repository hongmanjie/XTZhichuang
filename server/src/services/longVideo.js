import crypto from 'crypto'
import fs from 'fs'
import db from '../db.js'
import { cleanupFiles } from '../utils/fileStore.js'
import { chat, imageToJpegB64, mgVideoGen, DEFAULT_VIDEO_NEGATIVE } from './aiProviders.js'
import { h3FramesForDuration, h3Size, planSegmentFrames } from './h3Spec.js'
import { concatenateVideos, extractLastFrame, localMediaPath } from './mediaTools.js'
import { longVideoPlanningMessages } from './creativeGuide.js'

// 720P 实测 175 帧（7.29 秒）能过、192 帧必 OOM，单段上限按清晰度收敛。
export function maxSegmentSeconds(resolution = '540P') {
  return resolution === '720P' ? 7 : 11
}

export function segmentDurations(duration, resolution = '540P') {
  const maxDuration = resolution === '720P' ? 84 : 96
  if (!Number.isInteger(duration) || duration <= 0 || duration > maxDuration) throw new Error(`当前清晰度下最长支持 ${maxDuration} 秒`)
  const cap = maxSegmentSeconds(resolution)
  // 均分而不是贪心切满：15 秒按 7 秒贪心会得到 7+7+1，
  // 而 1 秒那段会被模型补到 5.17 秒，成片直接变 19 秒。
  const count = Math.max(1, Math.ceil(duration / cap))
  const base = Math.floor(duration / count)
  let remainder = duration - base * count
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return base + extra
  })
}

async function planSegments(taskId, params) {
  const existing = db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(taskId)
  if (existing.length) return existing
  const durations = segmentDurations(Number(params.duration), params.resolution || '540P')
  if (durations.length < 2 || durations.length > 12) throw new Error('分段数量超出支持范围（2–12 段）')
  const refs = Array.isArray(params.refs) ? params.refs : []
  // 数字人已经有完整的人物与商品描述，再让分镜模型改写会丢掉这些细节，
  // 而且它的音频会被 TTS 完全覆盖，没必要让 H3 生成音景和配乐。
  const silentAudio = params.silentAudio === true
  let plan = null
  if (!silentAudio) try {
    const response = await chat(longVideoPlanningMessages({ prompt: params.prompt, durations, ratio: params.ratio,
      hasFirst: refs.some((ref) => ref.role === 'first'), hasLast: refs.some((ref) => ref.role === 'last'),
      mode: params.mode || 'continuous' }),
    { temperature: 0.4, max_tokens: Math.min(4000, 700 + durations.length * 350) })
    const cleaned = response.replace(/```(?:json)?|```/g, '').trim()
    const matched = cleaned.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(matched ? matched[0] : cleaned)
    if (Array.isArray(parsed.shots) && parsed.shots.length === durations.length) plan = parsed
  } catch { plan = null }
  // 分镜模型不可用（网关 503 等）时降级成“单镜头连续”，
  // 长视频不该因为对话服务挂掉就整条失败。
  if (!plan) {
    plan = {
      visual_style: '',
      music: silentAudio ? 'N/A' : '',
      shots: durations.map((_, index) => ({
        visual: `${params.prompt}（第 ${index + 1}/${durations.length} 段，同一场景、同一主体、连续拍摄，不要转场）`,
        camera: silentAudio ? 'Static Shot，机位与焦段保持不动' : (index === 0 ? '镜头平稳，缓慢推近' : '沿用上一段的机位、光线与景别'),
        soundscape: silentAudio ? 'N/A' : '与画面内容一致的真实环境音，无背景音乐',
      })),
    }
  }
  const shots = plan.shots.map((shot) => {
    if (typeof shot === 'string') return { description: shot.trim(), soundscape: '' }
    if (!shot || typeof shot !== 'object' || typeof shot.visual !== 'string') throw new Error('镜头规划结果不完整，请重试')
    const parts = [['画面', shot.visual], ['起始', shot.start], ['动作', shot.action], ['运镜', shot.camera], ['结束', shot.end]]
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([label, value]) => `${label}：${value.trim()}`)
    return { description: parts.join('；'), soundscape: typeof shot.soundscape === 'string' ? shot.soundscape.slice(0, 500) : '' }
  })
  if (shots.some((shot) => !shot.description)) throw new Error('镜头规划结果不完整，请重试')
  const visualStyle = typeof plan.visual_style === 'string' ? plan.visual_style.trim().slice(0, 500) : ''
  const music = typeof plan.music === 'string' ? plan.music.trim().slice(0, 500) : ''
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO long_video_segments (task_id, position, duration, prompt, idempotency_key, soundscape, music) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (let i = 0; i < durations.length; i++) insert.run(taskId, i, durations[i], `${visualStyle ? `统一风格：${visualStyle}；` : ''}${shots[i].description}`.slice(0, 1600), crypto.randomUUID(), shots[i].soundscape, music)
  }).immediate()
  return db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(taskId)
}

export async function generateLongVideo(taskId, params, { segmentsOnly = false, validateSegment = null, maxQualityRetries = 0 } = {}) {
  const segments = await planSegments(taskId, params)
  const refs = Array.isArray(params.refs) ? params.refs : []
  const first = refs.find((ref) => ref.role === 'first')?.url
  const last = refs.find((ref) => ref.role === 'last')?.url
  let previousUrl = null
  // 每段帧数按 17n+5 对齐后整体分配，避免逐段向上取整累积出多余的秒数
  const plannedFrames = planSegmentFrames(segments.map((row) => row.duration), params.resolution || '540P')
  for (let index = 0; index < segments.length; index++) {
    let segment = db.prepare('SELECT * FROM long_video_segments WHERE id = ?').get(segments[index].id)
    if (segment.status === 'completed') {
      const existingFile = localMediaPath(segment.result_url)
      if (existingFile && fs.existsSync(existingFile)) { previousUrl = segment.result_url; continue }
      if (!segment.provider_task_id) throw new Error('已完成的片段文件丢失且无法找回')
      db.prepare("UPDATE long_video_segments SET status = 'submitting' WHERE id = ?").run(segment.id)
      segment.status = 'submitting'
    }
    if (segment.status === 'submitting' && !segment.provider_task_id) {
      const error = new Error(`第 ${index + 1} 段提交状态未知，请联系管理员核对`)
      error.code = 'MG_SUBMIT_UNCERTAIN'; throw error
    }
    // 锚定模式：每段都从同一张锚定图开始，人物和商品绝不逐段漂移。
    // 段间动作由每段 prompt 各自决定，不会重复上一段的内容。
    // 多镜头模式同样要挂同一张首帧：否则每段都会重新“编”一个商品，
    // 实测杯子上的文字会变成 TIASHRDY / GRNRFY / DINSHOY 三种不同的伪文字。
    // 镜头之间本来就是切换，视觉上不会像口播那样觉得回跳。
    let firstFrame = index === 0 || params.anchorFirstFrame || params.mode === 'multishot' ? first : segment.first_frame_url
    // 便于核对锚定是否真的生效：anchored 表示本段用的是同一张锚定图
    console.log(`[h3-anchor] task=${taskId} seg=${index + 1}/${segments.length} anchor=${!!params.anchorFirstFrame} source=${index === 0 ? 'first' : (params.anchorFirstFrame ? 'anchor' : 'prev-frame')}`)
    // 多镜头模式下每段独立生成，不继承上一段末帧，避免把上一个镜头的构图带进来
    if (index > 0 && !firstFrame && params.mode !== 'multishot') {
      firstFrame = await extractLastFrame(previousUrl)
      db.prepare('UPDATE long_video_segments SET first_frame_url = ? WHERE id = ?').run(firstFrame, segment.id)
    }
    const lastFrame = index === segments.length - 1 ? last : undefined
    const mode = firstFrame ? (lastFrame ? 'fl2av' : 'i2av') : (lastFrame ? 'l2av' : 't2av')
    const isResume = !!segment.provider_task_id
    const imageSrc = firstFrame ? (isResume ? firstFrame : await imageToJpegB64(firstFrame)) : undefined
    const lastFrameSrc = lastFrame ? (isResume ? lastFrame : await imageToJpegB64(lastFrame)) : undefined
    const prompt = `整体视频设定：${params.prompt}。这是第 ${index + 1} 段，共 ${segments.length} 段。${segment.prompt}。保持前后人物、产品外观和画面风格一致，避免出现字幕或文字。`
    db.transaction(() => {
      db.prepare("UPDATE long_video_segments SET status = 'submitting' WHERE id = ?").run(segment.id)
      db.prepare("UPDATE ai_tasks SET provider_task_id = ?, stage = ? WHERE id = ?").run(segment.provider_task_id || null, `正在生成第 ${index + 1}/${segments.length} 段`, taskId)
    }).immediate()
    try {
      // 单段失败只影响这一段：明确失败（上游报错、断连、OOM）自动重试，
      // 已完成的片段不动，重试用新的幂等键重新提交，避免脏状态复用。
      let out = null
      let attempt = 0
      const maxAttempts = Math.max(1, Number(process.env.H3_SEGMENT_ATTEMPTS) || 5)
      while (true) {
        try {
          out = await mgVideoGen({
            prompt, task: mode, size: h3Size(params.ratio, params.resolution), num_frames: plannedFrames[index],
            targetDuration: segment.duration, imageSrc, lastFrameSrc, soundscape: segment.soundscape || undefined, music: segment.music || undefined,
            negativePrompt: params.negativePrompt || DEFAULT_VIDEO_NEGATIVE,
            idempotencyKey: segment.idempotency_key, resumeTaskId: segment.provider_task_id,
            onSubmitted: (providerId) => db.transaction(() => {
              db.prepare('UPDATE long_video_segments SET provider_task_id = ? WHERE id = ?').run(providerId, segment.id)
              db.prepare('UPDATE ai_tasks SET provider_task_id = ? WHERE id = ?').run(providerId, taskId)
            }).immediate(),
          })
          break
        } catch (error) {
          attempt += 1
          const retryable = ['MG_TASK_FAILED', 'MG_CONNECTION_UNAVAILABLE'].includes(error.code)
            || /upstream_failed|CUDA out of memory|out of memory/i.test(String(error.message || ''))
          if (!retryable || attempt >= maxAttempts) throw error
          db.transaction(() => {
            db.prepare("UPDATE long_video_segments SET status = 'pending', provider_task_id = NULL, idempotency_key = ? WHERE id = ?")
              .run(crypto.randomUUID(), segment.id)
            db.prepare('UPDATE ai_tasks SET provider_task_id = NULL, stage = ? WHERE id = ?')
              .run(`第 ${index + 1} 段失败，第 ${attempt + 1} 次重试`, taskId)
          }).immediate()
          segment = db.prepare('SELECT * FROM long_video_segments WHERE id = ?').get(segment.id)
          // 5/10/20/40 秒退避：OOM 之后显存要时间释放，立刻重试大概率同样失败
          await new Promise((resolve) => setTimeout(resolve, Math.min(40000, 5000 * 2 ** (attempt - 1))))
        }
      }
      const candidateUrl = out.videos[0].url
      const quality = validateSegment ? await validateSegment(candidateUrl, segment.position) : null
      if (quality?.status === 'text_detected' && Number(segment.quality_attempts || 0) < maxQualityRetries) {
        db.transaction(() => {
          db.prepare("UPDATE long_video_segments SET status = 'pending', provider_task_id = NULL, idempotency_key = ?, quality_attempts = quality_attempts + 1, quality_check = NULL WHERE id = ?")
            .run(crypto.randomUUID(), segment.id)
          db.prepare('UPDATE ai_tasks SET provider_task_id = NULL, stage = ? WHERE id = ?')
            .run(`第 ${index + 1} 段发现文字，正在重新生成`, taskId)
        }).immediate()
        cleanupFiles([candidateUrl])
        index--
        continue
      }
      previousUrl = candidateUrl
      db.transaction(() => {
        db.prepare("UPDATE long_video_segments SET status = 'completed', result_url = ?, quality_check = ? WHERE id = ?")
          .run(previousUrl, quality ? JSON.stringify(quality) : null, segment.id)
        db.prepare('UPDATE ai_tasks SET provider_task_id = NULL WHERE id = ?').run(taskId)
      }).immediate()
    } catch (error) {
      if (['MG_TASK_FAILED', 'MG_TASK_CANCELLED', 'MG_CONNECTION_UNAVAILABLE'].includes(error.code)) {
        db.prepare("UPDATE long_video_segments SET status = 'pending', provider_task_id = NULL, idempotency_key = ? WHERE id = ?").run(crypto.randomUUID(), segment.id)
      }
      throw error
    }
  }
  db.prepare("UPDATE ai_tasks SET stage = '正在合成长视频' WHERE id = ?").run(taskId)
  const urls = db.prepare('SELECT result_url FROM long_video_segments WHERE task_id = ? ORDER BY position').all(taskId).map((row) => row.result_url)
  if (segmentsOnly) return { urls }
  const video = await concatenateVideos(urls)
  return {
    title: 'AI长视频', desc: params.prompt.slice(0, 80), engine: 'real', provider: 'modelgate',
    model: process.env.MODELGATE_VIDEO_MODEL || 'MiniMax-H3', generatedAt: new Date().toISOString(),
    videos: [{ name: '长视频成片', ...video, resolution: `${video.width}x${video.height}` }], images: [],
  }
}
