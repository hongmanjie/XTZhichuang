import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { signToken, authRequired } from '../middleware/auth.js'
import { success, fail } from '../utils/response.js'
import { asyncHandler } from '../utils/response.js'

const router = express.Router()
function setMediaCookie(req, res, token) {
  // Secure 跟随实际请求协议(trust proxy + X-Forwarded-Proto):HTTP 部署下浏览器才会保存该 cookie
  res.cookie('yimetai_media', token, { httpOnly: true, sameSite: 'lax', secure: req.secure === true, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 })
}

// 登录页初始化（站点配置）
router.get('/login/init', (req, res) => {
  res.json(success({
    siteName: '兴图AI视频创作平台',
    slogan: '电商广告视频 · AI分镜智创',
    loginBg: '/images/login-bg.png',
    loginTypes: ['password'],
  }))
})

// 账号密码登录（简化版：无验证码）
router.post('/login', asyncHandler(async (req, res) => {
  const { account, password } = req.body
  if (!account || !password) {
    return res.json(fail('请输入账号和密码', 400))
  }
  const user = db.prepare('SELECT * FROM users WHERE account = ? OR phone = ?').get(account, account)
  if (!user) {
    return res.json(fail('账号不存在', 400))
  }
  if (user.status !== 1) {
    return res.json(fail('账号已被禁用', 400))
  }
  const ok = await bcrypt.compare(password, user.password)
  if (!ok) {
    return res.json(fail('账号或密码错误', 400))
  }
  const token = signToken(user)
  setMediaCookie(req, res, token)
  const { password: _p, ...safeUser } = user

  // 记录登录日志
  db.prepare('INSERT INTO operation_logs (user_id, user_name, module, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.name, '登录', '密码登录', '登录成功', req.ip)

  res.json(success({ token, userInfo: safeUser }))
}))

// 手机号注册（简化版：未接入短信验证码）。注册即自动登录，新用户赠送 500 AI 点数。
const REGISTER_GIFT_POINTS = 500

router.post('/register', asyncHandler(async (req, res) => {
  const { phone, password, name } = req.body
  if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone.trim())) {
    return res.json(fail('请输入正确的 11 位手机号', 400))
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 32) {
    return res.json(fail('密码长度为 6-32 位', 400))
  }
  const account = phone.trim()
  const nickname = typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : `用户${account.slice(-4)}`
  const exists = db.prepare('SELECT id FROM users WHERE account = ? OR phone = ?').get(account, account)
  if (exists) return res.json(fail('该手机号已注册，请直接登录', 400))
  const role = db.prepare("SELECT id FROM roles WHERE code = 'creator'").get() || { id: 3 }

  let inviteCode = ''
  for (let i = 0; i < 5 && !inviteCode; i++) {
    const candidate = 'Y' + String(Math.floor(100000 + Math.random() * 900000))
    if (!db.prepare('SELECT id FROM users WHERE invite_code = ?').get(candidate)) inviteCode = candidate
  }

  const hashed = await bcrypt.hash(password, 10)
  const info = db.prepare(`
    INSERT INTO users (account, password, name, phone, role_id, ai_points, invite_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(account, hashed, nickname, account, role.id, REGISTER_GIFT_POINTS, inviteCode)
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(info.lastInsertRowid, 'register', '注册赠送', REGISTER_GIFT_POINTS, '新用户注册赠送')

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  const token = signToken(user)
  setMediaCookie(req, res, token)
  const { password: _p, ...safeUser } = user
  res.json(success({ token, userInfo: safeUser }))
}))

// 获取当前用户信息
router.get('/user/info', authRequired, (req, res) => {
  const { password, ...safeUser } = req.user
  const dept = req.user.department_id
    ? db.prepare('SELECT name FROM departments WHERE id = ?').get(req.user.department_id)
    : null
  const role = db.prepare('SELECT id, name FROM roles WHERE id = ?').get(req.user.role_id)
  res.json(success({
    ...safeUser,
    departmentName: dept?.name || '',
    roleName: role?.name || '',
  }))
})

// 退出登录
router.post('/logout', authRequired, (req, res) => {
  res.clearCookie('yimetai_media', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
  res.json(success(null, '已退出登录'))
})

router.post('/media/session', authRequired, (req, res) => {
  setMediaCookie(req, res, signToken(req.user))
  res.json(success(null))
})

// 修改密码
router.post('/user/password', authRequired, asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body
  const ok = await bcrypt.compare(oldPassword, req.user.password)
  if (!ok) return res.json(fail('原密码错误', 400))
  const hash = await bcrypt.hash(newPassword, 10)
  db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hash, req.user.id)
  res.json(success(null, '密码修改成功'))
}))

// 账户顶部消息
router.get('/account/top/message', authRequired, (req, res) => {
  res.json(success({
    unreadCount: 0,
    list: [],
  }))
})

// 版本公告
router.get('/account/version/notice', authRequired, (req, res) => {
  const notice = db.prepare('SELECT * FROM version_notices ORDER BY id DESC LIMIT 1').get()
  res.json(success(notice || null))
})

// 功能状态列表
router.get('/account/feature/status/list', authRequired, (req, res) => {
  res.json(success([
    { key: 'replica', enabled: true },
    { key: 'factory', enabled: true },
    { key: 'studio', enabled: true },
    { key: 'materialField', enabled: true },
    { key: 'analysis', enabled: true },
    { key: 'human', enabled: true },
    { key: 'mix', enabled: true },
  ]))
})

// 活动弹窗
router.get('/activity/popup/get', authRequired, (req, res) => {
  const popup = db.prepare('SELECT * FROM activity_popup WHERE status = 1 ORDER BY id DESC LIMIT 1').get()
  res.json(success(popup || null))
})

// 更新企业名称
router.post('/account/update/enterprise/name', authRequired, (req, res) => {
  res.json(success(null, '更新成功'))
})

export default router
