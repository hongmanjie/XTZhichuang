import db from '../db.js'
import crypto from 'crypto'
import { indexDoc } from './esService.js'
import { cleanupFiles } from '../utils/fileStore.js'
import {
  realEnabled, mgEnabled, mgVideoGen, mgImageGen, mgCancelTask,
  imageToJpegB64,
} from './aiProviders.js'
import { burnSubtitles, DEFAULT_SUBTITLE_STYLE } from './subtitleBurn.js'
import { ensureVideoCover, isUsableCover } from './videoCover.js'
import { h3FramesForDuration, h3Size, H3_FRAME_COUNTS } from './h3Spec.js'
import { generateLongVideo } from './longVideo.js'
import { dubVideo } from './indexTts.js'
import { analyzeVideo } from './videoAnalysis.js'
import { generateStudio } from './studio.js'
import { prepareReferenceVideo } from './replica.js'

// 无文字画面约束：视频生成模型第一段出片时禁绝一切画面文字/字幕，
// 字幕由 subtitleBurn 二段叠加，杜绝 AI 生成字幕的变形、乱码、闪烁问题
const NO_TEXT_CONSTRAINT = '尽量避免画面文字、字幕、字母、数字、水印和贴纸，人物嘴部动作自然，画面保持干净'

// ============================================================
// 数字人创作链路：模块化场景约束
//   场景背景（SCENE_TEMPLATES / 自定义描述）+ IP主播形象（结构化约束）
//   → qwen-image 生成首帧 → 首帧图生视频（i2av）→ 字幕叠加 + TTS 配音
// ============================================================

// 口播场景模板（竖版 9:16，适配电商/影棚/讲台/新闻等场景）
export const HUMAN_SCENE_TEMPLATES = {
  ecommerce: {
    key: 'ecommerce', name: '电商带货直播间', icon: '🛍️',
    desc: '现代电商直播间场景，暖色主灯+轮廓光，身后货架陈列商品与柔和促销氛围灯，竖版构图，浅景深背景虚化，主体突出',
  },
  studio: {
    key: 'studio', name: '专业影棚', icon: '📸',
    desc: '专业摄影棚场景，纯色渐变背景墙，环形补光灯与两侧柔光箱入画氛围，地面轻微反光，高级商业棚拍质感',
  },
  lecture: {
    key: 'lecture', name: '讲台知识分享', icon: '🎓',
    desc: '简约知识分享课堂场景，浅木色讲台，身后深色书架与绿植点缀，柔和顶光，学术专业氛围',
  },
  news: {
    key: 'news', name: '新闻主播间', icon: '📰',
    desc: '新闻演播室场景，深色主播台，身后大面积冷色调背景屏（无文字内容），专业冷光布光，权威新闻媒体质感',
  },
  boutique: {
    key: 'boutique', name: '高端精品店', icon: '💎',
    desc: '高端精品店内场景，大理石台面与金属陈列架，暖金色射灯，奢华购物氛围，浅景深',
  },
  outdoor: {
    key: 'outdoor', name: '户外实景', icon: '🌿',
    desc: '户外自然场景，柔和自然光，背景绿植与街道虚化，清新通透',
  },
}

// IP 主播形象结构化约束 → prompt 片段（保证跨视频形象一致性）
export function buildPersonaPrompt(persona = {}) {
  const gender = { female: '女性', male: '男性' }[persona.gender] || '女性'
  const age = persona.age || '25-35岁'
  const styleMap = {
    friendly: '亲切邻家', professional: '专业干练', energetic: '活力四射', elegant: '知性优雅', luxury: '高端贵气',
  }
  const style = styleMap[persona.style] || persona.style || '专业亲和'
  const outfit = persona.outfit || '得体的纯色职业装'
  const hair = persona.hair || '整洁利落'
  return [
    `${age}${gender}主播，真人写实风格`,
    `${style}的气质，穿着${outfit}`,
    `${hair}发型，妆容干净精致`,
    '半身构图正面面对镜头，目光直视镜头，亲和自然微笑，口型自然',
  ].join('，')
}

// 场景 + 形象 → 首帧/视频统一 prompt
export function buildHumanScenePrompt({ text, sceneKey, sceneDesc, persona, humanName } = {}) {
  const scene = sceneDesc || HUMAN_SCENE_TEMPLATES[sceneKey]?.desc || ''
  const personaPart = persona ? buildPersonaPrompt(persona) : `一位${persona?.humanName || '专业'}的主播，真人写实风格`
  const parts = [personaPart]
  if (humanName) parts.push(`主播形象风格：${String(humanName).slice(0, 40)}`)
  if (scene) parts.push(`身处${scene}`)
  if (text) parts.push(`正在面对镜头口播讲述：「${String(text).slice(0, 120)}」`)
  parts.push('真实摄影质感，商业布光，主体清晰')
  parts.push(NO_TEXT_CONSTRAINT)
  return parts.join('。')
}

