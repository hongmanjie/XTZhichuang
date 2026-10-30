import express from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page } from '../utils/response.js'
import { teamCond, teamUserIds } from '../utils/teamScope.js'

const router = express.Router()

const parseBenefits = (p) => {
  try { return { ...p, benefits: p.benefits ? JSON.parse(p.benefits) : [] } } catch { return { ...p, benefits: [] } }
}

// 套餐列表（按类型分组返回）
router.get('/charge/packages', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM point_packages ORDER BY sort, id').all().map(parseBenefits)
  res.json(success(list))
})

// 会员状态（对标原站充值页顶部信息条）
router.get('/charge/memberStatus', authRequired, (req, res) => {
  const u = db.prepare('SELECT id, name, vip_level, vip_expire_at, ai_points, storage_total FROM users WHERE id = ?').get(req.user.id)
  const members = teamUserIds(req.user.id)
  const memberCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE status = 1 AND id IN (${members.map(() => '?').join(',')})`).get(...members).c
  const scope = teamCond(req.user.id)
  const usedStorage = db.prepare(`SELECT IFNULL(SUM(size),0) s FROM materials WHERE ${scope.clause}`).get(...scope.args).s
  res.json(success({
    vip_level: u.vip_level || 'trial',
    vip_expire_at: u.vip_expire_at || '',
    ai_points: u.ai_points,
    points_total: null,
    member_count: memberCount,
    seat_limit: null,
    storage_used: usedStorage,
    storage_total: u.storage_total || 10737418240,
  }))
})

// 创建充值订单
router.post('/charge/create', authRequired, (req, res) => {
  const { packageId } = req.body
  const pkg = db.prepare('SELECT * FROM point_packages WHERE id = ?').get(packageId)
  if (!pkg) return res.json(fail('套餐不存在', 400))
  const orderNo = `C${Date.now()}${crypto.randomInt(1000, 9999)}`
  const totalPoints = (pkg.points || 0) + (pkg.bonus_points || 0)
  db.prepare('INSERT INTO charge_orders (order_no, package_id, points, amount, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(orderNo, pkg.id, totalPoints, pkg.price, req.user.id)
  res.json(success({ orderNo, amount: pkg.price, points: totalPoints }))
})

// 模拟支付成功（mock支付回调）——支持会员/拓展包生效
router.post('/charge/pay', authRequired, (req, res) => {
  const { orderNo } = req.body
  const order = db.prepare("SELECT * FROM charge_orders WHERE order_no = ? AND owner_id = ?").get(orderNo, req.user.id)
  if (!order) return res.json(fail('订单不存在', 404))
  if (order.status === 'paid') return res.json(fail('订单已支付', 400))
  const pkg = db.prepare('SELECT * FROM point_packages WHERE id = ?').get(order.package_id)

  db.prepare("UPDATE charge_orders SET status = 'paid', paid_at = datetime('now','localtime') WHERE id = ?").run(order.id)

  // 到账点数
  if (order.points > 0) {
    db.prepare('UPDATE users SET ai_points = ai_points + ? WHERE id = ?').run(order.points, req.user.id)
  }

  // 会员生效
  if (pkg && (pkg.type === 'member_personal' || pkg.type === 'member_enterprise')) {
    const level = pkg.type === 'member_enterprise' ? 'enterprise' : 'member'
    const days = pkg.period === '1年' ? 365 : 31
    const storageMap = { '个人版-月会员': 10, '个人版-年度会员': 150, '企业版-月会员': 500, '企业版-年度会员': 2048 }
    const gb = storageMap[pkg.name] || 10
    db.prepare(`
      UPDATE users SET vip_level = ?,
        vip_expire_at = datetime(COALESCE(MAX(vip_expire_at, datetime('now','localtime')), datetime('now','localtime')), '+${days} day'),
        storage_total = ?
      WHERE id = ?
    `).run(level, gb * 1024 * 1024 * 1024, req.user.id)
  }

  // 拓展包生效
  if (pkg?.type === 'extension') {
    if (/存储/.test(pkg.name)) {
      db.prepare('UPDATE users SET storage_total = storage_total + ? WHERE id = ?').run(100 * 1024 * 1024 * 1024, req.user.id)
    }
  }

  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, 'charge', '充值', order.points, `购买【${pkg?.name || '套餐'}】${order.points > 0 ? ` +${order.points}点` : ''}`)
  res.json(success(null, '支付成功'))
})

// 充值记录
router.get('/charge/records', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM charge_orders WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare(`
    SELECT o.*, p.name as package_name FROM charge_orders o
    LEFT JOIN point_packages p ON p.id = o.package_id
    WHERE o.owner_id = ? ORDER BY o.id DESC LIMIT ? OFFSET ?
  `).all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

export default router
