import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page } from '../utils/response.js'

const router = express.Router()

// ============ 工作台初始化（原站 /workbench/data/init/new） ============
router.get('/workbench/data/init/new', authRequired, (req, res) => {
  const user = req.user
  const unreadMsg = db.prepare('SELECT COUNT(*) c FROM center_messages WHERE owner_id = ? AND is_read = 0').get(user.id).c
  const runningTask = db.prepare("SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ? AND status IN ('pending','running')").get(user.id).c
  const materialCount = db.prepare('SELECT COUNT(*) c FROM materials WHERE owner_id = ?').get(user.id).c
  const workCount = db.prepare('SELECT COUNT(*) c FROM works WHERE owner_id = ?').get(user.id).c
  const scriptCount = db.prepare('SELECT COUNT(*) c FROM scripts WHERE owner_id = ?').get(user.id).c
  res.json(success({
    userInfo: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      aiPoints: user.ai_points,
      roleName: user.roleName,
      isAdmin: user.role_id <= 2,
    },
    unread: { message: unreadMsg, task: runningTask },
    statistics: { material: materialCount, work: workCount, script: scriptCount },
    guide: { showNewUserGuide: false, rewardGuide: true },
  }))
})

// ============ 数据看板配置（原站 /data/board/config/*） ============
// 看板初始化：返回可配置模块列表与开关状态
router.get('/data/board/config/init', authRequired, (req, res) => {
  res.json(success({
    modules: [
      { key: 'briefing', name: '数据简报', enabled: true },
      { key: 'trend', name: '消耗趋势', enabled: true },
      { key: 'core', name: '核心指标', enabled: true },
      { key: 'ranking', name: '创作排行', enabled: true },
      { key: 'target', name: '目标完成度', enabled: true },
      { key: 'excellentWorks', name: '优秀作品', enabled: true },
      { key: 'function', name: '快捷功能', enabled: true },
    ],
  }))
})

// 数据简报
router.get('/data/board/config/briefing', authRequired, (req, res) => {
  const user = req.user
  const today = new Date().toISOString().slice(0, 10)
  const rows = db.prepare("SELECT COALESCE(SUM(-points),0) used FROM consumption_logs WHERE user_id = ? AND date(created_at) = date('now','localtime')").get(user.id)
  const week = db.prepare("SELECT COALESCE(SUM(-points),0) used FROM consumption_logs WHERE user_id = ? AND created_at >= datetime('now','-7 days','localtime')").get(user.id)
  const taskCount = db.prepare('SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ?').get(user.id).c
  const successCount = db.prepare("SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ? AND status = 'success'").get(user.id).c
  res.json(success({
    date: today,
    todayPoints: rows.used,
    weekPoints: week.used,
    taskCount,
    successRate: taskCount ? Math.round((successCount / taskCount) * 100) : 100,
    tips: ['完成新手任务可领取海量AI点数', '爆款复刻助你快速起号'],
  }))
})

// 消耗趋势（近14天）
router.get('/data/board/config/trend', authRequired, (req, res) => {
  const user = req.user
  const list = db.prepare(`
    SELECT date(created_at) date, COALESCE(SUM(-points),0) points
    FROM consumption_logs
    WHERE user_id = ? AND created_at >= datetime('now','-14 days','localtime')
    GROUP BY date(created_at) ORDER BY date
  `).all(user.id)
  // 补齐14天
  const filled = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    const found = list.find((r) => r.date === d)
    filled.push({ date: d, points: found ? found.points : 0 })
  }
  res.json(success({ list: filled }))
})

// 核心指标
router.get('/data/board/config/core', authRequired, (req, res) => {
  const user = req.user
  const works = db.prepare('SELECT COUNT(*) c FROM works WHERE owner_id = ?').get(user.id).c
  const scripts = db.prepare('SELECT COUNT(*) c FROM scripts WHERE owner_id = ?').get(user.id).c
  const materials = db.prepare('SELECT COUNT(*) c FROM materials WHERE owner_id = ?').get(user.id).c
  const mix = db.prepare('SELECT COUNT(*) c FROM mix_projects WHERE owner_id = ?').get(user.id).c
  res.json(success({
    items: [
      { key: 'work', name: '我的作品', value: works, unit: '个' },
      { key: 'script', name: '我的脚本', value: scripts, unit: '个' },
      { key: 'material', name: '素材资产', value: materials, unit: '个' },
      { key: 'mix', name: '剪辑项目', value: mix, unit: '个' },
    ],
  }))
})

