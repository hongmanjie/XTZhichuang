import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { createTask, getTask, listTasks, retryTask, deleteTask, cancelTask, indexMaterial, HUMAN_SCENE_TEMPLATES } from '../services/aiEngine.js'
import { realEnabled, chat as unifiedChat } from '../services/aiProviders.js'
import { teamCond } from '../utils/teamScope.js'
import { localMediaPath, probeMedia } from '../services/mediaTools.js'
import { inspectStudioProduct } from '../services/studio.js'
import { cutoutProduct } from '../services/cutout.js'
import { MF_MODELS, mfCost } from '../services/materialPricing.js'
import { indexTtsStatus } from '../services/indexTts.js'
import { presetByVoiceId } from '../services/voicePresets.js'
import { lipSyncStatus } from '../services/lipSync.js'
import { HUMAN_MAX_TEXT_LENGTH, HUMAN_POINTS_PER_SEGMENT, humanReservedSegments } from '../services/humanSpec.js'
import fs from 'fs'

const router = express.Router()

// 模块配置
const MODULES = {
  replica: { name: '爆款复刻', point: 100, desc: '智能拆解并复刻热门视频内容' },
  factory: { name: 'AI梦工厂', point: 80, desc: '一张产品图片即可生成爆款' },
  studio: { name: 'AI商拍', point: 30, desc: '一键生成影棚级大片' },
  materialField: { name: 'AI素材场', point: 60, desc: '爆款Agent帮你复刻翻拍同款' },
  analysis: { name: '视频解析', point: 50, desc: '解析视频内容并提取创作信息' },
  human: { name: '百变数字人', point: 70, desc: '快速创建多样化数字人视频' },
  humanAsset: { name: '数字人创作资产', point: 20, desc: '场景背景/IP形象/合成首帧模块化创作' },
  mix: { name: '智能剪辑', point: 40, desc: 'AI一键混剪成片' },
}

// 模块配置信息
router.get('/create/modules', authRequired, (req, res) => {
  res.json(success(MODULES))
})

router.get('/create/module/:module/config', authRequired, (req, res) => {
  const mod = MODULES[req.params.module]
  if (!mod) return res.json(fail('模块不存在', 404))
  res.json(success(mod))
})

