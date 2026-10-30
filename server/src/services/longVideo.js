import crypto from 'crypto'
import fs from 'fs'
import db from '../db.js'
import { chat, imageToJpegB64, mgVideoGen } from './aiProviders.js'
import { h3FramesForDuration, h3Size } from './h3Spec.js'
import { concatenateVideos, extractLastFrame, localMediaPath } from './mediaTools.js'
import { longVideoPlanningMessages } from './creativeGuide.js'

export function segmentDurations(duration) {
  if (!Number.isInteger(duration) || duration <= 0 || duration > 96) throw new Error('长视频时长超出支持范围')
  const result = []
  let remaining = duration
  while (remaining > 0) {
    const part = Math.min(8, remaining)
    result.push(part)
    remaining -= part
  }
  return result
}

async function planSegments(taskId, params) {
  const existing = db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(taskId)
  if (existing.length) return existing
  const durations = segmentDurations(Number(params.duration))
  if (durations.length < 2 || durations.length > 12) throw new Error('长视频时长超出支持范围')
  const refs = Array.isArray(params.refs) ? params.refs : []
  const response = await chat(longVideoPlanningMessages({ prompt: params.prompt, durations, ratio: params.ratio,
    hasFirst: refs.some((ref) => ref.role === 'first'), hasLast: refs.some((ref) => ref.role === 'last') }),
  { temperature: 0.4, max_tokens: Math.min(4000, 700 + durations.length * 350) })
  let plan
  try {
    const cleaned = response.replace(/```(?:json)?|```/g, '').trim()
    const matched = cleaned.match(/\{[\s\S]*\}/)
    plan = JSON.parse(matched ? matched[0] : cleaned)
  } catch { throw new Error('镜头规划返回格式无效，请重试') }
  if (!Array.isArray(plan.shots) || plan.shots.length !== durations.length) {
    throw new Error('镜头规划结果不完整，请重试')
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

export async function generateLongVideo(taskId, params) {
  const segments = await planSegments(taskId, params)
  const refs = Array.isArray(params.refs) ? params.refs : []
  const first = refs.find((ref) => ref.role === 'first')?.url
  const last = refs.find((ref) => ref.role === 'last')?.url
  let previousUrl = null
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
    let firstFrame = index === 0 ? first : segment.first_frame_url
    if (index > 0 && !firstFrame) {
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
      const out = await mgVideoGen({
        prompt, task: mode, size: h3Size(params.ratio, params.resolution), num_frames: h3FramesForDuration(segment.duration),
        targetDuration: segment.duration, imageSrc, lastFrameSrc, soundscape: segment.soundscape || undefined, music: segment.music || undefined,
        idempotencyKey: segment.idempotency_key, resumeTaskId: segment.provider_task_id,
        onSubmitted: (providerId) => db.transaction(() => {
          db.prepare('UPDATE long_video_segments SET provider_task_id = ? WHERE id = ?').run(providerId, segment.id)
          db.prepare('UPDATE ai_tasks SET provider_task_id = ? WHERE id = ?').run(providerId, taskId)
        }).immediate(),
      })
      previousUrl = out.videos[0].url
      db.transaction(() => {
        db.prepare("UPDATE long_video_segments SET status = 'completed', result_url = ? WHERE id = ?").run(previousUrl, segment.id)
        db.prepare('UPDATE ai_tasks SET provider_task_id = NULL WHERE id = ?').run(taskId)
      }).immediate()
    } catch (error) {
      if (['MG_TASK_FAILED', 'MG_TASK_CANCELLED'].includes(error.code)) {
        db.prepare("UPDATE long_video_segments SET status = 'pending', provider_task_id = NULL, idempotency_key = ? WHERE id = ?").run(crypto.randomUUID(), segment.id)
      }
      throw error
    }
  }
  db.prepare("UPDATE ai_tasks SET stage = '正在合成长视频' WHERE id = ?").run(taskId)
  const urls = db.prepare('SELECT result_url FROM long_video_segments WHERE task_id = ? ORDER BY position').all(taskId).map((row) => row.result_url)
  const video = await concatenateVideos(urls)
  return {
    title: 'AI长视频', desc: params.prompt.slice(0, 80), engine: 'real', provider: 'modelgate',
    model: process.env.MODELGATE_VIDEO_MODEL || 'MiniMax-H3', generatedAt: new Date().toISOString(),
    videos: [{ name: '长视频成片', ...video, resolution: `${video.width}x${video.height}` }], images: [],
  }
}
