import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { teamCond } from '../utils/teamScope.js'

const router = express.Router()

// ============ 部门 ============
router.get('/department/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM departments ORDER BY sort, id').all()
  res.json(success(list))
})

router.post('/department/save', authRequired, adminRequired, (req, res) => {
  const { id, name, parent_id = 0, sort = 0 } = req.body
  if (!name) return res.json(fail('请输入部门名称', 400))
  if (id) {
    db.prepare("UPDATE departments SET name = ?, parent_id = ?, sort = ? WHERE id = ?").run(name, parent_id, sort, id)
  } else {
    db.prepare('INSERT INTO departments (name, parent_id, sort) VALUES (?, ?, ?)').run(name, parent_id, sort)
  }
  res.json(success(null, '保存成功'))
})

router.post('/department/delete', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.body.id)
  db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(req.body.id)
  res.json(success(null, '删除成功'))
})

// ============ 品牌客户（团队域） ============
router.get('/brand/list', authRequired, (req, res) => {
  const scope = teamCond(req.user.id, 'b.owner_id')
  const list = db.prepare(`
    SELECT b.*, d.name as department_name,
      (SELECT COUNT(*) FROM materials m WHERE m.brand_id = b.id) as material_count
    FROM brands b LEFT JOIN departments d ON d.id = b.department_id
    WHERE ${scope.clause}
    ORDER BY b.id DESC
  `).all(...scope.args)
  res.json(success(list))
})

router.post('/brand/save', authRequired, (req, res) => {
  const { id, name, industry, remark, logo } = req.body
  if (!name) return res.json(fail('请输入品牌名称', 400))
  if (id) {
    const scope = teamCond(req.user.id)
    const own = db.prepare(`SELECT id FROM brands WHERE id = ? AND ${scope.clause}`).get(id, ...scope.args)
    if (!own) return res.json(fail('品牌不存在', 404))
    db.prepare("UPDATE brands SET name = ?, industry = ?, remark = ?, logo = ? WHERE id = ?")
      .run(name, industry, remark, logo, id)
  } else {
    db.prepare('INSERT INTO brands (name, industry, remark, logo, owner_id, department_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, industry, remark, logo, req.user.id, req.user.department_id)
  }
  res.json(success(null, '保存成功'))
})

router.post('/brand/delete', authRequired, (req, res) => {
  const scope = teamCond(req.user.id)
  const r = db.prepare(`DELETE FROM brands WHERE id = ? AND ${scope.clause}`).run(req.body.id, ...scope.args)
  if (!r.changes) return res.json(fail('品牌不存在或无权删除', 404))
  res.json(success(null, '删除成功'))
})

// ============ 团队成员 ============
router.get('/team/member/list', authRequired, (req, res) => {
  const { keyword, department_id, pageNum = 1, pageSize = 10 } = req.query
  const conds = []
  const args = []
  if (keyword) {
    conds.push('(u.name LIKE ? OR u.account LIKE ?)')
    args.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (department_id) {
    conds.push('u.department_id = ?')
    args.push(department_id)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${where}`).get(...args).c
  const list = db.prepare(`
    SELECT u.id, u.name, u.account, u.phone, u.avatar, u.role_id, u.status, u.ai_points, u.created_at,
      r.name as role_name, d.name as department_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id
    ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?
  `).all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/team/member/save', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { id, name, account, phone, role_id, department_id, password = '123456' } = req.body
  if (!name || !account) return res.json(fail('请输入姓名和账号', 400))
  if (id) {
    db.prepare("UPDATE users SET name = ?, phone = ?, role_id = ?, department_id = ? WHERE id = ?")
      .run(name, phone, role_id, department_id, id)
  } else {
    const exist = db.prepare('SELECT id FROM users WHERE account = ?').get(account)
    if (exist) return res.json(fail('账号已存在', 400))
    const hash = await bcrypt.hash(password, 10)
    db.prepare('INSERT INTO users (account, password, name, phone, role_id, department_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(account, hash, name, phone, role_id || 3, department_id, req.user.id)
  }
  res.json(success(null, '保存成功'))
}))

router.post('/team/member/status', authRequired, adminRequired, (req, res) => {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(req.body.status, req.body.id)
  res.json(success(null, '操作成功'))
})

router.post('/team/member/delete', authRequired, adminRequired, (req, res) => {
  if (req.body.id === req.user.id) return res.json(fail('不能删除自己', 400))
  db.prepare('DELETE FROM users WHERE id = ?').run(req.body.id)
  res.json(success(null, '删除成功'))
})

// ============ 角色 ============
router.get('/role/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM roles ORDER BY id').all()
  list.forEach((r) => { r.permissions = JSON.parse(r.permissions || '[]') })
  res.json(success(list))
})

router.post('/role/save', authRequired, adminRequired, (req, res) => {
  const { id, name, description, permissions } = req.body
  if (!name) return res.json(fail('请输入角色名称', 400))
  const permJson = JSON.stringify(permissions || [])
  if (id) {
    db.prepare('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?')
      .run(name, description, permJson, id)
  } else {
    db.prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)')
      .run(name, description, permJson)
  }
  res.json(success(null, '保存成功'))
})

router.post('/role/delete', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.body.id)
  res.json(success(null, '删除成功'))
})

router.get('/role/authority/info', authRequired, (req, res) => {
  // 全部权限点
  const authorities = [
    { key: 'dashboard', name: '创作中心' },
    { key: 'agent', name: 'AI Agent测试' },
    { key: 'asset-library', name: '资产库' },
    { key: 'hot', name: '爆款创作' },
    { key: 'ai-mix', name: '智能剪辑' },
    { key: 'create', name: 'AI创作' },
    { key: 'material_data', name: '投放数据' },
    { key: 'setting', name: '全部设置' },
    { key: 'team', name: '团队管理' },
    { key: 'partner', name: '合作伙伴' },
  ]
  res.json(success(authorities))
})

// ============ 用户组 ============
router.get('/user/group/list', authRequired, (req, res) => {
  res.json(success([
    { id: 1, name: '全员' },
    { id: 2, name: '创作组' },
    { id: 3, name: '投放组' },
  ]))
})

// ============ 合作伙伴 ============
router.get('/partner/info', authRequired, (req, res) => {
  const user = req.user
  const inviteCode = user.invite_code || String(user.id).padStart(6, '0')
  const invites = db.prepare("SELECT COUNT(*) c FROM users WHERE created_by = ?").get(user.id).c
  res.json(success({
    inviteCode,
    inviteLink: `https://merchant.yimetai.com/login?invite=${inviteCode}`,
    inviteCount: invites,
    rewardRate: 0.1,
  }))
})

router.get('/partner/withdrawal-records', authRequired, (req, res) => {
  res.json(page([], 0))
})

router.get('/partner/withdraw/list', authRequired, (req, res) => {
  res.json(success({
    balance: 0,
    withdrawable: 0,
    records: [],
  }))
})

export default router