// ============ 爆款复刻 ============
router.post('/create/replica', authRequired, asyncHandler(async (req, res) => {
  const { videoUrl, firstFrame = null, prompt, duration = 8, ratio = '9:16', resolution = '540P', count = 1 } = req.body
  if (typeof videoUrl !== 'string' || !videoUrl) return res.json(fail('请上传参考视频', 400))
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1000) return res.json(fail('请填写 1–1000 字的新视频要求', 400))
  if (![4, 8, 15, 30, 60].includes(Number(duration)) || !['9:16', '16:9', '1:1'].includes(ratio) || !['540P', '720P'].includes(resolution) || Number(count) !== 1) return res.json(fail('视频参数无效', 400))
  const scope = teamCond(req.user.id)
  const video = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'video' AND ${scope.clause}`).get(videoUrl, ...scope.args)
  const videoPath = localMediaPath(videoUrl)
  if (!video || !videoPath || !fs.existsSync(videoPath)) return res.json(fail('参考视频不存在或无权使用', 400))
  let info
  try { info = await probeMedia(videoPath) } catch { return res.json(fail('参考视频文件无效', 400)) }
  if (info.duration > 120) return res.json(fail('参考视频暂支持不超过 120 秒', 400))
  if (firstFrame) {
    if (typeof firstFrame !== 'string') return res.json(fail('商品图片无效', 400))
    const image = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(firstFrame, ...scope.args)
    const imagePath = localMediaPath(firstFrame)
    if (!image || !imagePath || !fs.existsSync(imagePath)) return res.json(fail('商品图片不存在或无权使用', 400))
  }
  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  const cost = 50 + mfCost('MiniMax-H3', resolution, Number(duration))
  if (req.user.ai_points < cost) {
    return res.json(fail(`AI点数不足，本次创作需 ${cost} 点，请联系管理员`, 400))
  }
  const task = createTask(req.user.id, 'replica', { videoUrl, firstFrame, prompt: prompt.trim(), duration: Number(duration), ratio, resolution }, cost)
  res.json(success(task))
}))

// ============ AI梦工厂 ============
router.post('/create/factory', authRequired, asyncHandler(async (req, res) => {
  const { imageUrl, prompt, duration = 15, count = 1 } = req.body
  if (!imageUrl) return res.json(fail('请上传产品图片', 400))
  const scope = teamCond(req.user.id)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(imageUrl, ...scope.args)
  if (!material || !localMediaPath(imageUrl) || !fs.existsSync(localMediaPath(imageUrl))) return res.json(fail('产品图片不存在或无权使用', 400))
  if (![5, 10, 15, 30].includes(Number(duration)) || Number(count) !== 1) return res.json(fail('请选择支持的时长，每次生成一条视频', 400))
  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  if (req.user.ai_points < MODULES.factory.point) {
    return res.json(fail('AI点数不足，请联系管理员', 400))
  }
  const task = createTask(req.user.id, 'factory', { imageUrl, prompt, duration, count }, MODULES.factory.point)
  res.json(success(task))
}))

// ============ AI商拍 ============
router.post('/create/studio/prepare', authRequired, asyncHandler(async (req, res) => {
  const { imageUrl } = req.body
  if (typeof imageUrl !== 'string' || !imageUrl) return res.json(fail('请选择商品图片', 400))
  const scope = teamCond(req.user.id)
  const material = db.prepare(`SELECT id, name FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(imageUrl, ...scope.args)
  if (!material || !localMediaPath(imageUrl) || !fs.existsSync(localMediaPath(imageUrl))) return res.json(fail('商品图片不存在或无权使用', 400))
  try {
    await inspectStudioProduct(imageUrl)
    return res.json(success({ url: imageUrl, method: 'original', message: '已使用透明商品原图' }))
  } catch { /* Ordinary photos are processed by the local model below. */ }
  let cutout
  try { cutout = await cutoutProduct(imageUrl) } catch (error) { return res.json(fail(error.message, 400)) }
  try {
    const name = `${String(material.name || '商品图').slice(0, 90)} - 自动抠图.png`
    const inserted = db.prepare(`INSERT INTO materials (name,type,url,cover,size,category,tags,owner_id,source,model,engine)
      VALUES (?,'image',?,?,?,'AI商拍',?,?,'ai','U2NETP','real')`).run(name, cutout.url, cutout.url, cutout.size, JSON.stringify(['自动抠图', 'AI商拍']), req.user.id)
    const saved = db.prepare('SELECT * FROM materials WHERE id = ?').get(inserted.lastInsertRowid)
    if (saved) indexMaterial(saved)
    return res.json(success({ url: cutout.url, name, method: 'u2netp', message: '请检查商品主体，手或其他相邻物体可能被一并保留。' }))
  } catch (error) {
    const generated = localMediaPath(cutout.url)
    if (generated) { try { fs.unlinkSync(generated) } catch {} }
    throw error
  }
}))

router.post('/create/studio', authRequired, asyncHandler(async (req, res) => {
  const { imageUrl, prompt = '', count = 1 } = req.body
  if (typeof imageUrl !== 'string' || !imageUrl) return res.json(fail('请上传商品图片', 400))
  if (typeof prompt !== 'string' || prompt.length > 400 || Number(count) !== 1) return res.json(fail('商拍参数无效，每次生成一张图片', 400))
  const scope = teamCond(req.user.id)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(imageUrl, ...scope.args)
  if (!material) return res.json(fail('商品图片不存在或无权使用', 400))
  try { await inspectStudioProduct(imageUrl) } catch (error) { return res.json(fail(error.message, 400)) }
  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  if (req.user.ai_points < MODULES.studio.point) {
    return res.json(fail('AI点数不足，请联系管理员', 400))
  }
  const task = createTask(req.user.id, 'studio', { imageUrl, prompt: prompt.trim(), count: 1 }, MODULES.studio.point)
  res.json(success(task))
}))

