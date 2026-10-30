import jwt from 'jsonwebtoken'
import db from '../db.js'

// 密钥来源：环境变量优先；本地开发用默认值并在启动时警告
const JWT_SECRET = process.env.JWT_SECRET || 'yimetai-clone-secret-key-2026'
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'yimetai-clone-secret-key-2026')) {
  throw new Error('生产环境必须设置至少 32 字符的独立 JWT_SECRET')
}
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] 未配置 JWT_SECRET，正在使用默认密钥，仅适合本地开发')
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, account: user.account, roleId: user.role_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

// 认证中间件
export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.replace(/^Bearer\s+/i, '') || req.headers.token || req.query.token
  const payload = token ? verifyToken(token) : null
  if (!payload) {
    return res.status(401).json({ code: 401, data: null, message: '登录已过期，请重新登录' })
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
  if (!user || user.status !== 1) {
    return res.status(401).json({ code: 401, data: null, message: '账号不存在或已禁用' })
  }
  req.user = user
  next()
}

// 管理员权限
export function adminRequired(req, res, next) {
  if (req.user?.role_id !== 1 && req.user?.role_id !== 2) {
    return res.status(403).json({ code: 403, data: null, message: '无权限操作' })
  }
  next()
}
