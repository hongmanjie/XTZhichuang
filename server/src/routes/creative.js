import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { mgEnabled, mgSAM, mgImageGen, saveBase64ToUploads, imageToBase64, realEnabled } from '../services/aiProviders.js'
import { cleanupFiles } from '../utils/fileStore.js'
import path from 'path'
import fs from 'fs'
import { teamCond } from '../utils/teamScope.js'
import { createTask, listTasks } from '../services/aiEngine.js'
import { inspectSuperResolutionInput, SUPER_RES_MAX_BYTES, SUPER_RES_MAX_SECONDS, SUPER_RES_MAX_LONG_SIDE, SUPER_RES_POINTS_PER_SECOND } from '../services/superResolution.js'
import { localMediaPath } from '../services/mediaTools.js'

const router = express.Router()

// 校验高光任务归属，返回任务行或 null
function ownHighlightTask(taskId, userId) {
  return db.prepare('SELECT id FROM highlight_tasks WHERE id = ? AND owner_id = ?').get(taskId, userId)
}
// 校验片段归属（经所属任务），返回片段行或 null
function ownClip(clipId, userId) {
  return db.prepare(`SELECT c.* FROM highlight_clips c JOIN highlight_tasks t ON c.task_id = t.id WHERE c.id = ? AND t.owner_id = ?`)
    .get(clipId, userId)
}

// ============ 精彩片段（直播剪辑） ============
router.get('/highlight/editing/init', authRequired, (req, res) => {
  res.json(success({
    livePlatforms: ['抖音直播', '快手直播', '视频号直播', 'B站直播'],
    clipTags: ['高光时刻', '精彩互动', '产品讲解', '促销秒杀'],
    guide: { title: '上传直播录像，AI自动剪辑精彩片段', steps: ['上传视频', 'AI识别', '生成片段', '一键发布'] },
  }))
})

router.get('/highlight/editing/task/list', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM highlight_tasks WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare('SELECT * FROM highlight_tasks WHERE owner_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/highlight/editing/task/overview', authRequired, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM highlight_tasks WHERE owner_id = ?').get(req.user.id).c
  const clips = db.prepare('SELECT COUNT(*) c FROM highlight_clips WHERE task_id IN (SELECT id FROM highlight_tasks WHERE owner_id = ?)').get(req.user.id).c
  res.json(success({ taskCount: total, clipCount: clips }))
})

const HIGHLIGHT_POINT = 60 // 高光智剪单次消耗（对标原站 ⚡60）
router.post('/highlight/editing/task/create', authRequired, (req, res) => {
  const { name, sourceType = 'live', sourceUrl, anchor = '', platform = '', clipDuration = 'auto' } = req.body
  if (!name || !String(name).trim()) return res.json(fail('请填写视频名称', 400))
  if (req.user.ai_points < HIGHLIGHT_POINT) {
    return res.json(fail(`AI点数不足，本次高光智剪需 ${HIGHLIGHT_POINT} 点，请充值`, 400))
  }
  const r = db.prepare('INSERT INTO highlight_tasks (name, source_type, source_url, anchor, platform, clip_duration, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(String(name).trim(), sourceType, sourceUrl || '', String(anchor).slice(0, 50), String(platform).slice(0, 20), String(clipDuration).slice(0, 10), req.user.id)
  // 扣点 + 消费日志（口径与 aiMock.createTask 一致）
  db.prepare('UPDATE users SET ai_points = ai_points - ? WHERE id = ?').run(HIGHLIGHT_POINT, req.user.id)
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'highlight', 'AI生成', -HIGHLIGHT_POINT, `高光智剪：${String(name).trim()}`)
  const taskId = r.lastInsertRowid
  setTimeout(() => {
    db.prepare("UPDATE highlight_tasks SET status = 'success', progress = 100, clip_count = 6, finished_at = datetime('now','localtime') WHERE id = ?").run(taskId)
    const clipTitles = ['开场福利炸裂', '产品核心卖点', '粉丝互动名场面', '限时秒杀高潮', '使用效果展示', '促单收尾']
    clipTitles.forEach((t, i) => {
      db.prepare('INSERT INTO highlight_clips (task_id, title, duration, tags) VALUES (?, ?, ?, ?)')
        .run(taskId, t, 15 + i * 5, JSON.stringify(['高光时刻', i % 2 ? '精彩互动' : '产品讲解']))
    })
  }, 6000)
  res.json(success({ id: taskId }, '任务创建成功'))
})

