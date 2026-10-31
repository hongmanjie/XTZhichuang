import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import db from '../db.js'
import { cleanupFiles } from '../utils/fileStore.js'
import { FFMPEG, FFPROBE, MEDIA_UPLOAD_DIR, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { isSeedVRDirectId, seedvrDirect } from './seedvrDirect.js'

function uncertain(message, taskId) {
  const error = new Error(message)
  error.code = 'MG_TASK_UNCERTAIN'
  if (taskId) error.taskId = taskId
  return error
}

export function planSuperResolutionSegments(totalFrames, chunkFrames = 6, overlap = 2) {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 1 || totalFrames > 3600) throw new Error('视频帧数超出当前处理范围')
  if (!Number.isSafeInteger(chunkFrames) || chunkFrames < 3 || chunkFrames > 24 || overlap < 0 || overlap >= chunkFrames) throw new Error('超分片段配置无效')
  const result = []
  let covered = 0
  while (covered < totalFrames) {
    const start = covered === 0 ? 0 : Math.max(0, Math.min(covered - overlap, totalFrames - chunkFrames))
    const frames = Math.min(chunkFrames, totalFrames - start)
    const drop = covered - start
    if (drop >= frames) throw new Error('超分片段规划无效')
    result.push({ start, frames, drop })
    covered = start + frames
  }
  return result
}

