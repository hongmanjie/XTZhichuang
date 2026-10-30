import express from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page } from '../utils/response.js'

const router = express.Router()

// ============ 会员订单 ============
router.get('/member/order/page/init', authRequired, (req, res) => {
  const packages = [
    { id: 1, name: '体验会员', duration: '1个月', price: 29, points: 3000, tag: '' },
    { id: 2, name: '创业会员', duration: '3个月', price: 79, points: 12000, tag: '热销' },
    { id: 3, name: '旗舰会员', duration: '12个月', price: 299, points: 60000, tag: '超值' },
  ]
  res.json(success({ packages, privileges: ['每月赠送AI点数', '优先任务队列', '专属客服支持', '新功能优先体验'] }))
})

router.post('/member/order/create/order', authRequired, (req, res) => {
  const { packageId, packageName, amount } = req.body
  const orderNo = 'MB' + Date.now() + crypto.randomInt(100, 999)
  db.prepare('INSERT INTO member_orders (order_no, package_name, amount, owner_id) VALUES (?, ?, ?, ?)')
    .run(orderNo, packageName || '会员套餐', amount || 0, req.user.id)
  res.json(success({ orderNo }))
})

router.get('/member/order/list/info', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM member_orders WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare('SELECT * FROM member_orders WHERE owner_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/member/order/order/status', authRequired, (req, res) => {
  const { orderNo } = req.query
  const order = db.prepare('SELECT * FROM member_orders WHERE order_no = ?').get(orderNo)
  res.json(success({ status: order ? order.status : 'not_found' }))
})

// ============ 脚本海 ============
router.get('/script/sea/info/list', authRequired, (req, res) => {
  const { category, keyword, pageNum = 1, pageSize = 12 } = req.query
  const conds = []
  const args = []
  if (category && category !== 'all') { conds.push('category = ?'); args.push(category) }
  if (keyword) { conds.push('(title LIKE ? OR content LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM script_sea ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM script_sea ${where} ORDER BY claim_count DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/script/sea/detail/info', authRequired, (req, res) => {
  const { id } = req.query
  const script = db.prepare('SELECT * FROM script_sea WHERE id = ?').get(id)
  if (!script) return res.json(fail('脚本不存在', 404))
  const claimed = db.prepare('SELECT COUNT(*) c FROM script_sea_claims WHERE script_id = ? AND user_id = ?').get(id, req.user.id).c
  res.json(success({ ...script, claimed: !!claimed }))
})

router.post('/script/sea/claim/submit', authRequired, (req, res) => {
  const { id } = req.body
  const script = db.prepare('SELECT * FROM script_sea WHERE id = ?').get(id)
  if (!script) return res.json(fail('脚本不存在', 404))
  const exist = db.prepare('SELECT * FROM script_sea_claims WHERE script_id = ? AND user_id = ?').get(id, req.user.id)
  if (exist) return res.json(fail('已领取过该脚本', 400))
  db.prepare('INSERT INTO script_sea_claims (script_id, user_id) VALUES (?, ?)').run(id, req.user.id)
  db.prepare('UPDATE script_sea SET claim_count = claim_count + 1 WHERE id = ?').run(id)
  // 领取后同时复制到我的脚本
  db.prepare('INSERT INTO scripts (title, content, category, status, owner_id, owner_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(script.title, script.content, script.category, 'draft', req.user.id, req.user.name)
  res.json(success(null, '领取成功，已存入我的脚本'))
})

// ============ 我的项目（团队） ============
router.get('/my/project/script/init', authRequired, (req, res) => {
  const projects = db.prepare('SELECT * FROM my_projects WHERE owner_id = ? ORDER BY id DESC').all(req.user.id)
  res.json(success({ list: projects }))
})

router.get('/my/project/team/item', authRequired, (req, res) => {
  const { type } = req.query
  if (type === 'fbgl') {
    // 分包管理：品牌列表
    const list = db.prepare('SELECT * FROM brands ORDER BY id DESC LIMIT 50').all()
    return res.json(success({ list }))
  }
  if (type === 'tdxm') {
    // 团队项目
    const list = db.prepare('SELECT * FROM my_projects ORDER BY id DESC LIMIT 50').all()
    return res.json(success({ list }))
  }
  const list = db.prepare('SELECT * FROM my_projects WHERE owner_id = ? ORDER BY id DESC').all(req.user.id)
  res.json(success({ list }))
})

router.post('/my/project/add/script/new', authRequired, (req, res) => {
  const { projectId, title } = req.body
  const project = db.prepare('SELECT * FROM my_projects WHERE id = ?').get(projectId)
  if (!project) return res.json(fail('项目不存在', 404))
  db.prepare('INSERT INTO scripts (title, content, category, status, owner_id, owner_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title || '新脚本', '', project.industry, 'draft', req.user.id, req.user.name)
  db.prepare('UPDATE my_projects SET script_count = script_count + 1 WHERE id = ?').run(projectId)
  res.json(success(null, '创建成功'))
})

router.post('/my/project/delete/script', authRequired, (req, res) => {
  const { id } = req.body
  db.prepare('DELETE FROM scripts WHERE id = ? AND owner_id = ?').run(id, req.user.id)
  res.json(success(null, '删除成功'))
})

router.post('/my/project/edit/script/name', authRequired, (req, res) => {
  const { id, name } = req.body
  db.prepare('UPDATE scripts SET title = ? WHERE id = ? AND owner_id = ?').run(name, id, req.user.id)
  res.json(success(null, '重命名成功'))
})

// ============ 合作伙伴 / 提现 ============
router.get('/withdraw/init', authRequired, (req, res) => {
  const user = req.user
  const inviteCount = db.prepare('SELECT COUNT(*) c FROM users WHERE created_by = ?').get(user.id).c
  const totalWithdrawn = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM withdraw_records WHERE owner_id = ? AND status = 'success'").get(user.id).s
  res.json(success({
    balance: 0,
    inviteCode: user.invite_code || '',
    inviteCount,
    totalWithdrawn,
    minWithdraw: 100,
    rule: '邀请好友注册并消费，可获得消费金额10%的返利奖励',
  }))
})

router.get('/withdraw/page/init', authRequired, (req, res) => {
  const user = req.user
  const invitees = db.prepare('SELECT id, name, phone, avatar, created_at FROM users WHERE created_by = ? ORDER BY id DESC LIMIT 50').all(user.id)
  res.json(success({ list: invitees }))
})

router.post('/withdraw/submit', authRequired, (req, res) => {
  const { amount, account } = req.body
  if (!amount || amount < 100) return res.json(fail('最低提现金额为100元', 400))
  db.prepare('INSERT INTO withdraw_records (amount, account, owner_id) VALUES (?, ?, ?)')
    .run(amount, account || '', req.user.id)
  res.json(success(null, '提现申请已提交'))
})

router.get('/withdraw/withdrawal/log', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM withdraw_records WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare('SELECT * FROM withdraw_records WHERE owner_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/withdraw/invite/friend', authRequired, (req, res) => {
  const user = req.user
  res.json(success({ inviteCode: user.invite_code, inviteLink: `https://merchant.yimetai.com/register?code=${user.invite_code}` }))
})

router.get('/withdraw/friend/recharge', authRequired, (req, res) => {
  const list = db.prepare(`
    SELECT u.id, u.name, u.avatar, o.amount, o.created_at
    FROM users u JOIN charge_orders o ON o.owner_id = u.id
    WHERE u.created_by = ? AND o.status = 'paid'
    ORDER BY o.id DESC LIMIT 50
  `).all(req.user.id)
  res.json(success({ list }))
})

router.post('/withdraw/add/binding/info', authRequired, (req, res) => {
  const { account } = req.body
  try {
    db.prepare('UPDATE users SET withdraw_account = ? WHERE id = ?').run(account || '', req.user.id)
  } catch {
    // 字段不存在时静默忽略（旧库无该列）
  }
  res.json(success(null, '绑定成功'))
})

// ============ 数字人形象库 ============
router.get('/ip/avatar/filter/List', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM avatars ORDER BY id DESC LIMIT 100').all()
  res.json(success({ list }))
})

router.get('/ip/avatar/industry/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'ecommerce', name: '电商带货' },
      { key: 'knowledge', name: '知识口播' },
      { key: 'beauty', name: '美妆护肤' },
      { key: 'food', name: '餐饮美食' },
    ],
  }))
})

router.get('/ip/avatar/person/init/info', authRequired, (req, res) => {
  res.json(success({
    voices: [
      { id: 1, name: '温柔女声', sample: '' },
      { id: 2, name: '激昂男声', sample: '' },
      { id: 3, name: '甜美女声', sample: '' },
      { id: 4, name: '沉稳男声', sample: '' },
    ],
    backgrounds: ['纯色背景', '办公室', '书房', '直播间', '室外街景'],
  }))
})

router.get('/ip/avatar/background/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { id: 1, name: '纯色背景', url: '/images/avatar/bg_1.png' },
      { id: 2, name: '办公室', url: '/images/avatar/bg_2.png' },
      { id: 3, name: '书房', url: '/images/avatar/bg_3.png' },
    ],
  }))
})