// ============================================================
// AI 任务引擎：视频和图片走 ModelGate，配音走配置的 IndexTTS，
// 任务状态流转：排队、运行、成功、失败或上游待核对
// 新任务仅在真实处理完成时标记成功。
// ============================================================

const AI_TASK_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.AI_TASK_CONCURRENCY) || 1))
const TTS_TASK_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.TTS_TASK_CONCURRENCY) || 1))
let queueWakeScheduled = false

// 生成任务编号
function genTaskNo(module) {
  const prefix = { replica: 'FK', factory: 'MG', studio: 'SP', materialField: 'SC', analysis: 'JX', human: 'SM', mix: 'JJ', humanAsset: 'HC' }[module] || 'AI'
  return `${prefix}${Date.now()}${crypto.randomInt(1000, 9999)}`
}

// 各模块文案模板
const RESULT_TEMPLATES = {
  replica: {
    title: '爆款复刻成片',
    desc: '智能拆解原视频节奏与镜头语言，AI自动复刻生成同款结构新视频',
    scenes: ['黄金3秒钩子', '痛点场景演绎', '产品卖点特写', '使用效果对比', '促销行动号召'],
  },
  factory: {
    title: 'AI梦工厂成片',
    desc: '一张产品图片，AI延展生成完整带货短视频',
    scenes: ['产品亮相', '场景化展示', '细节特写', '氛围渲染', '购买引导'],
  },
  studio: {
    title: 'AI商拍大片',
    desc: '一键生成影棚级商品图，多角度多场景呈现',
    scenes: ['主图白底', '场景氛围图', '细节特写', '模特上身图', '节日营销图'],
  },
  materialField: {
    title: 'AI素材场成片',
    desc: '爆款Agent复刻翻拍同款素材，批量产出投放素材',
    scenes: ['口播开场', '产品展示', '痛点引入', '解决方案', '结尾引导'],
  },
  analysis: {
    title: '视频解析报告',
    desc: '深度解析视频内容结构、节奏、话术与转化点',
    scenes: ['结构拆解', '话术脚本', '节奏分析', 'BGM建议', '翻拍指南'],
  },
  human: {
    title: '数字人视频',
    desc: '百变数字人口播视频，多形象多风格快速生成',
    scenes: ['数字人开场', '产品介绍', '优惠讲解', '互动引导', '结束语'],
  },
  humanAsset: {
    title: '数字人创作资产',
    desc: '场景背景与IP主播形象模块化创作，产出场景约束的口播首帧',
    scenes: ['场景约束', '形象约束', '首帧合成', '一致性校验'],
  },
  voiceDub: { title: '配音视频', desc: '使用授权音色合成语音并配入视频', scenes: [] },
  videoAnalysis: { title: '视频文字与语音解析', desc: '识别视频中的语音和抽帧文字', scenes: [] },
  mix: {
    title: '智能混剪成片',
    desc: 'AI一键混剪成片',
    scenes: ['开场', '主体', '收尾'],
  },
}

// 创建AI任务
export function createTask(ownerId, module, params, pointsCost = 0) {
  const taskNo = genTaskNo(module)
  const tpl = RESULT_TEMPLATES[module] || { title: 'AI生成结果', desc: '', scenes: [] }
  const taskId = db.transaction(() => {
    reservePoints(ownerId, module, pointsCost, taskNo)
    return db.prepare(`INSERT INTO ai_tasks
      (task_no, module, title, params, status, progress, points_cost, owner_id, idempotency_key, billing_state, stage)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, 'reserved', '排队等待')`)
      .run(taskNo, module, params.title || tpl.title, JSON.stringify(params), pointsCost, ownerId, crypto.randomUUID()).lastInsertRowid
  }).immediate()
  scheduleQueue()
  return getTask(taskId)
}

function reservePoints(ownerId, module, pointsCost, taskNo) {
  if (pointsCost <= 0) return
  const changed = db.prepare('UPDATE users SET ai_points = ai_points - ? WHERE id = ? AND ai_points >= ?').run(pointsCost, ownerId, pointsCost)
  if (!changed.changes) {
    const error = new Error('AI点数不足，请联系管理员')
    error.code = 'INSUFFICIENT_POINTS'
    throw error
  }
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(ownerId, module, 'AI生成', -pointsCost, taskNo)
}