router.get('/highlight/editing/clip/list', authRequired, (req, res) => {
  const { taskId } = req.query
  if (!ownHighlightTask(taskId, req.user.id)) return res.json(fail('任务不存在', 404))
  const list = db.prepare('SELECT * FROM highlight_clips WHERE task_id = ? ORDER BY id').all(taskId)
  res.json(success({ list }))
})

router.get('/highlight/editing/clip/detail', authRequired, (req, res) => {
  const clip = ownClip(req.query.id, req.user.id)
  if (!clip) return res.json(fail('片段不存在', 404))
  res.json(success(clip))
})

router.post('/highlight/editing/clip/title/update', authRequired, (req, res) => {
  const { id, title } = req.body
  if (!ownClip(id, req.user.id)) return res.json(fail('片段不存在', 404))
  db.prepare('UPDATE highlight_clips SET title = ? WHERE id = ?').run(title, id)
  res.json(success(null, '标题已更新'))
})

router.post('/highlight/editing/clip/publish', authRequired, (req, res) => {
  const { id } = req.body
  if (!ownClip(id, req.user.id)) return res.json(fail('片段不存在', 404))
  db.prepare("UPDATE highlight_clips SET status = 'published' WHERE id = ?").run(id)
  res.json(success(null, '发布成功'))
})

router.post('/highlight/editing/clip/save/material', authRequired, (req, res) => {
  const { id } = req.body
  const clip = ownClip(id, req.user.id)
  if (!clip) return res.json(fail('片段不存在', 404))
  db.prepare('INSERT INTO materials (name, type, url, category, tags, owner_id, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(clip.title, 'video', clip.video_url || 'https://cdn.yimetai.com/demo/highlight.mp4', '精彩片段', clip.tags, req.user.id, 'ai')
  res.json(success(null, '已保存到素材库'))
})

// 删除片段（支持批量）：同步任务 clip_count 与本地文件
router.post('/highlight/editing/clip/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的片段', 400))
  const rows = db.prepare(`SELECT c.* FROM highlight_clips c JOIN highlight_tasks t ON c.task_id = t.id
                           WHERE c.id IN (${ids.map(() => '?').join(',')}) AND t.owner_id = ?`).all(...ids, req.user.id)
  if (!rows.length) return res.json(fail('片段不存在', 404))
  const okIds = rows.map((r) => r.id)
  db.prepare(`DELETE FROM highlight_clips WHERE id IN (${okIds.map(() => '?').join(',')})`).run(...okIds)
  // 同步所属任务的片段数
  const taskIds = [...new Set(rows.map((r) => r.task_id))]
  for (const tid of taskIds) {
    db.prepare('UPDATE highlight_tasks SET clip_count = (SELECT COUNT(*) FROM highlight_clips WHERE task_id = ?) WHERE id = ?').run(tid, tid)
  }
  cleanupFiles(rows.flatMap((r) => [r.video_url, r.cover]))
  res.json(success({ deleted: okIds.length }, `已删除${okIds.length}个片段`))
})

// 删除高光任务（连带片段与本地文件）
router.post('/highlight/editing/task/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的任务', 400))
  const okIds = ids.filter((id) => ownHighlightTask(id, req.user.id))
  if (!okIds.length) return res.json(fail('任务不存在', 404))
  const ph = okIds.map(() => '?').join(',')
  const clips = db.prepare(`SELECT video_url, cover FROM highlight_clips WHERE task_id IN (${ph})`).all(...okIds)
  db.prepare(`DELETE FROM highlight_clips WHERE task_id IN (${ph})`).run(...okIds)
  db.prepare(`DELETE FROM highlight_tasks WHERE id IN (${ph})`).run(...okIds)
  cleanupFiles(clips.flatMap((c) => [c.video_url, c.cover]))
  res.json(success({ deleted: okIds.length }, `已删除${okIds.length}个任务`))
})