// 创作排行（团队内）
router.get('/data/board/config/ranking', authRequired, (req, res) => {
  const list = db.prepare(`
    SELECT u.id, u.name, u.avatar, COUNT(w.id) workCount
    FROM users u LEFT JOIN works w ON w.owner_id = u.id
    GROUP BY u.id ORDER BY workCount DESC LIMIT 10
  `).all()
  res.json(success({ list: list.map((r, i) => ({ ...r, rank: i + 1 })) }))
})

// 目标完成度
router.get('/data/board/config/target', authRequired, (req, res) => {
  res.json(success({
    targets: [
      { key: 'daily', name: '今日创作目标', current: 2, target: 5, unit: '个作品' },
      { key: 'week', name: '本周创作目标', current: 8, target: 20, unit: '个作品' },
    ],
  }))
})

// 优秀作品
router.get('/data/board/config/excellent/works', authRequired, (req, res) => {
  const list = db.prepare(`
    SELECT w.*, u.name ownerName FROM works w
    LEFT JOIN users u ON u.id = w.owner_id
    ORDER BY w.id DESC LIMIT 6
  `).all()
  res.json(success({ list }))
})

// 快捷功能入口
router.get('/data/board/config/function', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'replica', name: '爆款复刻', icon: '/images/dashboard/icon_replica.png', path: '/create/hit-replica' },
      { key: 'factory', name: 'AI梦工厂', icon: '/images/dashboard/icon_factory.png', path: '/create/video-goldTime' },
      { key: 'studio', name: 'AI商拍', icon: '/images/dashboard/icon_studio.png', path: '/create/ai-product-studio' },
      { key: 'mix', name: '智能剪辑', icon: '/images/dashboard/icon_mix.png', path: '/ai-mix' },
      { key: 'agent', name: 'AI Agent', icon: '/images/dashboard/icon_agent.png', path: '/agent' },
      { key: 'asset', name: '资产库', icon: '/images/dashboard/icon_asset.png', path: '/asset-library' },
    ],
  }))
})

// ============ 新用户奖励任务 ============
router.get('/new/user/reward/task/list', authRequired, (req, res) => {
  const user = req.user
  const tasks = db.prepare("SELECT * FROM new_user_tasks WHERE status = 'active' ORDER BY sort").all()
  const records = db.prepare('SELECT * FROM new_user_task_records WHERE user_id = ?').all(user.id)
  const list = tasks.map((t) => {
    const rec = records.find((r) => r.task_id === t.id)
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      rewardPoints: t.reward_points,
      module: t.module,
      status: rec ? rec.status : 'pending',
    }
  })
  res.json(success({ list, totalReward: tasks.reduce((s, t) => s + t.reward_points, 0) }))
})

router.get('/new/user/reward/is/show/guide', authRequired, (req, res) => {
  const user = req.user
  const completed = db.prepare("SELECT COUNT(*) c FROM new_user_task_records WHERE user_id = ? AND status != 'pending'").get(user.id).c
  res.json(success({ show: completed < 3 }))
})

// 领取任务奖励
router.post('/new/user/reward/claim', authRequired, (req, res) => {
  const { taskId } = req.body
  const user = req.user
  const rec = db.prepare('SELECT * FROM new_user_task_records WHERE task_id = ? AND user_id = ?').get(taskId, user.id)
  if (!rec || rec.status !== 'completed') return res.json(fail('任务未完成', 400))
  if (rec.status === 'claimed') return res.json(fail('已领取', 400))
  const task = db.prepare('SELECT * FROM new_user_tasks WHERE id = ?').get(taskId)
  db.prepare("UPDATE new_user_task_records SET status = 'claimed', claimed_at = datetime('now','localtime') WHERE id = ?").run(rec.id)
  db.prepare('UPDATE users SET ai_points = ai_points + ? WHERE id = ?').run(task.reward_points, user.id)
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 'reward', '新手任务奖励', task.reward_points, task.name)
  res.json(success({ points: task.reward_points }, '领取成功'))
})