function refundReserved(task) {
  if (task.billing_state !== 'reserved') return
  if (task.points_cost > 0) {
    db.prepare('UPDATE users SET ai_points = ai_points + ? WHERE id = ?').run(task.points_cost, task.owner_id)
    db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
      .run(task.owner_id, task.module, '任务退款', task.points_cost, task.task_no)
  }
  db.prepare("UPDATE ai_tasks SET billing_state = 'refunded' WHERE id = ? AND billing_state = 'reserved'").run(task.id)
}

function claimNextTask() {
  return db.transaction(() => {
    const active = db.prepare("SELECT SUM(CASE WHEN module = 'voiceDub' THEN 1 ELSE 0 END) AS speech, SUM(CASE WHEN module <> 'voiceDub' THEN 1 ELSE 0 END) AS model FROM ai_tasks WHERE status = 'running'").get()
    const speechAvailable = Number((active.speech || 0) < TTS_TASK_CONCURRENCY)
    const modelAvailable = Number((active.model || 0) < AI_TASK_CONCURRENCY)
    if (!speechAvailable && !modelAvailable) return null
    const task = db.prepare("SELECT id FROM ai_tasks WHERE status = 'pending' AND ((? = 1 AND module = 'voiceDub') OR (? = 1 AND module <> 'voiceDub')) ORDER BY id LIMIT 1").get(speechAvailable, modelAvailable)
    if (!task) return null
    db.prepare("UPDATE ai_tasks SET status = 'running', progress = 0, stage = ? WHERE id = ? AND status = 'pending'")
      .run('正在提交或查询模型任务', task.id)
    return getTask(task.id)
  }).immediate()
}

function scheduleQueue() {
  if (queueWakeScheduled) return
  queueWakeScheduled = true
  setImmediate(() => {
    queueWakeScheduled = false
    try {
      let task
      while ((task = claimNextTask())) startTask(task)
    } catch (error) { console.error(`[AI队列] 调度失败: ${error.message}`) }
  })
}

function startTask(task) {
  const { id: taskId, module, params } = task
  const tpl = RESULT_TEMPLATES[module] || { title: task.title, desc: '', scenes: [] }
  const context = {
    taskId,
    ownerId: task.owner_id,
    idempotencyKey: task.idempotency_key,
    resumeTaskId: task.provider_task_id,
    onSubmitted: (providerId) => db.prepare("UPDATE ai_tasks SET provider_task_id = ?, stage = '模型生成中' WHERE id = ? AND status = 'running'").run(providerId, taskId),
    onProgress: (status) => db.prepare("UPDATE ai_tasks SET stage = ? WHERE id = ? AND status = 'running'").run(status === 'queued' ? '模型排队中' : status === 'canceling' ? '正在取消，等待上游确认' : '模型生成中', taskId),
    onStage: (stage) => db.prepare("UPDATE ai_tasks SET stage = ? WHERE id = ? AND status = 'running'").run(stage, taskId),
  }
  runRealTask(module, params, tpl, context)
    .then((result) => postProcess(module, params, result, context))
    .then((result) => withCovers(result))
    .then(async (result) => {
      try { await finishTask(taskId, result, module) } catch (cause) {
        const error = new Error('模型已返回结果，但保存作品失败；可重新检查结果')
        error.code = 'MG_TASK_UNCERTAIN'; error.cause = cause; throw error
      }
    })
    .catch((err) => {
      console.warn(`[AI任务 ${taskId}] ${err.message}`)
      db.transaction(() => {
        const current = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(taskId)
        if (!current || current.status !== 'running') return
        if (['MG_TASK_UNCERTAIN', 'MG_SUBMIT_UNCERTAIN', 'TTS_UNCERTAIN'].includes(err.code) || (current.provider_task_id && !['MG_TASK_FAILED', 'MG_TASK_CANCELLED'].includes(err.code))) {
          db.prepare("UPDATE ai_tasks SET status = 'reconciling', error = ?, stage = '上游状态待核对', provider_task_id = COALESCE(provider_task_id, ?) WHERE id = ?")
            .run(String(err.message).slice(0, 300), err.taskId || null, taskId)
        } else {
          refundReserved(current)
          const status = err.code === 'MG_TASK_CANCELLED' ? 'canceled' : 'failed'
          db.prepare("UPDATE ai_tasks SET status = ?, error = ?, stage = ?, finished_at = datetime('now','localtime') WHERE id = ?")
            .run(status, String(err.message).slice(0, 300), status === 'canceled' ? '已取消' : '生成失败', taskId)
        }
      }).immediate()
    })
    .finally(scheduleQueue)
}