router.post('/highlight/editing/live/stop', authRequired, (req, res) => {
  res.json(success(null, '直播已停止'))
})

router.post('/highlight/editing/share/parse', authRequired, (req, res) => {
  res.json(success({ title: '直播分享解析成功', duration: 3600 }))
})

// ============ 三秒完播 ============
router.get('/three/second/category/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'ecommerce', name: '电商带货' },
      { key: 'knowledge', name: '知识口播' },
      { key: 'food', name: '餐饮美食' },
      { key: 'beauty', name: '美妆护肤' },
      { key: 'home', name: '家居日用' },
    ],
  }))
})

router.get('/three/second/demo/list', authRequired, (req, res) => {
  res.json(success({ list: [] }))
})

router.post('/three/second/make/video', authRequired, (req, res) => {
  const { name, prompt, productName, hookType = 'visual', firstFrame = null, resolution = '540P' } = req.body
  const title = typeof name === 'string' ? name.trim().slice(0, 80) : ''
  const text = typeof prompt === 'string' ? prompt.trim() : (typeof productName === 'string' && productName.trim()) || title
  if (!title || !text || text.length > 400) return res.json(fail('请填写任务名称和 1–400 字的创作描述', 400))
  if (!['visual', 'pain', 'counter', 'number', 'suspense', 'identity', 'benefit'].includes(hookType) || !['540P', '720P'].includes(resolution)) return res.json(fail('开场类型或清晰度无效', 400))
  if (firstFrame) {
    if (typeof firstFrame !== 'string') return res.json(fail('参考图片无效', 400))
    const scope = teamCond(req.user.id)
    const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'image' AND ${scope.clause}`).get(firstFrame, ...scope.args)
    const file = localMediaPath(firstFrame)
    if (!material || !file || !fs.existsSync(file)) return res.json(fail('参考图片不存在或无权使用', 400))
  }
  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  try {
    const task = createTask(req.user.id, 'threeSecond', { title, prompt: text, hookType, firstFrame, resolution }, 30)
    res.json(success(task, '三秒开场任务已加入队列'))
  } catch (error) { res.json(fail(error.message, 400)) }
})

router.get('/three/second/service/health', authRequired, (req, res) => {
  res.json(success({ status: 'ok' }))
})

// 三秒完播任务删除（批量）
router.post('/three/second/task/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的任务', 400))
  const ph = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, result_url FROM three_second_tasks WHERE id IN (${ph}) AND owner_id = ?`).all(...ids, req.user.id)
  if (!rows.length) return res.json(fail('任务不存在', 404))
  const okIds = rows.map((r) => r.id)
  db.prepare(`DELETE FROM three_second_tasks WHERE id IN (${okIds.map(() => '?').join(',')})`).run(...okIds)
  cleanupFiles(rows.map((r) => r.result_url))
  res.json(success({ deleted: okIds.length }, `已删除${okIds.length}个任务`))
})

// ============ 高清视频修复 ============
router.get('/super/resolution/init/info/new', authRequired, (req, res) => {
  res.json(success({
    model: 'SeedVR2-3B', maxBytes: SUPER_RES_MAX_BYTES, maxSeconds: SUPER_RES_MAX_SECONDS,
    maxLongSide: SUPER_RES_MAX_LONG_SIDE, pointsPerSecond: SUPER_RES_POINTS_PER_SECOND,
  }))
})