async function frameInfo(file) {
  const { stdout } = await runMedia(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=avg_frame_rate,r_frame_rate,nb_read_frames', '-of', 'json', file], 180000)
  const stream = JSON.parse(stdout).streams?.[0]
  const fps = String(stream?.avg_frame_rate || '')
  const match = fps.match(/^(\d+)\/(\d+)$/)
  const count = Number(stream?.nb_read_frames)
  if (!match || !Number(match[2]) || !Number.isSafeInteger(count) || count < 1) throw new Error('无法确认视频帧率或帧数')
  const rate = Number(match[1]) / Number(match[2])
  if (!Number.isFinite(rate) || rate < 1 || rate > 60) throw new Error('当前超分支持 1–60 帧/秒的视频')
  const raw = String(stream?.r_frame_rate || '').match(/^(\d+)\/(\d+)$/)
  const nominal = raw && Number(raw[2]) ? Number(raw[1]) / Number(raw[2]) : rate
  if (Math.abs(nominal / rate - 1) > 0.01) throw new Error('视频帧率不固定，请先转换为固定帧率后增强')
  return { fps, count, rate }
}

function segmentFileName() { return `sr_part_${crypto.randomUUID()}.mp4` }

async function makeInputClip(source, segment) {
  const name = segmentFileName()
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  try {
    const end = segment.start_frame + segment.frame_count - 1
    const filter = `select=between(n\\,${segment.start_frame}\\,${end}),setpts=N/(${segment.fps}*TB)`
    await runMedia(FFMPEG, ['-y', '-i', source.file, '-an', '-vf', filter, '-r', segment.fps,
      '-frames:v', String(segment.frame_count), '-c:v', 'libx264', '-preset', 'ultrafast',
      '-threads', '2', '-pix_fmt', 'yuv420p', output], 180000)
    const info = await frameInfo(output)
    if (info.count !== segment.frame_count) throw new Error('超分输入分段帧数不正确')
    return `/uploads/${name}`
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  }
}

async function joinEnhancedSegments(rows, source, context) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtzc-sr-join-'))
  const output = path.join(MEDIA_UPLOAD_DIR, segmentFileName())
  try {
    const entries = []
    for (const row of rows) {
      const input = localMediaPath(row.result_url)
      if (!input || !fs.existsSync(input)) throw new Error('超分片段文件丢失')
      const part = path.join(dir, String(row.position).padStart(5, '0') + '.mp4')
      context.onStage?.(`正在衔接增强片段 ${row.position + 1}/${rows.length}`)
      const filter = `trim=start_frame=${row.drop_prefix},setpts=N/(${row.fps}*TB)`
      await runMedia(FFMPEG, ['-y', '-i', input, '-an', '-vf', filter, '-r', row.fps,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-bf', '0', '-threads', '2',
        '-pix_fmt', 'yuv420p', part], 180000)
      entries.push(part)
    }
    const list = path.join(dir, 'parts.ffconcat')
    fs.writeFileSync(list, 'ffconcat version 1.0\n' + entries.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join('\n') + '\n')
    await runMedia(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-an', '-c:v', 'copy', '-movflags', '+faststart', output], 180000)
    const result = await probeMedia(output)
    const frames = await frameInfo(output)
    const expected = rows.reduce((sum, row) => sum + row.frame_count - row.drop_prefix, 0)
    if (frames.count !== expected || Math.abs(result.duration - source.duration) > 0.25) throw new Error('增强片段合成后的帧数或时长不正确')
    return `/uploads/${path.basename(output)}`
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
}

// Persist every submitted provider id and completed fragment. The upstream has no
// idempotency key; ambiguous submissions remain in reconciliation.
export async function segmentedSeedVR(source, videoUrl, context) {
  const taskId = Number(context.taskId)
  if (!Number.isSafeInteger(taskId) || taskId < 1) throw new Error('超分任务编号无效')
  let rows = db.prepare('SELECT * FROM super_res_segments WHERE task_id = ? ORDER BY position').all(taskId)
  if (!rows.length) {
    context.onStage?.('正在规划低显存增强')
    const info = await frameInfo(source.file)
    if (Math.abs(info.count / info.rate - source.duration) > 0.25) throw new Error('视频帧数与时长不一致，请先转换为固定帧率')
    const chunkFrames = Math.max(3, Math.min(24, Number(process.env.SEEDVR_DIRECT_CHUNK_FRAMES) || 6))
    const plan = planSuperResolutionSegments(info.count, chunkFrames, Math.min(2, chunkFrames - 1))
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO super_res_segments (task_id, position, start_frame, frame_count, drop_prefix, fps) VALUES (?, ?, ?, ?, ?, ?)')
      plan.forEach((segment, i) => insert.run(taskId, i, segment.start, segment.frames, segment.drop, info.fps))
    }).immediate()
    rows = db.prepare('SELECT * FROM super_res_segments WHERE task_id = ? ORDER BY position').all(taskId)
  }

  for (const initial of rows) {
    let segment = db.prepare('SELECT * FROM super_res_segments WHERE id = ?').get(initial.id)
    if (segment.status === 'completed') {
      const file = localMediaPath(segment.result_url)
      if (file && fs.existsSync(file)) continue
      if (!segment.provider_task_id) throw uncertain('已完成的超分片段文件丢失，请人工核对')
      db.prepare("UPDATE super_res_segments SET status = 'submitting' WHERE id = ?").run(segment.id)
      segment.status = 'submitting'
    }
    if (segment.status === 'submitting' && !segment.provider_task_id && isSeedVRDirectId(context.resumeTaskId)) {
      db.prepare('UPDATE super_res_segments SET provider_task_id = ? WHERE id = ?').run(context.resumeTaskId, segment.id)
      segment.provider_task_id = context.resumeTaskId
    }
    if (segment.status === 'submitting' && !segment.provider_task_id) {
      const error = new Error(`第 ${segment.position + 1} 段提交状态未知，请人工核对`)
      error.code = 'MG_SUBMIT_UNCERTAIN'
      throw error
    }
    if (!segment.input_url || !fs.existsSync(localMediaPath(segment.input_url) || '')) {
      const input = await makeInputClip(source, segment)
      db.prepare('UPDATE super_res_segments SET input_url = ? WHERE id = ?').run(input, segment.id)
      segment.input_url = input
    }
    context.onStage?.(`正在增强第 ${segment.position + 1}/${rows.length} 段`)
    db.prepare("UPDATE super_res_segments SET status = 'submitting' WHERE id = ?").run(segment.id)
    let generated
    try {
      generated = await seedvrDirect({
        videoUrl: segment.input_url, width: source.target.width, height: source.target.height,
        resumeTaskId: segment.provider_task_id || undefined,
        onSubmitted: (id) => db.transaction(() => {
          const task = db.prepare('SELECT status FROM ai_tasks WHERE id = ?').get(taskId)
          if (task?.status !== 'running') throw new Error('任务状态已变化')
          db.prepare('UPDATE super_res_segments SET provider_task_id = ? WHERE id = ?').run(id, segment.id)
          db.prepare('UPDATE ai_tasks SET provider_task_id = ?, stage = ? WHERE id = ?').run(id, `正在增强第 ${segment.position + 1}/${rows.length} 段`, taskId)
        }).immediate(),
        onProgress: () => context.onStage?.(`正在增强第 ${segment.position + 1}/${rows.length} 段`),
      })
      const file = localMediaPath(generated.videoUrl)
      const info = await probeMedia(file)
      const frames = await frameInfo(file)
      const aspectDiff = Math.abs((info.width / info.height) / (source.width / source.height) - 1)
      if (frames.count !== segment.frame_count || aspectDiff > 0.05 ||
          info.width < source.target.expectedWidth * 0.96 || info.height < source.target.expectedHeight * 0.96) {
        const error = new Error(`第 ${segment.position + 1} 段超分结果帧数或尺寸不正确`)
        error.code = 'MG_RESULT_INVALID'; error.taskId = generated.task_id
        throw error
      }
      db.transaction(() => {
        db.prepare("UPDATE super_res_segments SET status = 'completed', result_url = ?, provider_task_id = ? WHERE id = ?").run(generated.videoUrl, generated.task_id, segment.id)
        db.prepare('UPDATE ai_tasks SET provider_task_id = NULL WHERE id = ?').run(taskId)
      }).immediate()
    } catch (error) {
      if (['MG_TASK_FAILED', 'MG_CONNECTION_UNAVAILABLE', 'MG_RESULT_INVALID'].includes(error.code)) {
        if (generated?.videoUrl) cleanupFiles([generated.videoUrl])
        db.transaction(() => {
          db.prepare("UPDATE super_res_segments SET status = 'pending', provider_task_id = NULL WHERE id = ?").run(segment.id)
          db.prepare('UPDATE ai_tasks SET provider_task_id = NULL WHERE id = ?').run(taskId)
        }).immediate()
      }
      throw error
    }
  }
  rows = db.prepare('SELECT * FROM super_res_segments WHERE task_id = ? ORDER BY position').all(taskId)
  context.onStage?.('正在合成增强视频')
  const url = await joinEnhancedSegments(rows, source, context)
  return { provider: 'seedvr-direct', model: 'SeedVR2-3B', task_id: null, videoUrl: url, segmentCount: rows.length }
}

export function cleanupSuperResolutionSegments(taskId) {
  const rows = db.prepare('SELECT input_url, result_url FROM super_res_segments WHERE task_id = ?').all(taskId)
  db.prepare('DELETE FROM super_res_segments WHERE task_id = ?').run(taskId)
  cleanupFiles(rows.flatMap((row) => [row.input_url, row.result_url]))
}