// Single-server recovery: an upstream task ID is resumed; uncertain submissions are never repeated.
export function recoverAiTasks() {
  db.transaction(() => {
    db.prepare("UPDATE ai_tasks SET status = 'pending', stage = '恢复查询上游任务' WHERE status = 'running' AND provider_task_id IS NOT NULL AND idempotency_key IS NOT NULL").run()
    db.prepare(`UPDATE ai_tasks SET status = 'pending', stage = '恢复长视频制作'
      WHERE status = 'running' AND module IN ('materialField', 'factory', 'replica') AND json_valid(params)
      AND CAST(json_extract(params, '$.duration') AS REAL) > 8
      AND (module <> 'replica' OR EXISTS (SELECT 1 FROM long_video_segments s WHERE s.task_id = ai_tasks.id))
      AND NOT EXISTS (SELECT 1 FROM long_video_segments s WHERE s.task_id = ai_tasks.id AND s.status = 'submitting')`).run()
    db.prepare("UPDATE ai_tasks SET status = 'reconciling', stage = '上游状态待核对', error = '服务重启时提交状态未知，请联系管理员核对' WHERE status = 'running'").run()
  }).immediate()
  scheduleQueue()
}

// 数字人视频可选接入用户授权的 IndexTTS 音色及后期字幕。
// 后处理失败时保留已生成的画面，并向用户展示未完成的部分。
async function postProcess(module, params, result, context) {
  if (module !== 'human' || !result?.videos?.length || !params.text) return result
  const wantsSubtitle = params.subtitle?.enabled !== false
  const voiceId = params.voiceProfileId || null
  if (!wantsSubtitle && !voiceId) return result
  const style = params.subtitle?.style || DEFAULT_SUBTITLE_STYLE
  const warnings = [...(result.warnings || [])]
  let dubbedCount = 0
  let burnedCount = 0
  for (const v of result.videos) {
    let subtitleBurned = false
    if (voiceId) {
      context.onStage('正在合成配音')
      try {
        const dubbed = await dubVideo(context.ownerId, { videoUrl: v.url, voiceId, text: params.text, mode: 'replace', speed: 1, lang: 'zh', subtitle: wantsSubtitle })
        Object.assign(v, dubbed.videos[0], { dubbed: true, subtitleBurned: !!dubbed.subtitle?.burned })
        dubbedCount++
        subtitleBurned = !!dubbed.subtitle?.burned
      } catch (error) {
        console.warn(`[数字人] IndexTTS 配音失败，保留原片: ${error.message}`)
        warnings.push(`配音未完成，已保留生成画面：${error.message}`)
      }
    }
    if (wantsSubtitle && !subtitleBurned) {
      context.onStage('正在添加字幕')
      try {
        Object.assign(v, await burnSubtitles(v.url, { text: params.text, style, burn: true }))
        subtitleBurned = !!v.subtitleBurned
      } catch (error) {
        console.warn(`[数字人] 字幕叠加失败，保留原片: ${error.message}`)
      }
    }
    if (subtitleBurned) burnedCount++
  }
  if (wantsSubtitle && !burnedCount) warnings.push('字幕叠加未完成')
  result.subtitle = wantsSubtitle ? { enabled: burnedCount > 0, burnedCount, timing: 'estimated' } : { enabled: false }
  result.voice = voiceId ? { provider: 'IndexTTS', dubbed: dubbedCount > 0 } : null
  result.warnings = warnings
  return result
}

// 封面补齐：为每条成片用 ffmpeg 截取真实封面帧。
// 历史上 cover 是 .mp4→.jpg 字符串替换拼出来的假路径（404 黑屏）或视频 URL 冒充，均在此修正；
// 截帧失败时置空 cover，前端以 video 首帧兜底，绝不再渲染无效 poster
async function withCovers(result) {
  for (const v of result?.videos || []) {
    if (!v?.url || isUsableCover(v.cover)) continue
    try {
      const cover = await ensureVideoCover(v.url)
      v.cover = cover || ''
    } catch {
      v.cover = ''
    }
  }
  return result
}

// 模块 → 素材分类名（生成物自动归档到资产库）
const MODULE_CATEGORY = {
  replica: 'AI爆款复刻', factory: 'AI梦工厂', studio: 'AI商拍',
  materialField: 'AI素材场', human: '数字人', mix: '智能混剪', analysis: 'AI解析', voiceDub: '配音视频',
}