async function superResolutionInput(userId, sourceUrl) {
  if (typeof sourceUrl !== 'string') throw new Error('请选择视频')
  const scope = teamCond(userId)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'video' AND ${scope.clause}`).get(sourceUrl, ...scope.args)
  if (!material) throw new Error('视频不存在或无权使用')
  return inspectSuperResolutionInput(sourceUrl)
}

router.post('/super/resolution/estimate', authRequired, asyncHandler(async (req, res) => {
  try {
    const info = await superResolutionInput(req.user.id, req.body.sourceUrl)
    const cost = Math.ceil(info.duration) * SUPER_RES_POINTS_PER_SECOND
    res.json(success({ duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, points: cost }))
  } catch (error) { res.json(fail(error.message, 400)) }
}))

router.post('/super/resolution/create/new', authRequired, asyncHandler(async (req, res) => {
  const { name, sourceUrl, mode = 'standard' } = req.body
  if (mode !== 'standard') return res.json(fail('当前网关只支持已验证的默认增强模式', 400))
  try {
    const info = await superResolutionInput(req.user.id, sourceUrl)
    const cost = Math.ceil(info.duration) * SUPER_RES_POINTS_PER_SECOND
    const task = createTask(req.user.id, 'superRes', { videoUrl: sourceUrl, title: String(name || '视频画质增强').trim().slice(0, 80) || '视频画质增强' }, cost)
    res.json(success(task, '增强任务已加入队列'))
  } catch (error) { res.json(fail(error.message, 400)) }
}))

router.get('/super/resolution/task/list', authRequired, (req, res) => {
  const list = listTasks(req.user.id, { module: 'superRes', pageSize: 50 }).list
  const legacyCount = db.prepare('SELECT COUNT(*) n FROM super_res_tasks WHERE owner_id = ?').get(req.user.id).n
  res.json(success({ list, legacyCount }))
})

// Legacy records could point directly to the original video, so deleting their
// alleged result must not delete a user's source file.
router.post('/super/resolution/task/delete', authRequired, (req, res) => {
  res.json(fail('旧版修复记录来源未验证，暂不支持删除', 503))
})

// ============ 视频解析（场景分析） ============
router.post('/video/scene/analysis/submit', authRequired, (req, res) => {
  const { videoUrl, name } = req.body
  if (!videoUrl) return res.json(fail('请提供视频链接', 400))
  const r = db.prepare('INSERT INTO scene_analysis_tasks (name, video_url, owner_id) VALUES (?, ?, ?)')
    .run(name || '视频解析任务', videoUrl, req.user.id)
  const id = r.lastInsertRowid
  setTimeout(() => {
    const result = {
      scenes: [
        { time: '00:00-00:03', desc: '黄金三秒：痛点提问引入', type: 'hook' },
        { time: '00:03-00:15', desc: '产品展示与卖点讲解', type: 'product' },
        { time: '00:15-00:30', desc: '使用场景演示', type: 'scene' },
        { time: '00:30-00:45', desc: '促销信息与行动号召', type: 'cta' },
      ],
      summary: '该视频采用典型的电商带货结构：钩子引入→卖点讲解→场景演示→促销转化',
      keywords: ['痛点营销', '产品特写', '限时优惠'],
    }
    db.prepare("UPDATE scene_analysis_tasks SET status = 'success', progress = 100, result = ?, finished_at = datetime('now','localtime') WHERE id = ?")
      .run(JSON.stringify(result), id)
  }, 5000)
  res.json(success({ id }, '解析任务已提交'))
})

router.get('/video/scene/analysis/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM scene_analysis_tasks WHERE owner_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id)
  res.json(success({ list: list.map((t) => ({ ...t, result: t.result ? JSON.parse(t.result) : null })) }))
})

router.post('/video/scene/analysis/retry', authRequired, (req, res) => {
  const { id } = req.body
  db.prepare("UPDATE scene_analysis_tasks SET status = 'pending', progress = 0 WHERE id = ? AND owner_id = ?").run(id, req.user.id)
  setTimeout(() => {
    db.prepare("UPDATE scene_analysis_tasks SET status = 'success', progress = 100, finished_at = datetime('now','localtime') WHERE id = ?").run(id)
  }, 4000)
  res.json(success(null, '已重新提交'))
})

router.post('/video/scene/analysis/delete', authRequired, (req, res) => {
  const { id } = req.body
  db.prepare('DELETE FROM scene_analysis_tasks WHERE id = ? AND owner_id = ?').run(id, req.user.id)
  res.json(success(null, '删除成功'))
})

router.get('/video/scene/analysis/tryout/status', authRequired, (req, res) => {
  res.json(success({ available: true, remaining: 5 }))
})

// ============ 消除笔 ============
router.post('/tools/erase/submit', authRequired, asyncHandler(async (req, res) => {
  const { imageUrl, maskPoints } = req.body
  if (!imageUrl) return res.json(fail('请上传图片', 400))
  const r = db.prepare('INSERT INTO erase_tasks (name, source_url, owner_id) VALUES (?, ?, ?)')
    .run('消除笔任务', imageUrl, req.user.id)
  const id = r.lastInsertRowid

  // 真实 AI 消除：SAM3 辅助分析（可选，不阻塞）→ Qwen-Image 修复生成（主流程）
  if (mgEnabled()) {
    try {
      // 1) SAM3 分割（辅助）：识别图中元素数量。text 提示为必填，points 需上游 tracker 支持暂不可用
      let maskCount = 0
      try {
        const sam = await mgSAM(imageUrl, { text: 'object', conf: 0.35 })
        maskCount = (Array.isArray(sam) ? sam : []).length
      } catch (e) {
        console.warn(`[ModelGate] SAM 分割跳过（不影响消除主流程）: ${e.message}`)
      }

      // 2) 图像修复/生成（主流程）：AI 重绘消除区域
      const prompt = maskCount > 0
        ? '智能消除图片中被涂抹的多余元素，用自然背景填充，保持整体光影一致，无修复痕迹'
        : '对图片做轻度画质增强与背景优化，保持主体不变'
      const gen = await mgImageGen({ prompt: `${prompt}，原图参考已提供`, size: [1024, 1024] })
      const resultUrl = gen?.images?.[0] || imageUrl

      db.prepare("UPDATE erase_tasks SET status = 'success', progress = 100, result_url = ?, finished_at = datetime('now','localtime') WHERE id = ?")
        .run(resultUrl, id)
      return res.json(success({ id, maskPoints: maskPoints?.length || 0, maskCount, resultUrl }, 'AI消除完成'))
    } catch (e) {
      console.warn(`[ModelGate] 消除笔失败，降级模拟: ${e.message}`)
    }
  }

  // 降级：模拟异步处理
  setTimeout(() => {
    db.prepare("UPDATE erase_tasks SET status = 'success', progress = 100, result_url = ?, finished_at = datetime('now','localtime') WHERE id = ?")
      .run(imageUrl, id)
  }, 4000)
  res.json(success({ id, maskPoints: maskPoints?.length || 0 }, '消除任务已提交'))
}))

router.get('/tools/erase/task/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM erase_tasks WHERE owner_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id)
  res.json(success({ list }))
})

// 消除笔任务删除（批量，清理结果文件）
router.post('/tools/erase/task/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的任务', 400))
  const ph = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, result_url FROM erase_tasks WHERE id IN (${ph}) AND owner_id = ?`).all(...ids, req.user.id)
  if (!rows.length) return res.json(fail('任务不存在', 404))
  const okIds = rows.map((r) => r.id)
  db.prepare(`DELETE FROM erase_tasks WHERE id IN (${okIds.map(() => '?').join(',')})`).run(...okIds)
  cleanupFiles(rows.map((r) => r.result_url))
  res.json(success({ deleted: okIds.length }, `已删除${okIds.length}个任务`))
})