router.get('/ip/avatar/voice/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { id: 1, name: '温柔女声', gender: 'female' },
      { id: 2, name: '激昂男声', gender: 'male' },
      { id: 3, name: '甜美女声', gender: 'female' },
      { id: 4, name: '沉稳男声', gender: 'male' },
    ],
  }))
})

// ============ AI商拍模板 ============
router.get('/ai/commerce/photo/template/list/v2', authRequired, (req, res) => {
  const { category, direction, pageNum = 1, pageSize = 20 } = req.query
  const conds = []
  const args = []
  if (category && category !== 'all') { conds.push('category = ?'); args.push(category) }
  if (direction && direction !== 'all') { conds.push('direction = ?'); args.push(direction) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM commerce_templates ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM commerce_templates ${where} ORDER BY usage_count DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/ai/commerce/photo/template/generate/category/create', authRequired, (req, res) => {
  res.json(success({ list: [] }))
})

router.get('/ai/commerce/photo/template/generate/direction/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'white_bg', name: '白底图' },
      { key: 'scene', name: '场景图' },
      { key: 'model', name: '模特图' },
      { key: 'detail', name: '细节图' },
    ],
  }))
})

router.get('/ai/commerce/photo/demo/list', authRequired, (req, res) => {
  res.json(success({ list: [] }))
})

router.get('/ai/commerce/photo/initInfo', authRequired, (req, res) => {
  res.json(success({
    categories: ['服装鞋包', '美妆护肤', '食品饮料', '数码家电', '家居日用'],
    sizes: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    tips: ['上传清晰的产品图片效果更佳', '建议图片尺寸不小于800x800'],
  }))
})

// ============ 案例教程 ============
router.get('/case/course/category/list', authRequired, (req, res) => {
  res.json(success({
    list: [
      { key: 'beginner', name: '新手入门' },
      { key: 'ecommerce', name: '电商带货' },
      { key: 'brand', name: '品牌宣传' },
    ],
  }))
})

router.get('/case/course/demo/list', authRequired, (req, res) => {
  res.json(success({ list: [] }))
})

export default router
