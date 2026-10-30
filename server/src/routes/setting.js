import express from 'express'
import db from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { success, fail, page } from '../utils/response.js'

const router = express.Router()

// ============ AI点数管理 ============
router.get('/setting/aiPoint/overview', authRequired, (req, res) => {
  const user = req.user
  const totalEarned = db.prepare("SELECT COALESCE(SUM(points), 0) s FROM consumption_logs WHERE user_id = ? AND points > 0").get(user.id).s
  const totalUsed = db.prepare("SELECT COALESCE(SUM(-points), 0) s FROM consumption_logs WHERE user_id = ? AND points < 0").get(user.id).s
  res.json(success({
    balance: user.ai_points,
    totalEarned: totalEarned || user.ai_points,
    totalUsed,
  }))
})

// 管理员：给成员充值点数
router.post('/setting/aiPoint/grant', authRequired, adminRequired, (req, res) => {
  const { userId, points, remark } = req.body
  if (!userId || !points) return res.json(fail('参数缺失', 400))
  db.prepare('UPDATE users SET ai_points = ai_points + ? WHERE id = ?').run(points, userId)
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(userId, 'setting', '管理员充值', points, remark || '管理员发放点数')
  res.json(success(null, '充值成功'))
})

// ============ 消费记录 ============
router.get('/setting/consumption/list', authRequired, (req, res) => {
  const { module, pageNum = 1, pageSize = 10 } = req.query
  const conds = ['user_id = ?']
  const args = [req.user.id]
  if (module) { conds.push('module = ?'); args.push(module) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM consumption_logs ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM consumption_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

// ============ 日志管理 ============
router.get('/setting/log/list', authRequired, adminRequired, (req, res) => {
  const { keyword, module, pageNum = 1, pageSize = 10 } = req.query
  const conds = []
  const args = []
  if (keyword) { conds.push('(user_name LIKE ? OR action LIKE ? OR detail LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) }
  if (module) { conds.push('module = ?'); args.push(module) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM operation_logs ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM operation_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

// ============ 用户设置 ============
router.get('/user/user/setting', authRequired, (req, res) => {
  res.json(success({
    notification: { system: true, task: true, marketing: false },
  }))
})

router.post('/user/edit/save', authRequired, (req, res) => {
  const { name, avatar, email } = req.body
  db.prepare("UPDATE users SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), email = COALESCE(?, email), updated_at = datetime('now','localtime') WHERE id = ?")
    .run(name, avatar, email, req.user.id)
  res.json(success(null, '保存成功'))
})

router.get('/user/edit/query', authRequired, (req, res) => {
  const { password, ...safeUser } = req.user
  res.json(success(safeUser))
})

router.get('/user/list/info', authRequired, (req, res) => {
  res.json(success(req.user))
})

router.post('/user/user/check', authRequired, (req, res) => {
  res.json(success({ exist: false }))
})

// ============ 邀请绑定 ============
router.post('/account/bind/invitation/code', authRequired, (req, res) => {
  const { code } = req.body
  if (!code) return res.json(fail('请输入邀请码', 400))
  db.prepare('UPDATE users SET invite_code = ? WHERE id = ? AND invite_code IS NULL').run(code, req.user.id)
  res.json(success(null, '绑定成功'))
})

export default router