async function finishTask(taskId, result, module) {
  const toIndex = []
  db.transaction(() => {
  const cur = db.prepare('SELECT status FROM ai_tasks WHERE id = ?').get(taskId)
  if (!cur || cur.status !== 'running') return
  db.prepare("UPDATE ai_tasks SET status = 'success', progress = 100, result = ?, stage = '已完成', billing_state = CASE WHEN billing_state = 'reserved' THEN 'settled' ELSE billing_state END, finished_at = datetime('now','localtime') WHERE id = ?")
    .run(JSON.stringify(result), taskId)
  const task = getTask(taskId)

  // 创作链路资产单独入 human_assets（场景背景/IP形象/首帧，供数字人创作链路复用）
  if (module === 'humanAsset' && result.asset?.url) {
    db.prepare(`INSERT INTO human_assets (type, name, url, prompt, meta, owner_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(result.asset.type || 'scene', task.title, result.asset.url, result.asset.prompt || '', JSON.stringify(result.asset.meta || {}), task.owner_id)
  }

  const videos = result.videos || []
  const images = result.images || []
  if (!videos.length && !images.length) return

  // 生成作品记录（类型按实际内容：图集→image，视频→video）
  const isVideo = videos.length > 0
  db.prepare(`INSERT INTO works (name, type, url, cover, duration, source_module, source_id, owner_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      task.title,
      isVideo ? 'video' : 'image',
      videos[0]?.url || images[0]?.url,
      videos[0]?.cover || images[0]?.url,
      videos[0]?.duration || 0,
      module, taskId, task.owner_id,
    )

  // 全部生成物自动入素材库（source='ai'），资产库可统一管理/删除；真实生成记录输出模型（mock 降级非模型产物不标 model）
  const category = MODULE_CATEGORY[module] || 'AI生成'
  const realModel = result.engine === 'real' ? (result.model || null) : null
  const engine = result.engine || ''
  const insMat = db.prepare(`INSERT INTO materials (name, type, url, cover, duration, category, tags, owner_id, source, model, engine)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?)`)
  for (const [i, v] of videos.entries()) {
    const info = insMat.run(`${task.title}_${i + 1}`, 'video', v.url, v.cover || '', v.duration || 0,
      category, JSON.stringify(['AI生成', category]), task.owner_id, realModel, engine)
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid)
    if (row) toIndex.push(row)
  }
  for (const [i, img] of images.entries()) {
    const info = insMat.run(`${task.title}_${i + 1}`, 'image', img.url, img.url, 0,
      category, JSON.stringify(['AI生成', category]), task.owner_id, realModel, engine)
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid)
    if (row) toIndex.push(row)
  }
  }).immediate()
  for (const row of toIndex) indexMaterial(row)
}