// ============ AI素材场（深度复刻原站） ============
// 点数计价见 services/materialPricing.js

router.post('/create/materialField', authRequired, asyncHandler(async (req, res) => {
  const {
    prompt, refs = [], model = 'MiniMax-H3',
    ratio = '9:16', resolution = '720P', duration = 4, avatarId,
  } = req.body
  if (!prompt || !String(prompt).trim()) return res.json(fail('请输入创作描述或智能帮写提示词', 400))
  if (!Array.isArray(refs)) return res.json(fail('参考内容格式错误', 400))
  if (refs.length > 2 || refs.some((r) => r?.type !== 'image' || !['first', 'last'].includes(r?.role))) return res.json(fail('仅支持一张首帧和一张尾帧图片', 400))
  if (new Set(refs.map((r) => r.role)).size !== refs.length) return res.json(fail('首帧或尾帧不能重复', 400))
  const scope = teamCond(req.user.id)
  for (const ref of refs) {
    const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(ref.url, ...scope.args)
    const local = localMediaPath(ref.url)
    if (!material) return res.json(fail('首尾帧素材不存在或无权使用', 400))
    if (!local || !fs.existsSync(local)) return res.json(fail('首尾帧文件不存在', 400))
  }
  // 白名单校验（防止绕过前端直接传非法参数）
  if (!MF_MODELS.some((m) => m.key === model)) return res.json(fail('不支持的模型', 400))
  if (avatarId) return res.json(fail('当前模型不支持人物参考库，请上传首帧图片', 400))
  if (!['9:16', '16:9', '1:1'].includes(ratio)) return res.json(fail('不支持的画幅', 400))
  if (!['540P', '720P'].includes(resolution)) return res.json(fail('不支持的分辨率', 400))
  if (![4, 8, 15, 30, 60].includes(+duration)) return res.json(fail('请选择支持的视频时长', 400))

  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  const points = mfCost(model, resolution, duration)
  if (req.user.ai_points < points) {
    return res.json(fail(`AI点数不足，本次创作需 ${points} 点，请联系管理员`, 400))
  }
  const task = createTask(req.user.id, 'materialField', {
    prompt: String(prompt).trim().slice(0, 2000), refs: refs.map(({ role, url, name }) => ({ type: 'image', role, url, name })), model, ratio, resolution, duration: Number(duration),
  }, points)
  res.json(success(task))
}))

// 素材场配置（模型/参考模式/画幅/分辨率/时长/分类）
router.get('/mf/config', authRequired, (req, res) => {
  const categories = ['全部', '化妆品', '服装', '酒水', '家电', '食品', '饰品', '日用百货', '个护家清', '母婴宠物', '鞋类']
  res.json(success({
    models: MF_MODELS,
    refModes: [],
    ratios: ['9:16', '16:9', '1:1'],
    resolutions: ['540P', '720P'],
    durations: [4, 8, 15, 30, 60],
    categories,
  }))
})

// 案例库（分类筛选 + 播放量排序）
router.get('/mf/cases', authRequired, (req, res) => {
  const { category = '全部', sort = 'hot' } = req.query
  const conds = []
  const args = []
  if (category && category !== '全部') { conds.push('category = ?'); args.push(category) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const order = sort === 'new' ? 'id DESC' : 'play_count DESC, sort ASC'
  const list = db.prepare(`SELECT * FROM mf_cases ${where} ORDER BY ${order} LIMIT 60`).all(...args)
  res.json(success(list))
})

// IP 形象库
router.get('/mf/avatars', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM mf_avatars ORDER BY id ASC').all()
  list.forEach((a) => { a.tags = JSON.parse(a.tags || '[]') })
  res.json(success(list))
})

