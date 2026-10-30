import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { teamCond } from '../utils/teamScope.js'

const router = express.Router()

// ============ 智能剪辑项目 ============
router.get('/ai-mix/list', authRequired, (req, res) => {
  const { keyword, status, pageNum = 1, pageSize = 12 } = req.query
  const conds = ['owner_id = ?']
  const args = [req.user.id]
  if (keyword) { conds.push('name LIKE ?'); args.push(`%${keyword}%`) }
  if (status) { conds.push('status = ?'); args.push(status) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM mix_projects ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM mix_projects ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/ai-mix/detail', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM mix_projects WHERE id = ? AND owner_id = ?').get(req.query.id, req.user.id)
  if (!p) return res.json(fail('项目不存在', 404))
  if (p.timeline) p.timeline = JSON.parse(p.timeline)
  res.json(success(p))
})

router.post('/ai-mix/save', authRequired, (req, res) => {
  const { id, name, script_id, brand_id, timeline, duration } = req.body
  if (!name) return res.json(fail('请输入项目名称', 400))
  if (id) {
    db.prepare("UPDATE mix_projects SET name = ?, script_id = ?, brand_id = ?, timeline = ?, duration = ?, updated_at = datetime('now','localtime') WHERE id = ? AND owner_id = ?")
      .run(name, script_id, brand_id, timeline ? JSON.stringify(timeline) : null, duration || 0, id, req.user.id)
    return res.json(success({ id: +id }, '保存成功'))
  }
  const info = db.prepare(`INSERT INTO mix_projects (name, script_id, brand_id, timeline, duration, owner_id)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(name, script_id, brand_id, timeline ? JSON.stringify(timeline) : null, duration || 0, req.user.id)
  res.json(success({ id: info.lastInsertRowid }, '保存成功'))
})

router.post('/ai-mix/delete', authRequired, (req, res) => {
  db.prepare('DELETE FROM mix_projects WHERE id = ? AND owner_id = ?').run(req.body.id, req.user.id)
  res.json(success(null, '删除成功'))
})

// 导出（mock）
router.post('/ai-mix/export', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM mix_projects WHERE id = ? AND owner_id = ?').get(req.body.id, req.user.id)
  if (!p) return res.json(fail('项目不存在', 404))
  db.prepare("UPDATE mix_projects SET status = 'exported', updated_at = datetime('now','localtime') WHERE id = ?").run(p.id)
  const videoUrl = 'https://mcnvideo.yimetai.com/yyai/1784719717214.mp4'
  db.prepare(`INSERT INTO works (name, type, url, cover, duration, source_module, source_id, owner_id)
              VALUES (?, 'video', ?, ?, ?, 'mix', ?, ?)`)
    .run(p.name, videoUrl, p.cover || videoUrl, p.duration || 30, p.id, req.user.id)
  res.json(success({ url: videoUrl, jianyingUrl: 'https://www.capcut.cn/' }))
})

// AI混剪 - 智能匹配素材（限团队域内素材）
router.post('/ai-mix/smart-match', authRequired, (req, res) => {
  const { script_id } = req.body
  const scope = teamCond(req.user.id)
  const materials = db.prepare(`SELECT * FROM materials WHERE type = 'video' AND ${scope.clause} ORDER BY RANDOM() LIMIT 8`).all(...scope.args)
  res.json(success({
    matched: materials.map((m, i) => ({ ...m, segment: i + 1 })),
    unmatched: [],
  }))
})

export default router