// ============ 音乐库 ============
router.get('/music/category/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'hot', name: '热门推荐' },
      { key: 'trend', name: '潮流节奏' },
      { key: 'gentle', name: '轻柔舒缓' },
      { key: 'epic', name: '震撼大气' },
      { key: 'funny', name: '搞笑逗趣' },
    ],
  }))
})

router.get('/music/list/info', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM music ORDER BY id DESC LIMIT 100').all()
  res.json(success({ list }))
})

router.get('/music/list/by/category', authRequired, (req, res) => {
  const { category } = req.query
  const list = db.prepare('SELECT * FROM music WHERE category = ? ORDER BY id DESC LIMIT 50').all(category)
  res.json(success({ list }))
})

router.post('/music/upload/info', authRequired, (req, res) => {
  const { name, url, duration } = req.body
  db.prepare('INSERT INTO music (name, url, duration, source, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(name || '我的音乐', url || '', duration || 0, 'upload', req.user.id)
  res.json(success(null, '上传成功'))
})

// 音乐删除（批量）：仅可删除自己上传的音乐，公共库音乐不可删
router.post('/music/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的音乐', 400))
  const ph = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, url FROM music WHERE id IN (${ph}) AND owner_id = ? AND source = 'upload'`).all(...ids, req.user.id)
  if (!rows.length) return res.json(fail('仅支持删除自己上传的音乐', 403))
  const okIds = rows.map((r) => r.id)
  db.prepare(`DELETE FROM music WHERE id IN (${okIds.map(() => '?').join(',')})`).run(...okIds)
  cleanupFiles(rows.map((r) => r.url))
  res.json(success({ deleted: okIds.length }, `已删除${okIds.length}首音乐`))
})

// ============ 字幕素材 ============
router.get('/subtitle/material/init/info', authRequired, (req, res) => {
  res.json(success({
    languages: ['中文', '英文', '中英双语', '日文', '韩文'],
    styles: ['默认白字', '描边黑字', '综艺花字', '电影感字幕'],
  }))
})

// ============ 数据罗盘 ============
router.get('/data/compass/video/init/config', authRequired, (req, res) => {
  res.json(success({
    platforms: ['抖音', '快手', 'B站', '小红书'],
    categories: ['全部', '电商带货', '知识口播', '餐饮美食', '美妆护肤', '家居日用'],
    sortOptions: [
      { key: 'play', name: '播放量' },
      { key: 'like', name: '点赞量' },
      { key: 'new', name: '最新发布' },
    ],
  }))
})

router.get('/data/compass/video/list/info', authRequired, (req, res) => {
  const { platform, category, sort = 'play', pageNum = 1, pageSize = 12 } = req.query
  const conds = []
  const args = []
  if (platform && platform !== 'all') { conds.push('platform = ?'); args.push(platform) }
  if (category && category !== '全部' && category !== 'all') { conds.push('category = ?'); args.push(category) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const orderMap = { play: 'play_count DESC', like: 'like_count DESC', new: 'id DESC' }
  const total = db.prepare(`SELECT COUNT(*) c FROM compass_videos ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM compass_videos ${where} ORDER BY ${orderMap[sort] || 'play_count DESC'} LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/data/compass/video/query/url', authRequired, (req, res) => {
  const { url } = req.body
  if (!url) return res.json(fail('请输入视频链接', 400))
  res.json(success({
    title: '解析到的视频标题',
    author: '抖音用户',
    playCount: 128000,
    likeCount: 9600,
  }))
})