// 智能帮写提示词：真实 LLM 优先（支持 @图片1/@视频1 引用语法），失败降级模板拼接
router.post('/ai/mf/prompt', authRequired, asyncHandler(async (req, res) => {
  const { input = '', refs = [] } = req.body
  const refLabel = (r) => r.role === 'last' ? '尾帧图片' : '首帧图片'
  const refDesc = (Array.isArray(refs) ? refs : []).map(refLabel).join('、')
  let optimized = ''
  if (realEnabled()) {
    try {
      optimized = await unifiedChat([
        { role: 'system', content: `你是AI视频生成提示词帮写专家。保留用户意图，描述主体动作、镜头、场景和光线；若有首尾帧，仅说明画面应自然衔接，不使用 @图片 语法，也不要虚构商品功效。直接输出描述正文。` },
        { role: 'user', content: `${refDesc ? `参考素材：${refDesc}\n` : ''}创意描述：${input || '自由发挥一段有创意的短视频'}` },
      ], { temperature: 0.7, max_tokens: 600 })
    } catch (err) {
      return res.json(fail(`提示词生成失败：${err.message}`, 503))
    }
  }
  if (!optimized) return res.json(fail('AI 引擎未启用或未返回内容', 503))
  res.json(success({ optimized, engine: 'real' }))
}))

// ============ 视频解析 ============
router.post('/create/analysis', authRequired, asyncHandler(async (req, res) => {
  const { shareUrl } = req.body
  if (!shareUrl) return res.json(fail('请输入视频链接', 400))
  if (req.user.ai_points < MODULES.analysis.point) {
    return res.json(fail('AI点数不足，请联系管理员', 400))
  }
  const task = createTask(req.user.id, 'analysis', { shareUrl }, MODULES.analysis.point)
  res.json(success(task))
}))

// ============ 百变数字人 ============
// A draft is editable and is never sent to speech automatically.
router.post('/create/human/script-draft', authRequired, asyncHandler(async (req, res) => {
  const { topic, details = '', seconds = 15 } = req.body
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 120) return res.json(fail('请填写 1–120 字的主题或商品名称', 400))
  if (typeof details !== 'string' || details.length > 600) return res.json(fail('创作要求不能超过 600 字', 400))
  if (![10, 15, 30, 45].includes(Number(seconds))) return res.json(fail('请选择有效的目标时长', 400))
  const system = '你是中文短视频口播文案助手。用户输入是唯一允许的事实来源。严格只陈述用户明确写出的属性和数字；绝不推测或补充商品的手感、重量、装饰、用途、使用场景、人群、功效、价格、品质、认证、销量或其他事实。不要把常识或想象当成用户事实。可以使用不涉及商品属性的问候、连接和结束语，但不要凑字数。只输出可直接朗读的中文正文，不写标题、列表、分镜或括号说明，不超过200字。'
  const user = `主题或商品：${topic.trim()}\n用户明确给出的事实和要求：${details.trim() || '未提供更多事实'}\n目标时长约 ${Number(seconds)} 秒。如果事实不足以填满时长，可以更短；不确定的信息直接省略。`
  try {
    const content = String(await unifiedChat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.2, max_tokens: 600 })).trim()
    if (!content || content.length > 2000) return res.json(fail('AI 返回的文案无效，请重试', 503))
    return res.json(success({ content }, '文案已生成，请核对事实并修改'))
  } catch (error) { return res.json(fail('AI 写稿未完成：' + error.message, 503)) }
}))

