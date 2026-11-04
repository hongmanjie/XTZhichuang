import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import db from '../db.js'
import { cleanupFiles } from '../utils/fileStore.js'
import { PRIVATE_DIR, synthesizeSpeech } from './indexTts.js'
import { applyLipSync } from './lipSync.js'
import { generateLongVideo } from './longVideo.js'
import { burnSubtitles } from './subtitleBurn.js'
import { bandTextDetected, repairSubtitleBand, subtitleRepairStatus } from './subtitleRepair.js'
import { timedSubtitleSegments, wordTimedSubtitleSegments } from './subtitleAlign.js'
import { humanWordAlignment } from './humanAlignment.js'
import { concatenateVideos, FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeAudio, probeMedia, runMedia } from './mediaTools.js'
import { HUMAN_POINTS_PER_SEGMENT, humanHasUnsafeLegacy720Plan, humanPlanFromSpeech, humanReservedSegments } from './humanSpec.js'
import { checkHumanSpeech } from './humanSpeechCheck.js'
import { splitHumanSpeech } from './humanSpeechSpec.js'
import { prepareHumanProductFrame } from './humanProduct.js'
import { chat } from './aiProviders.js'

function privateSpeech(name) {
  if (typeof name !== 'string' || !/^speech_[0-9a-f-]{36}\.wav$/i.test(name)) throw new Error('配音文件标识无效')
  return path.join(PRIVATE_DIR, name)
}

function taskUncertain(message, code = 'MG_TASK_UNCERTAIN') {
  const error = new Error(message)
  error.code = code
  return error
}