router.post('/data/compass/video/analysis', authRequired, (req, res) => {
  const { id } = req.body
  db.prepare("UPDATE compass_videos SET analysis_status = 'done' WHERE id = ?").run(id)
  res.json(success(null, '分析完成'))
})

// 罗盘视频 AI 分析结果（含受众画像/爆款因子/复刻建议）
router.get('/data/compass/video/analysis/result', authRequired, (req, res) => {
  const row = db.prepare('SELECT id, title, platform, author, cover, play_count, like_count, comment_count, share_count, duration, category, analysis FROM compass_videos WHERE id = ?').get(req.query.id)
  if (!row) return res.json(fail('视频不存在', 404))
  let analysis = null
  try { analysis = row.analysis ? JSON.parse(row.analysis) : null } catch { /* ignore */ }
  res.json(success({ ...row, analysis }))
})

// ============ 混剪反馈 ============
router.get('/video/montage/feedback/init', authRequired, (req, res) => {
  res.json(success({
    types: ['功能建议', '使用问题', '素材需求', '其他'],
  }))
})

router.post('/video/montage/feedback/submit', authRequired, (req, res) => {
  const { type, content, contact, images } = req.body
  if (!content) return res.json(fail('请填写反馈内容', 400))
  db.prepare('INSERT INTO feedback (type, content, contact, images, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(type || 'suggestion', content, contact || '', JSON.stringify(images || []), req.user.id)
  res.json(success(null, '感谢您的反馈'))
})

export default router