router.post('/create/human', authRequired, asyncHandler(async (req, res) => {
  const { humanName, text, voice, voiceProfileId, count = 1, subtitle, firstFrame, productImage, productDesc, sceneKey, sceneDesc, persona, resolution = '540P', lipSync = false } = req.body
  if (typeof text !== 'string' || !text.trim()) return res.json(fail('请输入口播文案', 400))
  if (String(text).length > HUMAN_MAX_TEXT_LENGTH) return res.json(fail(`数字人口播文案最多 ${HUMAN_MAX_TEXT_LENGTH} 字，请缩短文案`, 400))
  if (Number(count) !== 1) return res.json(fail('每次只能生成一条数字人视频', 400))
  if (!['540P', '720P'].includes(resolution)) return res.json(fail('请选择有效的视频清晰度', 400))
  if (voice && !voiceProfileId) return res.json(fail('旧版预设音色已停用，请选择自己的授权音色', 400))
  if (!voiceProfileId && String(text).replace(/\s+/g, '').length > 35) return res.json(fail('超过 35 字的口播请先选择授权音色', 400))
  if (!voiceProfileId && resolution === '720P' && String(text).replace(/\s+/g, '').length > 18) return res.json(fail('720P 超过 18 字请先选择音色，系统会自动分段生成', 400))
  if (typeof lipSync !== 'boolean') return res.json(fail('口型同步选项无效', 400))
  if (lipSync && !voiceProfileId) return res.json(fail('请先选择授权音色，再启用口型同步', 400))
  if (lipSync && (await lipSyncStatus()).available === false) return res.json(fail('口型同步服务暂不可用，请稍后重试或关闭同步', 503))
  if (voiceProfileId) {
    const preset = presetByVoiceId(voiceProfileId)
    if (!preset && (!Number.isSafeInteger(Number(voiceProfileId)) || Number(voiceProfileId) < 1)) return res.json(fail('音色参数无效', 400))
    if (!preset && !db.prepare('SELECT id FROM voice_profiles WHERE id = ? AND owner_id = ?').get(Number(voiceProfileId), req.user.id)) return res.json(fail('请选择自己上传的音色', 400))
    const speech = await indexTtsStatus()
    if (speech.available === false) return res.json(fail('配音服务暂时不可连接，请稍后重试', 503))
  }
  if (firstFrame) {
    const scope = teamCond(req.user.id)
    const asset = db.prepare(`SELECT id FROM human_assets WHERE url = ? AND ${scope.clause}`).get(firstFrame, ...scope.args)
    const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(firstFrame, ...scope.args)
    const path = localMediaPath(firstFrame)
    if ((!asset && !material) || !path || !fs.existsSync(path)) return res.json(fail('首帧不存在或无权使用', 400))
  }
  if (productImage) {
    const scope = teamCond(req.user.id)
    const asset = db.prepare(`SELECT id FROM human_assets WHERE url = ? AND ${scope.clause}`).get(productImage, ...scope.args)
    const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(productImage, ...scope.args)
    const path = localMediaPath(productImage)
    if ((!asset && !material) || !path || !fs.existsSync(path)) return res.json(fail('商品图不存在或无权使用', 400))
  }
  const reservedSegments = voiceProfileId ? humanReservedSegments(text, resolution) : 1
  const pointCost = reservedSegments * HUMAN_POINTS_PER_SEGMENT
  if (req.user.ai_points < pointCost) {
    return res.json(fail('AI点数不足，请联系管理员', 400))
  }
  // 字幕策略：enabled 默认开（两段式：无字生成 + 艺术字后叠加），style ∈ vivid/pure/violet
  const sub = {
    enabled: subtitle?.enabled !== false,
    style: ['vivid', 'pure', 'violet'].includes(subtitle?.style) ? subtitle.style : 'vivid',
  }
  // 场景约束创作链路：firstFrame（合成首帧）→ 图生视频；sceneKey/persona → prompt 约束
  const task = createTask(req.user.id, 'human', {
    humanName: String(humanName || '').slice(0, 80), text: text.trim(), voiceProfileId: voiceProfileId ? Number(voiceProfileId) : null, count, subtitle: sub, lipSync,
    workflow: voiceProfileId ? 'audio-first' : 'legacy', reservedSegments,
    firstFrame: firstFrame || null, productImage: productImage || null, productDesc: String(productDesc || '').slice(0, 120),
    sceneKey: sceneKey || null, sceneDesc: sceneDesc || null, resolution,
    persona: persona && typeof persona === 'object' ? persona : null,
  }, pointCost)
  res.json(success(task))
}))