// ---------- 真实AI执行器 ----------
async function runRealTask(module, params, tpl, context) {
  if (module === 'voiceDub') return dubVideo(context.ownerId, params)
  if (!realEnabled()) throw new Error('真实AI未启用')
  if (module === 'videoAnalysis') return analyzeVideo(params, context.onStage)

  switch (module) {
    case 'replica': {
      const { reference, prompt } = await prepareReferenceVideo(params, context)
      const marked = db.prepare("UPDATE ai_tasks SET params = json_set(params, '$.referencePhase', 'generating') WHERE id = ? AND status = 'running'").run(context.taskId)
      if (marked.changes !== 1) throw new Error('任务状态已变化')
      const refs = params.firstFrame ? [{ role: 'first', type: 'image', url: params.firstFrame }] : []
      const result = Number(params.duration) > 8
        ? await generateLongVideo(context.taskId, { prompt, duration: Number(params.duration), ratio: params.ratio, resolution: params.resolution, refs })
        : await genVideoByFrames({ prompt, firstFrame: params.firstFrame, duration: Number(params.duration), size: h3Size(params.ratio, params.resolution), context })
      return { ...result, title: '参考文案生成视频', reference,
        warnings: [...(reference.warnings || []), '只参考原视频识别出的语音和文字，未理解或复制画面、动作、镜头和音乐；识别结果可能有误。'] }
    }
    case 'factory':
      if (Number(params.duration) > 8) return generateLongVideo(context.taskId, {
        prompt: params.prompt || '以这张产品图为主角生成带货短视频', duration: Number(params.duration), ratio: '9:16', resolution: '720P',
        refs: [{ role: 'first', type: 'image', url: params.imageUrl }],
      })
      return genVideoByFrames({ firstFrame: params.imageUrl, prompt: params.prompt || '以这张产品图为主角生成带货短视频', duration: Number(params.duration || 4), context })
    case 'studio':
      return generateStudio(params, context)
    case 'materialField': {
      if (Number(params.duration) > 8) return generateLongVideo(context.taskId, params)
      const refs = Array.isArray(params.refs) ? params.refs : []
      const first = refs.find((r) => r.role === 'first') || (refs.length === 1 && !refs[0].role ? refs[0] : null)
      const last = refs.find((r) => r.role === 'last')
      return genVideoByFrames({ firstFrame: first?.url, lastFrame: last?.url, prompt: params.prompt,
        duration: Number(params.duration), size: h3Size(params.ratio, params.resolution), context })
    }
    case 'human': {
      // 场景约束口播：有首帧 → 首帧图生视频（i2av，形象/场景一致性最强）；
      // 无首帧 → 场景+形象约束的文生视频（t2av）
      const prompt = buildHumanScenePrompt({
        text: params.text,
        sceneKey: params.sceneKey,
        sceneDesc: params.sceneDesc,
        persona: params.persona || null,
        humanName: params.humanName,
      })
      const size = h3Size('9:16', '720P')
      // 时长随文案自动推算（之前固定 124 帧≈5s，长文案念不完导致配音截断/成片无声）
      const numFrames = pickFramesForText(params.text)
      // H3 音视频氛围：安静室内、无背景音乐无人声，保证 TTS 配音干净可混
      const audioOpts = { soundscape: '极安静的专业演播室，轻微空间底噪，无任何背景音乐，无任何人声', music: '无' }
      return genVideoByFrames({ firstFrame: params.firstFrame, prompt, size, frames: numFrames, audioOpts, context })
    }
    case 'humanAsset': {
      // 创作链路资产：scene=场景背景 / persona=IP形象 / firstFrame=人物+场景合成首帧
      const assetType = params.assetType || 'scene'
      if (assetType === 'scene') {
        const sceneDesc = params.sceneDesc || HUMAN_SCENE_TEMPLATES[params.sceneKey]?.desc || HUMAN_SCENE_TEMPLATES.ecommerce.desc
        const prompt = `${sceneDesc}。空镜无人，竖版9:16构图，真实摄影质感，8K画质，商业级布光，主体空间留白供人物站位。${NO_TEXT_CONSTRAINT}`
        const out = await genAssetImage(prompt, [736, 1280], context)
        return { ...out, assetType, asset: { type: 'scene', url: out.images[0]?.url, prompt, meta: { sceneKey: params.sceneKey || 'custom', sceneDesc } } }
      }
      if (assetType === 'persona') {
        const prompt = `${buildPersonaPrompt(params.persona)}。干净浅灰纯色影棚背景，棚拍布光，竖版9:16半身构图。真实摄影质感，8K画质。${NO_TEXT_CONSTRAINT}`
        const out = await genAssetImage(prompt, [736, 1280], context)
        return { ...out, assetType, asset: { type: 'persona', url: out.images[0]?.url, prompt, meta: { persona: params.persona || {} } } }
      }
      // firstFrame：IP形象图（若有）为基底保人物一致性，qwen 多模态置入场景；否则联合文生图
      const sceneDesc = params.sceneDesc || HUMAN_SCENE_TEMPLATES[params.sceneKey]?.desc || ''
      const prompt = buildHumanScenePrompt({ text: params.text, sceneDesc, persona: params.persona || {} })
      if (params.personaUrl) {
        throw new Error('当前图片模型不支持以人物参考图编辑首帧，请先选择文生形象')
      }
      const out = await genAssetImage(prompt, [736, 1280], context)
      return { ...out, assetType, asset: { type: 'firstFrame', url: out.images[0]?.url, prompt, meta: { sceneKey: params.sceneKey || 'custom', sceneDesc, persona: params.persona || {} } } }
    }
    case 'mix':
      throw new Error('素材混剪暂未接入真实剪辑流程')
    case 'analysis':
      throw new Error('视频解析需要接入真实视频理解能力，目前暂不可用')
    default:
      throw new Error(`模块 ${module} 暂无真实AI实现`)
  }
}

// 当前网关图像模型仅支持文生图，不接受参考图编辑。
async function genAssetImage(prompt, size = [736, 1280], context = {}) {
  if (!mgEnabled()) throw new Error('ModelGate 未启用')
  const out = await mgImageGen({ prompt, size, ...context })
  const images = out.images || []
  if (!images.length) throw new Error('资产图生成失败')
  return {
    title: '数字人创作资产',
    engine: 'real',
    provider: 'modelgate',
    model: process.env.MODELGATE_IMAGE_MODEL || 'Qwen-Image-2.1-Turbo',
    generatedAt: new Date().toISOString(),
    images: images.map((url, i) => ({ name: `资产图_${i + 1}`, url, resolution: `${size[0]}x${size[1]}` })),
  }
}

