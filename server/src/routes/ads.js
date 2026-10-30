import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { teamCond } from '../utils/teamScope.js'

const router = express.Router()

// ============ 广告账户（团队域） ============
router.get('/ad/launch/advertiser/list', authRequired, (req, res) => {
  const { keyword, platform, pageNum = 1, pageSize = 10 } = req.query
  const scope = teamCond(req.user.id)
  const conds = [scope.clause]
  const args = [...scope.args]
  if (keyword) { conds.push('name LIKE ?'); args.push(`%${keyword}%`) }
  if (platform) { conds.push('platform = ?'); args.push(platform) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM advertisers ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM advertisers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/ad/launch/advertiser/save', authRequired, (req, res) => {
  const { id, name, platform, advertiser_id } = req.body
  if (!name) return res.json(fail('请输入账户名称', 400))
  if (id) {
    const scope = teamCond(req.user.id)
    const own = db.prepare(`SELECT id FROM advertisers WHERE id = ? AND ${scope.clause}`).get(id, ...scope.args)
    if (!own) return res.json(fail('账户不存在', 404))
    db.prepare('UPDATE advertisers SET name = ?, platform = ?, advertiser_id = ? WHERE id = ?')
      .run(name, platform, advertiser_id, id)
  } else {
    db.prepare('INSERT INTO advertisers (name, platform, advertiser_id, owner_id) VALUES (?, ?, ?, ?)')
      .run(name, platform, advertiser_id, req.user.id)
  }
  res.json(success(null, '保存成功'))
})

router.post('/ad/launch/advertiser/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  const scope = teamCond(req.user.id)
  ids.forEach((id) => {
    db.prepare(`DELETE FROM advertisers WHERE id = ? AND ${scope.clause}`).run(id, ...scope.args)
  })
  res.json(success(null, '删除成功'))
})

// ============ 广告组（经所属账户限定团队域） ============
router.get('/ad/launch/group/list', authRequired, (req, res) => {
  const { advertiser_id, status, pageNum = 1, pageSize = 10 } = req.query
  const scope = teamCond(req.user.id, 'a.owner_id')
  const conds = [scope.clause]
  const args = [...scope.args]
  if (advertiser_id) { conds.push('g.advertiser_id = ?'); args.push(advertiser_id) }
  if (status) { conds.push('g.status = ?'); args.push(status) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM ad_groups g LEFT JOIN advertisers a ON a.id = g.advertiser_id ${where}`).get(...args).c
  const list = db.prepare(`
    SELECT g.*, a.name as advertiser_name FROM ad_groups g
    LEFT JOIN advertisers a ON a.id = g.advertiser_id
    ${where}
    ORDER BY g.id DESC LIMIT ? OFFSET ?
  `).all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/ad/launch/group/save', authRequired, (req, res) => {
  const { id, name, advertiser_id, budget } = req.body
  if (!name) return res.json(fail('请输入广告组名称', 400))
  const scope = teamCond(req.user.id, 'a.owner_id')
  if (id) {
    const own = db.prepare(`SELECT g.id FROM ad_groups g LEFT JOIN advertisers a ON a.id = g.advertiser_id WHERE g.id = ? AND ${scope.clause}`)
      .get(id, ...scope.args)
    if (!own) return res.json(fail('广告组不存在', 404))
    db.prepare('UPDATE ad_groups SET name = ?, advertiser_id = ?, budget = ? WHERE id = ?')
      .run(name, advertiser_id, budget, id)
  } else {
    db.prepare('INSERT INTO ad_groups (name, advertiser_id, budget) VALUES (?, ?, ?)')
      .run(name, advertiser_id, budget)
  }
  res.json(success(null, '保存成功'))
})

router.post('/ad/launch/group/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  const scope = teamCond(req.user.id, 'a.owner_id')
  ids.forEach((id) => {
    db.prepare(`DELETE FROM ad_groups WHERE id IN (
      SELECT g.id FROM ad_groups g LEFT JOIN advertisers a ON a.id = g.advertiser_id
      WHERE g.id = ? AND ${scope.clause})`).run(id, ...scope.args)
  })
  res.json(success(null, '删除成功'))
})

// ============ 投放数据 ============
// 数据总览
router.get('/ad/launch/data/overview', authRequired, (req, res) => {
  const days = +(req.query.days || 7)
  const data = db.prepare(`
    SELECT date,
      SUM(cost) as cost, SUM(impression) as impression,
      SUM(click) as click, SUM(conversion) as conversion
    FROM ad_data GROUP BY date ORDER BY date DESC LIMIT ?
  `).all(days).reverse()

  const total = db.prepare(`
    SELECT SUM(cost) as cost, SUM(impression) as impression, SUM(click) as click, SUM(conversion) as conversion
    FROM ad_data
  `).get()

  res.json(success({
    trend: data,
    total: {
      cost: total.cost || 0,
      impression: total.impression || 0,
      click: total.click || 0,
      conversion: total.conversion || 0,
      ctr: total.impression ? ((total.click / total.impression) * 100).toFixed(2) : 0,
      roi: total.cost ? (total.conversion * 50 / total.cost).toFixed(2) : 0,
    },
  }))
})

// 数据列表（分页）
router.get('/ad/launch/data/list', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 10 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM ad_data').get().c
  const list = db.prepare(`
    SELECT d.*, a.name as advertiser_name FROM ad_data d
    LEFT JOIN advertisers a ON a.id = d.advertiser_id
    ORDER BY d.date DESC, d.id DESC LIMIT ? OFFSET ?
  `).all(+pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

// 数据详情
router.get('/ad/launch/data/detail', authRequired, (req, res) => {
  const d = db.prepare('SELECT * FROM ad_data WHERE id = ?').get(req.query.id)
  if (!d) return res.json(fail('数据不存在', 404))
  res.json(success(d))
})

// 页面初始化
router.get('/ad/launch/page/init', authRequired, (req, res) => {
  const platforms = [
    { key: 'qianchuan', name: '巨量千川' },
    { key: 'gdt', name: '腾讯广告' },
    { key: 'kuaishou', name: '磁力金牛' },
    { key: 'juliang', name: '聚量引擎' },
  ]
  res.json(success({ platforms }))
})

// 下拉初始化
router.get('/ad/launch/dropdown/init', authRequired, (req, res) => {
  res.json(success({
    statusOptions: [
      { key: 'running', name: '投放中' },
      { key: 'paused', name: '已暂停' },
    ],
    sortOptions: [
      { key: 'cost', name: '消耗' },
      { key: 'impression', name: '曝光' },
      { key: 'click', name: '点击' },
      { key: 'conversion', name: '转化' },
    ],
  }))
})

// 是否显示入口

// 是否显示入口
router.get('/ad/launch/if/show', authRequired, (req, res) => {
  res.json(success({ show: true }))
})

// ============ 素材投放数据（视频管理） ============
router.get('/ad/launch/video/manager/list', authRequired, (req, res) => {
  res.json(page([], 0))
})

router.post('/ad/launch/video/manager/submit', authRequired, (req, res) => {
  res.json(success(null, '提交成功'))
})

router.post('/ad/launch/video/manager/batch/submit', authRequired, (req, res) => {
  res.json(success(null, '批量提交成功'))
})

export default router