// ============ 数字人创作链路资产（场景背景/IP形象/合成首帧） ============
router.post('/create/human-asset', authRequired, asyncHandler(async (req, res) => {
  const { assetType = 'scene', name, sceneKey, sceneDesc, persona, personaUrl, text } = req.body
  if (!['scene', 'persona', 'firstFrame'].includes(assetType)) {
    return res.json(fail('assetType 须为 scene/persona/firstFrame', 400))
  }
  if (assetType === 'firstFrame' && personaUrl) return res.json(fail('当前图片模型不支持以人物参考图合成首帧', 503))
  if (req.user.ai_points < MODULES.humanAsset.point) {
    return res.json(fail('AI点数不足，请联系管理员', 400))
  }
  const typeNames = { scene: '口播场景', persona: 'IP形象', firstFrame: '合成首帧' }
  const sceneName = HUMAN_SCENE_TEMPLATES[sceneKey]?.name || '自定义场景'
  const task = createTask(req.user.id, 'humanAsset', {
    assetType,
    title: `${typeNames[assetType]}_${sceneName}_${Date.now() % 100000}`,
    sceneKey: sceneKey || null,
    sceneDesc: sceneDesc || null,
    persona: persona && typeof persona === 'object' ? persona : null,
    personaUrl: personaUrl || null,
    text: text || null,
  }, MODULES.humanAsset.point)
  res.json(success(task))
}))

// 创作链路资产列表（type 过滤）
router.get('/digital_human/assets', authRequired, (req, res) => {
  const { type, pageNum = 1, pageSize = 50 } = req.query
  const where = ['owner_id = ?', "status = 'active'"]
  const args = [req.user.id]
  if (type && ['scene', 'persona', 'firstFrame'].includes(type)) { where.push('type = ?'); args.push(type) }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM human_assets WHERE ${where.join(' AND ')}`).get(...args).c
  const list = db.prepare(`SELECT id, type, name, url, prompt, meta, created_at AS createdAt FROM human_assets WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
    .map((r) => ({ ...r, meta: (() => { try { return JSON.parse(r.meta || '{}') } catch { return {} } })() }))
  res.json(page(list, total, +pageNum, +pageSize))
})

// 删除创作链路资产
router.delete('/digital_human/assets/:id', authRequired, (req, res) => {
  db.prepare('UPDATE human_assets SET status = "deleted" WHERE id = ? AND owner_id = ?').run(+req.params.id, req.user.id)
  res.json(success(null, '删除成功'))
})

// ============ 任务通用接口 ============
router.get('/task/list', authRequired, (req, res) => {
  const { module, status, pageNum, pageSize } = req.query
  const { list, total } = listTasks(req.user.id, { module, status, pageNum: +pageNum || 1, pageSize: +pageSize || 10 })
  res.json(page(list, total, +pageNum || 1, +pageSize || 10))
})

router.get('/task/detail', authRequired, (req, res) => {
  const id = Number(req.query.id)
  if (!Number.isSafeInteger(id) || id < 1) return res.json(fail('任务不存在', 404))
  const task = getTask(id)
  if (!task || task.owner_id !== req.user.id) return res.json(fail('任务不存在', 404))
  res.json(success(task))
})

router.post('/task/retry', authRequired, (req, res) => {
  const own = db.prepare('SELECT id FROM ai_tasks WHERE id = ? AND owner_id = ?').get(req.body.id, req.user.id)
  if (!own) return res.json(fail('任务不存在', 404))
  let task
  try { task = retryTask(req.body.id) } catch (e) { return res.json(fail(e.message, 400)) }
  if (!task) return res.json(fail('任务不存在', 404))
  res.json(success(task))
})

router.post('/task/cancel', authRequired, asyncHandler(async (req, res) => {
  const own = db.prepare('SELECT id FROM ai_tasks WHERE id = ? AND owner_id = ?').get(req.body.id, req.user.id)
  if (!own) return res.json(fail('任务不存在', 404))
  try {
    const result = await cancelTask(req.body.id)
    const message = result.status === 'canceled' ? '已取消' : result.status === 'succeeded' ? '上游已生成，正在获取结果' : result.status === 'failed' ? '上游已失败，正在更新状态' : '已请求取消，请等待上游确认'
    res.json(success(result, message))
  } catch (e) { return res.json(fail(e.message, 400)) }
}))