async function prepareSpeech(params, context) {
  let workflow = db.prepare('SELECT * FROM human_voice_workflows WHERE task_id = ?').get(context.taskId)
  if (workflow?.status === 'ready') {
    const audioPath = privateSpeech(workflow.speech_file)
    if (!fs.existsSync(audioPath)) throw taskUncertain('已生成的配音文件丢失，请核对任务')
    const audio = await probeAudio(audioPath)
    if (Math.abs(audio.duration - workflow.speech_duration) > 0.1) throw taskUncertain('已保存的配音时长不一致，请核对任务')
    const parts = db.prepare('SELECT * FROM human_speech_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
      .map((row) => ({ ...row, path: privateSpeech(row.speech_file) }))
    if (parts.some((part) => part.status !== 'ready' || !fs.existsSync(part.path))) throw taskUncertain('已保存的配音片段丢失，请核对任务')
    return { path: audioPath, duration: audio.duration, parts }
  }
  if (workflow && workflow.status !== 'segmenting') throw taskUncertain('配音提交状态未知，请核对后处理', 'TTS_UNCERTAIN')
  if (!workflow) {
    const parts = splitHumanSpeech(params.text)
    db.transaction(() => {
      db.prepare("INSERT INTO human_voice_workflows (task_id, status) VALUES (?, 'segmenting')").run(context.taskId)
      const insert = db.prepare("INSERT INTO human_speech_segments (task_id, position, text, status) VALUES (?, ?, ?, 'pending')")
      parts.forEach((text, index) => insert.run(context.taskId, index, text))
    }).immediate()
  }
  const rows = db.prepare('SELECT * FROM human_speech_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
  if (!rows.length || rows.map((row) => row.text).join('') !== params.text) throw taskUncertain('配音分段记录无效')
  for (const row of rows) {
    if (row.status === 'ready') {
      if (!fs.existsSync(privateSpeech(row.speech_file))) throw taskUncertain('已保存的配音片段丢失')
      continue
    }
    if (row.status !== 'pending') throw taskUncertain(`第 ${row.position + 1} 段配音提交状态未知，请先核对`, 'TTS_UNCERTAIN')
    db.prepare("UPDATE human_speech_segments SET status = 'submitting' WHERE task_id = ? AND position = ?").run(context.taskId, row.position)
    context.onStage('正在合成配音')
    let speech
    try {
      speech = await synthesizeSpeech(context.ownerId, { voiceId: params.voiceProfileId, text: row.text, speed: 1, lang: 'zh' }, { ...context, onStage: () => {} })
      db.transaction(() => {
        db.prepare("UPDATE human_speech_segments SET status = 'ready', speech_file = ?, speech_duration = ? WHERE task_id = ? AND position = ?")
          .run(path.basename(speech.path), speech.duration, context.taskId, row.position)
        db.prepare("UPDATE ai_tasks SET stage = ? WHERE id = ? AND status = 'running'").run(`配音已完成 ${row.position + 1}/${rows.length} 段`, context.taskId)
      }).immediate()
    } catch (error) {
      if (speech?.path) throw taskUncertain('配音已生成但保存状态未知，请人工核对', 'TTS_UNCERTAIN')
      if (!['TTS_UNCERTAIN', 'MG_TASK_UNCERTAIN'].includes(error.code)) {
        db.prepare("UPDATE human_speech_segments SET status = 'pending' WHERE task_id = ? AND position = ?").run(context.taskId, row.position)
      }
      throw error
    }
  }
  const completed = db.prepare('SELECT * FROM human_speech_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
    .map((row) => ({ ...row, path: privateSpeech(row.speech_file) }))
  const estimated = completed.reduce((sum, part) => sum + Number(part.speech_duration), 0)
  let audioPath = completed[0].path
  let joinedPath
  try {
    if (completed.length > 1) {
      context.onStage('正在拼接完整配音')
      joinedPath = path.join(PRIVATE_DIR, `speech_${crypto.randomUUID()}.wav`)
      const args = ['-y']
      for (const part of completed) args.push('-i', part.path)
      const filters = completed.map((_, index) => `[${index}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[a${index}]`).join(';')
      args.push('-filter_complex', `${filters};${completed.map((_, index) => `[a${index}]`).join('')}concat=n=${completed.length}:v=0:a=1[out]`,
        '-map', '[out]', '-c:a', 'pcm_s16le', joinedPath)
      await runMedia(FFMPEG, args, 180000)
      audioPath = joinedPath
    }
    const audio = await probeAudio(audioPath)
    if (Math.abs(audio.duration - estimated) > Math.max(0.15, estimated * 0.01)) throw new Error('合成配音长度与分段不一致')
    let cursor = 0
    const scale = audio.duration / estimated
    const timing = completed.map((part) => {
      const start = cursor
      cursor += Number(part.speech_duration) * scale
      return { text: part.text, start, end: cursor }
    })
    db.transaction(() => {
      db.prepare("UPDATE human_voice_workflows SET status = 'ready', speech_file = ?, speech_duration = ?, speech_timing = ? WHERE task_id = ?")
        .run(path.basename(audioPath), audio.duration, JSON.stringify(timing), context.taskId)
      db.prepare("UPDATE ai_tasks SET stage = '配音已生成' WHERE id = ? AND status = 'running'").run(context.taskId)
    }).immediate()
    return { path: audioPath, duration: audio.duration, parts: completed }
  } catch (error) {
    if (joinedPath) { try { fs.unlinkSync(joinedPath) } catch {} }
    throw error
  }
}

async function ensureVideoPlan(params, context, duration, prompt) {
  const existing = db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
  if (existing.length) {
    // Do not resubmit an old, still-pending 720P segment at a frame count
    // known to exhaust GPU memory. A new task recalculates reservation safely.
    if (humanHasUnsafeLegacy720Plan(params.resolution, existing)) {
      throw new Error('该 720P 旧任务的片段超过当前显存限制，请重新提交以自动分段')
    }
    return existing
  }
  const allowed = Number(params.reservedSegments) || humanReservedSegments(params.text, params.resolution)
  const durations = humanPlanFromSpeech(duration, allowed, params.resolution)
  // 商品一旦被拿起，下一段回锚又会回到桌面，形成“桌面→手持→桌面”的反复跳变。
  // 统一约束为商品留在桌面原位，段内表现与锚定图保持一致。
  let actions = durations.map(() => '商品始终保持在桌面原位不动，只用目光和手掌示意方向，不要拿起、不要移动、不要遮挡商品')
  if (params.productImage || params.productDesc) {
    context.onStage('正在规划展示动作')
    try {
      const workflow = db.prepare('SELECT speech_timing FROM human_voice_workflows WHERE task_id = ?').get(context.taskId)
      const speech = JSON.parse(workflow?.speech_timing || '[]')
      let cursor = 0
      const scenes = durations.map((seconds, index) => {
        const start = cursor
        cursor += seconds
        const text = speech.filter((item) => item.end > start && item.start < cursor).map((item) => item.text).join('').slice(0, 200)
        return { segment: index + 1, text: text || params.text.slice(0, 200) }
      })
      const reply = await chat([
        { role: 'system', content: '你是口播视频动作规划助手。根据每段文案，为主播设计一个简短、缓慢、自然的手势。只输出 JSON 对象，格式为 {"actions":["动作", ...]}，数量必须与段数相同。硬约束：商品始终保持在桌面原位，不得拿起、移动、翻转或遮挡商品；动作只能是目光示意、手掌摊开指向、轻微前倾或点头这类上半身动作。不要输出文案原句，不要添加商品事实、价格、功效、字幕、文字或水印，不要夸张运镜。' },
        { role: 'user', content: JSON.stringify(scenes) },
      ], { temperature: 0.2, max_tokens: 400 })
      const parsed = JSON.parse((String(reply).match(/\{[\s\S]*\}/) || [])[0] || '{}')
      if (Array.isArray(parsed.actions) && parsed.actions.length === durations.length && parsed.actions.every((action) => typeof action === 'string' && action.trim())) {
        actions = parsed.actions.map((action) => action.replace(/[\r\n]/g, ' ').trim().slice(0, 100))
      }
    } catch { /* Fixed, conservative movement remains available. */ }
  }
  db.transaction(() => {
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(context.taskId)
    if (!task || task.status !== 'running') throw new Error('数字人任务状态已变化')
    const actualCost = durations.length * HUMAN_POINTS_PER_SEGMENT
    if (task.points_cost > 0 && task.points_cost < actualCost) throw new Error('数字人任务预留点数不足')
    if (task.billing_state === 'reserved' && task.points_cost > actualCost) {
      const refund = task.points_cost - actualCost
      db.prepare('UPDATE users SET ai_points = ai_points + ? WHERE id = ?').run(refund, task.owner_id)
      db.prepare("INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, '未使用片段退款', ?, ?)").run(task.owner_id, task.module, refund, task.task_no)
      db.prepare('UPDATE ai_tasks SET points_cost = ? WHERE id = ?').run(actualCost, task.id)
    }
    const insert = db.prepare('INSERT INTO long_video_segments (task_id, position, duration, prompt, idempotency_key, soundscape, music) VALUES (?, ?, ?, ?, ?, ?, ?)')
    durations.forEach((seconds, index) => insert.run(context.taskId, index, seconds,
      `同一位人物在相同场景正面自然讲述，保持人物外貌、服装、光线与镜头一致；${actions[index]}；画面无字幕、文字、角标或贴纸。`,
      crypto.randomUUID(), '安静室内，无背景音乐和旁白', '无'))
    db.prepare('UPDATE human_voice_workflows SET video_duration = ? WHERE task_id = ?').run(durations.reduce((sum, n) => sum + n, 0), context.taskId)
  }).immediate()
  return db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
}

async function syncHumanClip(row, audioPath, offset, context) {
  const stored = db.prepare('SELECT result_url FROM human_lip_segments WHERE task_id = ? AND position = ?').get(context.taskId, row.position)
  if (stored?.result_url) {
    const file = localMediaPath(stored.result_url)
    if (file && fs.existsSync(file)) return stored.result_url
    throw taskUncertain('已完成的口型片段文件丢失，请核对任务')
  }
  const source = localMediaPath(row.result_url)
  if (!source || !fs.existsSync(source)) throw new Error('数字人视频片段不存在')
  const name = `human_lip_${crypto.randomUUID()}.mp4`
  const output = path.join(MEDIA_UPLOAD_DIR, name)
  const slice = path.join(PRIVATE_DIR, `human_slice_${crypto.randomUUID()}.wav`)
  let synced
  try {
    await runMedia(FFMPEG, ['-y', '-ss', String(offset), '-i', audioPath, '-t', String(row.duration),
      '-af', `apad,atrim=duration=${row.duration}`, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', slice], 120000)
    context.onStage('正在同步口型')
    try { synced = await applyLipSync(source, slice) }
    catch (cause) {
      if (cause.code === 'LIPSYNC_FAILED') {
        const error = new Error('口型同步失败，已保留完成的画面与配音，可重试：' + cause.message)
        error.code = 'MG_TASK_FAILED'; error.cause = cause; throw error
      }
      const error = taskUncertain('口型同步未完成，已保留任务状态供核对', 'LIPSYNC_UNCERTAIN')
      error.cause = cause
      throw error
    }
    await runMedia(FFMPEG, ['-y', '-i', synced.path, '-map', '0:v:0', '-t', String(row.duration), '-r', '24',
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', output], 300000)
    const result = await probeMedia(output)
    if (Math.abs(result.duration - row.duration) > 0.2) throw new Error('口型片段时长不正确')
    const url = `/uploads/${name}`
    db.prepare('INSERT INTO human_lip_segments (task_id, position, result_url) VALUES (?, ?, ?)').run(context.taskId, row.position, url)
    return url
  } catch (cause) {
    try { fs.unlinkSync(output) } catch {}
    if (cause.code === 'LIPSYNC_UNCERTAIN') throw cause
    if (synced) { const error = taskUncertain('口型服务已返回，但片段保存未完成，请核对任务', 'LIPSYNC_UNCERTAIN'); error.cause = cause; throw error }
    throw cause
  } finally {
    try { fs.unlinkSync(slice) } catch {}
    try { synced?.cleanup() } catch {}
  }
}

export async function generateHumanVideo(params, context, prompt) {
  const audio = await prepareSpeech(params, context)
  const speechCheck = await checkHumanSpeech(context.taskId, audio.path, params.text, context.onStage, audio.parts)
  if (audio.parts.length > 1 && speechCheck.status === 'review' && Number(speechCheck.similarity) < 0.65) {
    // Failed completed speech can be regenerated on retry, but never discard
    // a video plan or provider results that may already have been submitted.
    const previousVideo = db.prepare('SELECT 1 FROM long_video_segments WHERE task_id = ? LIMIT 1').get(context.taskId)
    if (!previousVideo) cleanupHumanVoiceWorkflow(context.taskId)
    throw new Error('配音识别与文案差异较大，已停止生成视频；请检查音色或重新生成')
  }
  const wordTimings = params.subtitle?.enabled !== false ? await humanWordAlignment(context.taskId, audio.path, context.onStage) : null
  context.onStage('正在规划数字人视频')
  await ensureVideoPlan(params, context, audio.duration, prompt)
  const productReference = await prepareHumanProductFrame(params, context, prompt)
  const refs = productReference.url ? [{ role: 'first', type: 'image', url: productReference.url }] : []
  // 画面里出现文字不再整段重生成：交给后面的字幕带修复处理，
  // 一次重生成要多等 45–75 秒，而修复只要几秒。
  // 全段锚定实测会让每段重复“从桌面拿起商品”，段边界必跳（任务 52/53/9003/9004）。
  // 只有在“纯人物、无商品”这种动作幅度极小的场景才开锚定；
  // 有商品时走链式，让第 2 段起延续上一段末帧的手持状态，避免拿起又放下。
  await generateLongVideo(context.taskId, { prompt, refs, ratio: '9:16', resolution: params.resolution || '540P', silentAudio: true, anchorFirstFrame: Boolean(productReference.url) && !params.productImage }, { segmentsOnly: true })
  const plannedRows = db.prepare('SELECT * FROM long_video_segments WHERE task_id = ? ORDER BY position').all(context.taskId)
  const rows = []
  for (const row of plannedRows) {
    const file = localMediaPath(row.result_url)
    if (!file || !fs.existsSync(file)) throw taskUncertain('已生成的人物片段丢失，请核对任务')
    const info = await probeMedia(file)
    rows.push({ ...row, duration: info.duration })
  }
  if (rows.reduce((sum, row) => sum + row.duration, 0) + 0.02 < audio.duration) throw taskUncertain('人物视频短于配音，不能截断完整文案')

  const warnings = []
  if (productReference.usedProduct) warnings.push('已将商品图加入首帧作为画面参考；生成过程可能改变商品细节、文字或标识，请检查成片。')
  if (speechCheck.status === 'review') warnings.push('语音识别与文案可能不一致，请试听成片并核对识别文字。')
  if (speechCheck.status === 'unavailable') warnings.push('未能完成语音内容自动核对，请试听成片。')

  // Keep VSR targeted to observed text and never add a second subtitle when
  // detection or repair is inconclusive. OCR and vision are sampled checks.
  // 只做一次带内粗检（每段 3 张图）决定要不要修；查不出来时按“可能有字”处理，
  // 照样修、照样加字幕，不让检测结果否决成片。
  const repair = { applied: false, reason: 'no_text', provider: 'vsr', segments: 0 }
  const repairUrls = []
  const textCheck = { status: 'clear', method: 'band_probe', samples: 0 }
  for (const row of rows) {
    let band = null
    try { band = await bandTextDetected(row.result_url) } catch { band = null }
    textCheck.samples += band?.samples || 0
    const detected = band?.detected === true
    const unknown = band === null
    if (!detected && !unknown) continue
    if (!subtitleRepairStatus().available) { repair.reason = 'not_configured'; continue }
    try {
      // 按“像字幕的框”逐个给区域，商品 logo 这类短方块不会被带进去
      const cleaned = await repairSubtitleBand(row.result_url, {
        onStage: context.onStage,
        areas: band?.areas || null,
      })
      if (cleaned.applied) {
        row.result_url = cleaned.url
        repairUrls.push(cleaned.url)
        repair.applied = true
        repair.segments += 1
        repair.reason = unknown ? 'repaired_uncertain' : 'repaired'
      }
    } catch (error) {
      repair.reason = 'failed'
      repair.error = String(error.message || error).slice(0, 200)
    }
  }
  if (repair.reason === 'failed') warnings.push('画面文字清理未完成，已保留原画面')
  if (!textCheck.samples) textCheck.status = 'unavailable'

  const videoUrls = []
  let offset = 0
  let joined = null
  let finalPath = null
  try {
    for (const row of rows) {
      const url = params.lipSync ? await syncHumanClip(row, audio.path, offset, context) : row.result_url
      videoUrls.push(url)
      offset += row.duration
    }
    context.onStage('正在合成数字人视频')
    const merged = videoUrls.length === 1 ? { url: videoUrls[0], ...(await probeMedia(localMediaPath(videoUrls[0]))) } : await concatenateVideos(videoUrls)
    if (videoUrls.length > 1) joined = localMediaPath(merged.url)
    const name = `human_${crypto.randomUUID()}.mp4`
    finalPath = path.join(MEDIA_UPLOAD_DIR, name)
    // H3 单段最短 124 帧（约 5.17 秒），短文案若按视频时长铺音频会留下大段静音。
    // 这里以配音长度为准裁掉多余画面，只在尾部留 0.35 秒收尾。
    const finalDuration = Math.min(merged.duration, Number((audio.duration + 0.35).toFixed(3)))
    await runMedia(FFMPEG, ['-y', '-i', localMediaPath(merged.url), '-i', audio.path, '-map', '0:v:0', '-map', '1:a:0',
      '-af', 'apad', '-t', String(finalDuration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', finalPath], 300000)
    let info = await probeMedia(finalPath)
    if (!info.hasAudio || info.duration + 0.02 < audio.duration) throw new Error('数字人配音合成后的时长不正确')
    let url = `/uploads/${name}`
    let cover = ''
    let subtitle = { enabled: false }
    if (params.subtitle?.enabled !== false) {
      context.onStage('正在添加字幕')
      // 用录音识别出的停顿排字幕；识别不可用时退回按字数估算
      const precise = wordTimedSubtitleSegments(params.text, wordTimings, audio.duration)
      const timed = precise?.segments || timedSubtitleSegments(params.text, speechCheck.segments, audio.duration)
      try {
        const rendered = await burnSubtitles(url, { text: params.text, segments: timed.length ? timed : null,
          style: params.subtitle?.style || 'pure', subtitleDuration: audio.duration })
        if (!rendered.subtitleBurned) throw new Error('字幕叠加失败')
        fs.unlinkSync(finalPath)
        finalPath = null
        url = rendered.url
        cover = rendered.cover || ''
        info = await probeMedia(localMediaPath(url))
        subtitle = { enabled: true, timing: precise ? 'word_timestamps' : timed.length ? (speechCheck.timingMethod === 'tts_segments' ? 'tts_segment_anchored' : 'asr_segment_estimated') : 'estimated', segments: timed.length, alignmentScore: precise?.similarity ?? null }
        if (!precise) warnings.push('字幕时间按语音片段估算，请检查口播与字幕是否同步。')
      } catch (error) {
        subtitle = { enabled: false, reason: 'burn_failed' }
        warnings.push('字幕没有加上：' + String(error.message || error).slice(0, 120))
      }
    }
    return { title: '数字人视频', engine: 'real', provider: 'modelgate', model: 'MiniMax-H3',
      generatedAt: new Date().toISOString(), humanPipeline: 'audio-first', qualityCheck: textCheck, speechCheck, subtitle, subtitleRepair: repair,
      productReference: { usedImage: productReference.usedProduct },
      voice: { provider: 'IndexTTS', dubbed: true, duration: audio.duration, segments: audio.parts.length || 1 },
      lipSync: { requested: params.lipSync === true, applied: params.lipSync === true },
      warnings, images: [], videos: [{ name: '数字人成片', url, cover, ...info, resolution: `${info.width}x${info.height}` }] }
  } catch (error) {
    if (finalPath) { try { fs.unlinkSync(finalPath) } catch {} }
    throw error
  } finally {
    if (joined) { try { fs.unlinkSync(joined) } catch {} }
    cleanupFiles(repairUrls)
  }
}

export function cleanupHumanVoiceWorkflow(taskId) {
  const workflow = db.prepare('SELECT speech_file FROM human_voice_workflows WHERE task_id = ?').get(taskId)
  const speechParts = db.prepare('SELECT speech_file FROM human_speech_segments WHERE task_id = ?').all(taskId)
  const productWork = db.prepare('SELECT * FROM human_product_workflows WHERE task_id = ?').get(taskId)
  const lips = db.prepare('SELECT result_url FROM human_lip_segments WHERE task_id = ?').all(taskId)
  const segments = db.prepare('SELECT result_url, first_frame_url FROM long_video_segments WHERE task_id = ?').all(taskId)
  db.transaction(() => {
    db.prepare('DELETE FROM human_lip_segments WHERE task_id = ?').run(taskId)
    db.prepare('DELETE FROM human_speech_segments WHERE task_id = ?').run(taskId)
    db.prepare('DELETE FROM human_product_workflows WHERE task_id = ?').run(taskId)
    db.prepare('DELETE FROM human_voice_workflows WHERE task_id = ?').run(taskId)
    db.prepare('DELETE FROM long_video_segments WHERE task_id = ?').run(taskId)
  }).immediate()
  for (const name of new Set([workflow?.speech_file, ...speechParts.map((row) => row.speech_file)].filter(Boolean))) { try { fs.unlinkSync(privateSpeech(name)) } catch {} }
  cleanupFiles([...lips.map((row) => row.result_url), ...segments.flatMap((row) => [row.result_url, row.first_frame_url]), productWork?.background_url, productWork?.cutout_url, productWork?.first_frame_url])
}