// ============ 消息中心 ============
router.get('/message/center/list/info', authRequired, (req, res) => {
  const { type, pageNum = 1, pageSize = 10 } = req.query
  const conds = ['owner_id = ?']
  const args = [req.user.id]
  if (type && type !== 'all') { conds.push('type = ?'); args.push(type) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM center_messages ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM center_messages ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list.map((m) => ({ ...m, isRead: !!m.is_read })), total, +pageNum, +pageSize))
})

router.get('/message/center/unread/message', authRequired, (req, res) => {
  const unread = db.prepare('SELECT COUNT(*) c FROM center_messages WHERE owner_id = ? AND is_read = 0').get(req.user.id).c
  const latest = db.prepare('SELECT * FROM center_messages WHERE owner_id = ? ORDER BY id DESC LIMIT 5').all(req.user.id)
  res.json(success({ unread, latest }))
})

router.post('/message/center/message/batch', authRequired, (req, res) => {
  const { ids } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.json(fail('参数缺失', 400))
  const stmt = db.prepare('UPDATE center_messages SET is_read = 1 WHERE id = ? AND owner_id = ?')
  ids.forEach((id) => stmt.run(id, req.user.id))
  res.json(success(null, '已标记已读'))
})

router.get('/message/center/query/body', authRequired, (req, res) => {
  const { id } = req.query
  const msg = db.prepare('SELECT * FROM center_messages WHERE id = ? AND owner_id = ?').get(id, req.user.id)
  if (!msg) return res.json(fail('消息不存在', 404))
  db.prepare('UPDATE center_messages SET is_read = 1 WHERE id = ?').run(id)
  res.json(success({ ...msg, isRead: true }))
})

// ============ 任务中心 ============
router.get('/task/center/unread/count', authRequired, (req, res) => {
  const running = db.prepare("SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ? AND status = 'running'").get(req.user.id).c
  const failed = db.prepare("SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ? AND status = 'failed'").get(req.user.id).c
  res.json(success({ running, failed, total: running + failed }))
})

router.get('/task/center/upload/page', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM ai_tasks WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare('SELECT * FROM ai_tasks WHERE owner_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/task/center/upload/bind', authRequired, (req, res) => {
  const { taskId, materialId } = req.body
  db.prepare('UPDATE ai_tasks SET result = ? WHERE id = ? AND owner_id = ?')
    .run(JSON.stringify({ boundMaterialId: materialId }), taskId, req.user.id)
  res.json(success(null, '绑定成功'))
})

// ============ 行为上报 ============
router.post('/behavior/report', authRequired, (req, res) => {
  const { action, target, extra } = req.body
  db.prepare('INSERT INTO operation_logs (user_id, user_name, module, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, req.user.name, 'behavior', action || 'page_view', JSON.stringify({ target, extra }))
  res.json(success(null))
})

// ============ 账号顶部消息/版本公告 ============
router.get('/account/top/message', authRequired, (req, res) => {
  const notice = db.prepare('SELECT * FROM version_notices ORDER BY id DESC LIMIT 1').get()
  res.json(success(notice ? { show: true, title: notice.title, content: notice.content, version: notice.version } : { show: false }))
})

router.get('/account/version/notice', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM version_notices ORDER BY id DESC LIMIT 10').all()
  res.json(success({ list }))
})

router.get('/account/version/notice/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM version_notices ORDER BY id DESC LIMIT 20').all()
  res.json(success({ list }))
})

// 功能开关
router.get('/account/feature/status/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'aiAgent', name: 'AI Agent', enabled: true },
      { key: 'assetLibrary', name: '资产库', enabled: true },
      { key: 'smartMix', name: '智能剪辑', enabled: true },
      { key: 'digitalHuman', name: '数字人', enabled: true },
      { key: 'eraseTool', name: '消除笔', enabled: true },
      { key: 'highlight', name: '精彩片段', enabled: true },
      { key: 'dataCompass', name: '数据罗盘', enabled: true },
    ],
  }))
})

// 活动弹窗
router.get('/activity/popup/get', authRequired, (req, res) => {
  const popup = db.prepare('SELECT * FROM activity_popup WHERE status = 1 ORDER BY id DESC LIMIT 1').get()
  res.json(success(popup || { show: false }))
})

export default router