router.post('/task/delete', authRequired, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]
  const ownIds = ids.filter((id) => db.prepare('SELECT id FROM ai_tasks WHERE id = ? AND owner_id = ?').get(id, req.user.id))
  const blocked = ownIds.some((id) => !['success', 'failed', 'canceled'].includes(db.prepare('SELECT status FROM ai_tasks WHERE id = ?').get(id).status))
  if (blocked) return res.json(fail('进行中或待核对的任务不能删除', 400))
  ownIds.forEach((id) => deleteTask(id))
  res.json(success(null, '删除成功'))
})

// ============ 各模块素材/模板配置 ============
// 数字人形象
router.get('/digital_human/list', authRequired, (req, res) => {
  res.json(fail('旧版演示形象已停用，请上传人物图片或描述人物', 410))
})

// 音色
router.get('/digital_human/voices', authRequired, (req, res) => {
  res.json(fail('旧版预设音色已停用，请在配音与口型中添加授权音色', 410))
})

// 口播场景模板（创作链路：模块化场景约束）
router.get('/digital_human/scenes', authRequired, (req, res) => {
  res.json(success(Object.values(HUMAN_SCENE_TEMPLATES)))
})

// AI商拍场景
router.get('/ai/commerce/photo/category/list', authRequired, (req, res) => {
  res.json(success([
    { id: 1, name: '纯色背景', desc: '白底/黑底主图' },
    { id: 2, name: '场景氛围', desc: '居家/户外场景' },
    { id: 3, name: '模特展示', desc: '上身效果图' },
    { id: 4, name: '节日营销', desc: '双11/年货节' },
  ]))
})

// 提示词优化：真实 LLM 优先，失败降级字符串拼接
router.post('/ai/factory/prompt/optimize', authRequired, asyncHandler(async (req, res) => {
  const { prompt, type = 'image' } = req.body
  if (!prompt) return res.json(fail('请输入需要优化的描述', 400))
  let optimized = ''
  if (realEnabled()) {
    try {
      optimized = await unifiedChat([
        { role: 'system', content: `你是AI绘图/视频提示词优化专家。将用户的中文描述优化为一段高质量的${type === 'video' ? '视频生成' : '图像生成'}提示词。要求：\n- 保留用户原始意图与产品主体\n- 补充：主体细节、光线、构图、镜头/画面质感、色调氛围、风格关键词\n- 直接输出优化后的提示词正文，不要任何解释、前缀或引号\n- 长度控制在 60~150 字` },
        { role: 'user', content: prompt },
      ], { temperature: 0.6, max_tokens: 500 })
    } catch (err) {
      return res.json(fail(`提示词优化失败：${err.message}`, 503))
    }
  }
  if (!optimized) return res.json(fail('AI 引擎未启用或未返回内容', 503))
  res.json(success({ optimized, engine: 'real' }))
}))

// 场景描述生成：真实 LLM 优先，失败降级静态文案
router.post('/ai/factory/generation/sceneDesc', authRequired, asyncHandler(async (req, res) => {
  const { category = '', productName = '' } = req.body
  let sceneDesc = ''
  if (realEnabled()) {
    try {
      sceneDesc = await unifiedChat([
        { role: 'system', content: '你是电商AI商拍场景设计师。根据商品类别与商品名，生成一段用于AI商拍图生成的场景描述。要求：\n- 描述场景环境、光线、色调、产品摆放方式、背景虚化效果\n- 直接输出场景描述正文，不要解释，60~120字' },
        { role: 'user', content: `商品类别：${category || '通用'}\n商品名称：${productName || '商品'}` },
      ], { temperature: 0.8, max_tokens: 400 })
    } catch (err) {
      return res.json(fail(`场景描述生成失败：${err.message}`, 503))
    }
  }
  if (!sceneDesc) return res.json(fail('AI 引擎未启用或未返回内容', 503))
  res.json(success({ sceneDesc, engine: 'real' }))
}))

export default router