// 按口播文案字数推算视频帧数，使用网关公布的合法帧数。
// 中文口播约 4 字/秒，fps=24 → 目标秒数映射到向上最近合规帧数，保证文案念得完
function pickFramesForText(text, fps = 24) {
  const chars = String(text || '').replace(/\s+/g, '').length
  if (!chars) return H3_FRAME_COUNTS[0]
  const needSec = chars / 4.0 + 0.6
  const needFrames = Math.ceil(needSec * fps)
  const frames = H3_FRAME_COUNTS.find((f) => f >= needFrames)
  if (!frames) throw new Error('口播文案超过单段视频时长，请缩短文案或使用长视频')
  return frames
}

async function genVideoByFrames({ prompt, firstFrame, lastFrame, size = h3Size('9:16', '720P'), duration, frames, audioOpts = {}, context = {} }) {
  if (!mgEnabled()) throw new Error('ModelGate 未启用')
  const imageSrc = firstFrame ? (context.resumeTaskId ? firstFrame : await imageToJpegB64(firstFrame)) : undefined
  const lastFrameSrc = lastFrame ? (context.resumeTaskId ? lastFrame : await imageToJpegB64(lastFrame)) : undefined
  const task = firstFrame ? (lastFrame ? 'fl2av' : 'i2av') : (lastFrame ? 'l2av' : 't2av')
  const out = await mgVideoGen({ prompt, task, size, num_frames: frames || h3FramesForDuration(duration || 4), imageSrc, lastFrameSrc,
    targetDuration: duration, ...audioOpts, ...context })
  return normalizeVideoResult(out, prompt)
}

// 统一视频结果结构
function normalizeVideoResult(out, prompt) {
  const result = {
    title: 'AI生成视频',
    desc: prompt.slice(0, 80),
    engine: 'real',
    provider: out.provider,
    model: out.model,
    generatedAt: new Date().toISOString(),
    scenes: [],
    videos: [],
    images: [],
  }
  if (out.videos?.length) {
    result.videos = out.videos.map((v, i) => ({
      name: `成片_${i + 1}`,
      url: v.url,
      cover: '', // 真实封面由 withCovers 用 ffmpeg 截帧生成，不在此拼假路径
      duration: v.duration,
      width: v.width,
      height: v.height,
      resolution: `${v.width}x${v.height}`,
    }))
  }
  if (out.images?.length) {
    result.images = out.images.map((url, i) => ({ name: `配图_${i + 1}`, url, resolution: 'auto' }))
  }
  return result
}

function parseTask(task) {
  if (!task) return task
  task.params = JSON.parse(task.params || '{}')
  if (task.result) {
    task.result = JSON.parse(task.result)
    const warnings = Array.isArray(task.result.warnings) ? [...task.result.warnings] : []
    if (task.result.engine === 'mock') warnings.push('该历史任务为模拟结果，不是真实模型成片。')
    else if (task.module === 'studio' && task.result.provider !== 'modelgate + ffmpeg') warnings.push('历史商拍未记录商品原图是否参与生成，无法确认商品保真。')
    else if (task.module === 'replica' && !task.result.reference) warnings.push('历史任务未保存参考视频的识别结果，无法确认是否真实参考原片。')
    if (warnings.length) task.result.warnings = [...new Set(warnings)]
  }
  return task
}

export function getTask(id) {
  return parseTask(db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id))
}

export function listTasks(ownerId, { module, status, pageNum = 1, pageSize = 10 }) {
  const conds = ['owner_id = ?']
  const args = [ownerId]
  if (module) { conds.push('module = ?'); args.push(module) }
  if (status) { conds.push('status = ?'); args.push(status) }
  const where = conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM ai_tasks WHERE ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM ai_tasks WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (pageNum - 1) * pageSize)
  list.forEach(parseTask)
  return { list, total }
}

// 重试失败任务（当前引擎下任务不会失败，仅恢复 running）
// 防御：running 状态直接返回，避免 interval 泄漏 + 双倍付费 API 调用
export function retryTask(id) {
  db.transaction(() => {
    const task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id)
    if (!task) throw new Error('任务不存在')
    if (task.status === 'reconciling') {
      if (task.module === 'replica' && !task.provider_task_id) {
        const phase = JSON.parse(task.params || '{}').referencePhase
        if (phase === 'analyzing' || phase === 'ready') {
          db.prepare("UPDATE ai_tasks SET status = 'pending', stage = '重新排队识别参考素材', error = NULL WHERE id = ?").run(id)
          return
        }
      }
      if (['voiceDub', 'videoAnalysis'].includes(task.module) && !task.provider_task_id) {
        db.prepare("UPDATE ai_tasks SET status = 'pending', stage = '重新排队', error = NULL WHERE id = ?").run(id)
        return
      }
      if (!task.provider_task_id) throw new Error('提交状态未知且没有上游任务编号，请联系管理员核对')
      db.prepare("UPDATE ai_tasks SET status = 'pending', stage = '恢复查询上游任务', error = NULL WHERE id = ?").run(id)
      return
    }
    if (!['failed', 'canceled'].includes(task.status)) throw new Error('当前任务状态不支持重新生成')
    reservePoints(task.owner_id, task.module, task.points_cost, task.task_no)
    db.prepare("UPDATE ai_tasks SET status = 'pending', progress = 0, error = NULL, result = NULL, finished_at = NULL, stage = '排队等待', provider_task_id = NULL, idempotency_key = ?, billing_state = 'reserved' WHERE id = ?")
      .run(crypto.randomUUID(), id)
  }).immediate()
  scheduleQueue()
  return getTask(id)
}

// 仍在执行或等待核对的任务需要保留上游标识，不能删除。
export function deleteTask(id) {
  const task = db.prepare('SELECT status, result FROM ai_tasks WHERE id = ?').get(id)
  if (task && !['success', 'failed', 'canceled'].includes(task.status)) throw new Error('进行中或待核对的任务不能删除')
  const segments = db.prepare('SELECT result_url, first_frame_url FROM long_video_segments WHERE task_id = ?').all(id)
  const r = db.prepare('DELETE FROM ai_tasks WHERE id = ?').run(id)
  if (task?.result) {
    try {
      const parsed = JSON.parse(task.result)
      const urls = [...(parsed.videos || []), ...(parsed.images || [])]
        .flatMap((x) => [x.url, x.cover])
      cleanupFiles(urls)
    } catch { /* result 非 JSON 忽略 */ }
  }
  cleanupFiles(segments.flatMap((segment) => [segment.result_url, segment.first_frame_url]))
  return r
}

// 取消任务
export async function cancelTask(id) {
  let task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id)
  if (!task) throw new Error('任务不存在')
  if (task.status === 'pending' && !task.provider_task_id) {
    db.transaction(() => {
      task = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id)
      if (task.status !== 'pending' || task.provider_task_id) throw new Error('任务状态已变化，请刷新后重试')
      refundReserved(task)
      db.prepare("UPDATE ai_tasks SET status = 'canceled', stage = '已取消', finished_at = datetime('now','localtime') WHERE id = ?").run(id)
    }).immediate()
    return { status: 'canceled' }
  }
  if (!['pending', 'running', 'reconciling'].includes(task.status)) throw new Error('当前任务状态不支持取消')
  if (task.module === 'voiceDub') throw new Error('配音已开始，暂不能取消')
  if (!task.provider_task_id) throw new Error('任务正在提交或处理结果，暂不能取消')
  const providerId = task.provider_task_id
  const upstream = await mgCancelTask(providerId)
  if (['cancelled', 'canceled'].includes(upstream.status)) {
    db.transaction(() => {
      const current = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id)
      if (!current || !['pending', 'running', 'reconciling'].includes(current.status) || current.provider_task_id !== providerId) return
      refundReserved(current)
      db.prepare("UPDATE long_video_segments SET status = 'pending', provider_task_id = NULL, idempotency_key = ? WHERE task_id = ? AND provider_task_id = ? AND status = 'submitting'").run(crypto.randomUUID(), id, providerId)
      db.prepare("UPDATE ai_tasks SET status = 'canceled', stage = '已取消', finished_at = datetime('now','localtime') WHERE id = ?").run(id)
    }).immediate()
    scheduleQueue()
    return { status: 'canceled' }
  }
  if (['succeeded', 'failed'].includes(upstream.status)) {
    db.prepare("UPDATE ai_tasks SET status = 'pending', stage = '恢复查询上游任务' WHERE id = ? AND status = 'reconciling' AND provider_task_id = ?").run(id, providerId)
    scheduleQueue()
    return { status: upstream.status }
  }
  if (upstream.status !== 'canceling' && upstream.cancelRequested !== true) throw new Error('上游未确认取消请求，请稍后重试')
  db.prepare("UPDATE ai_tasks SET stage = '正在取消，等待上游确认', status = CASE WHEN status = 'reconciling' THEN 'pending' ELSE status END WHERE id = ? AND status IN ('pending', 'running', 'reconciling') AND provider_task_id = ?").run(id, providerId)
  scheduleQueue()
  return { status: 'canceling' }
}

// 索引素材到ES
export function indexMaterial(m) {
  indexDoc('materials', {
    id: m.id, name: m.name, type: m.type, category: m.category,
    tags: JSON.parse(m.tags || '[]'), url: m.url, cover: m.cover,
    size: m.size, duration: m.duration, width: m.width, height: m.height,
    source: m.source, owner_id: m.owner_id, created_at: m.created_at,
  })
}
