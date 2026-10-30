import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { indexMaterial } from '../services/aiEngine.js'
import { searchDocs, isESAvailable, deleteDoc } from '../services/esService.js'
import { teamUserIds, teamCond, canManage, splitManageable } from '../utils/teamScope.js'
import { UPLOAD_DIR, cleanupFiles } from '../utils/fileStore.js'
import { mediaAccess } from '../middleware/mediaAccess.js'

const router = express.Router()

// 统一使用 fileStore 的 UPLOAD_DIR（与静态服务目录一致，避免 cwd 依赖错位）
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// 扩展名白名单：不信任客户端 mimetype，阻止 .html/.svg/.js 等可执行内容上传
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.mp4', '.mov', '.webm', '.avi', '.mp3', '.wav', '.m4a', '.aac', '.ogg'])

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 10).replace(/-/g, ''))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}_${crypto.randomUUID()}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`不支持的文件类型 ${ext}`), false)
    const ok = /image\/|video\/|audio\//.test(file.mimetype)
    cb(ok ? null : new Error('仅支持图片/视频/音频文件'), ok)
  },
})

// 静态服务上传目录
router.use('/files', mediaAccess, express.static(UPLOAD_DIR))

// ============ 文件夹 ============
router.get('/folder/list', authRequired, (req, res) => {
  const list = db.prepare('SELECT * FROM material_folders WHERE owner_id = ? ORDER BY id').all(req.user.id)
  res.json(success(list))
})

router.post('/folder/save', authRequired, (req, res) => {
  const { name, parent_id = 0 } = req.body
  if (!name) return res.json(fail('请输入文件夹名称', 400))
  const info = db.prepare('INSERT INTO material_folders (name, parent_id, owner_id) VALUES (?, ?, ?)')
    .run(name, parent_id, req.user.id)
  res.json(success({ id: info.lastInsertRowid }))
})

router.post('/folder/delete', authRequired, (req, res) => {
  db.prepare('DELETE FROM material_folders WHERE id = ? AND owner_id = ?').run(req.body.id, req.user.id)
  res.json(success(null, '删除成功'))
})

// ============ 素材上传 ============
router.post('/material/upload', authRequired, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.json(fail('请选择文件', 400))
  const type = req.file.mimetype.startsWith('image') ? 'image' : req.file.mimetype.startsWith('video') ? 'video' : 'audio'
  const relUrl = `/api/files/${path.basename(path.dirname(req.file.path))}/${req.file.filename}`
  const info = db.prepare(`
    INSERT INTO materials (name, type, url, cover, size, category, owner_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'upload')
  `).run(
    Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
    type, relUrl, type === 'image' ? relUrl : '', req.file.size,
    req.body.category || '未分类', req.user.id
  )
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid)
  indexMaterial(material)
  res.json(success(material))
}))

// ============ 素材列表（支持ES搜索） ============
router.get('/material/list', authRequired, asyncHandler(async (req, res) => {
  const { keyword, type, category, folder_id, source, pageNum = 1, pageSize = 20 } = req.query
  const from = (+pageNum - 1) * +pageSize
  const scope = teamCond(req.user.id)

  // 有关键词且ES可用 → ES检索
  if (keyword && isESAvailable()) {
    try {
      const filters = [{ terms: { owner_id: teamUserIds(req.user.id) } }]
      if (type) filters.push({ term: { type } })
      if (category) filters.push({ term: { category } })
      if (source) filters.push({ term: { source } })
      if (folder_id) filters.push({ term: { folder_id: +folder_id } })
      const { total, list } = await searchDocs('materials', {
        keyword, filters, from, size: +pageSize,
        sort: [{ created_at: 'desc' }],
      })
      return res.json(page(list, total, +pageNum, +pageSize))
    } catch (e) {
      console.warn('[ES] 搜索失败，降级SQLite:', e.message)
    }
  }

  const conds = [scope.clause]
  const args = [...scope.args]
  if (type) { conds.push('type = ?'); args.push(type) }
  if (category) { conds.push('category = ?'); args.push(category) }
  if (folder_id) { conds.push('folder_id = ?'); args.push(folder_id) }
  if (source) { conds.push('source = ?'); args.push(source) }
  if (keyword) { conds.push('(name LIKE ? OR tags LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM materials ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM materials ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, from)
  res.json(page(list, total, +pageNum, +pageSize))
}))

// 素材详情（团队域内可见）
router.get('/material/detail', authRequired, (req, res) => {
  const scope = teamCond(req.user.id)
  const m = db.prepare(`SELECT * FROM materials WHERE id = ? AND ${scope.clause}`).get(req.query.id, ...scope.args)
  if (!m) return res.json(fail('素材不存在', 404))
  if (m.tags) m.tags = JSON.parse(m.tags)
  m.canManage = canManage(req.user.id, m.owner_id)
  res.json(success(m))
})

// 更新素材（分类/标签/重命名）：仅本人或团队主管
router.post('/material/update', authRequired, (req, res) => {
  const { id, name, category, tags } = req.body
  const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(id)
  if (!m) return res.json(fail('素材不存在', 404))
  if (!canManage(req.user.id, m.owner_id)) return res.json(fail('无权修改他人素材', 403))
  db.prepare("UPDATE materials SET name = COALESCE(?, name), category = COALESCE(?, category), tags = COALESCE(?, tags) WHERE id = ?")
    .run(name, category, tags ? JSON.stringify(tags) : null, id)
  const updated = db.prepare('SELECT * FROM materials WHERE id = ?').get(id)
  indexMaterial(updated)
  res.json(success(updated))
})

// 删除素材（支持批量）：仅本人或团队主管；删除后清理无引用的本地文件
router.post('/material/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的素材', 400))
  const rows = db.prepare(`SELECT id, owner_id, url, cover FROM materials WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  const { allowed, denied } = splitManageable(req.user.id, rows)
  if (allowed.length) {
    db.prepare(`DELETE FROM materials WHERE id IN (${allowed.map(() => '?').join(',')})`).run(...allowed)
    allowed.forEach((id) => deleteDoc('materials', id))
    // 清理磁盘文件（仍被作品/任务结果引用的URL不会删）
    const urls = rows.filter((r) => allowed.includes(r.id)).flatMap((r) => [r.url, r.cover])
    cleanupFiles(urls)
  }
  res.json(success({ deleted: allowed.length, denied: denied.length },
    denied.length ? `已删除${allowed.length}个，${denied.length}个无权限跳过` : `已删除${allowed.length}个素材`))
})

// 素材分类列表（团队域）
router.get('/material/categories', authRequired, (req, res) => {
  const scope = teamCond(req.user.id)
  const list = db.prepare(`SELECT category, COUNT(*) as count FROM materials WHERE ${scope.clause} GROUP BY category ORDER BY count DESC`).all(...scope.args)
  res.json(success(list))
})

// ============ 资产库统计（团队域，配额取用户 storage_total） ============
router.get('/asset/statistics', authRequired, (req, res) => {
  const scope = teamCond(req.user.id)
  const w = `FROM materials WHERE ${scope.clause}`
  const total = db.prepare(`SELECT COUNT(*) c ${w}`).get(...scope.args).c
  const imageCount = db.prepare(`SELECT COUNT(*) c ${w} AND type = 'image'`).get(...scope.args).c
  const videoCount = db.prepare(`SELECT COUNT(*) c ${w} AND type = 'video'`).get(...scope.args).c
  const audioCount = db.prepare(`SELECT COUNT(*) c ${w} AND type = 'audio'`).get(...scope.args).c
  const usedSize = db.prepare(`SELECT COALESCE(SUM(size), 0) s ${w}`).get(...scope.args).s
  const me = db.prepare('SELECT storage_total FROM users WHERE id = ?').get(req.user.id)
  res.json(success({
    total, imageCount, videoCount, audioCount,
    usedSize,
    totalSize: me?.storage_total || 10 * 1024 * 1024 * 1024,
  }))
})

// ============ 脚本（团队域可见，改/删限本人或主管） ============
router.get('/script/list', authRequired, (req, res) => {
  const { keyword, status, pageNum = 1, pageSize = 10 } = req.query
  const scope = teamCond(req.user.id)
  const conds = [scope.clause]
  const args = [...scope.args]
  if (keyword) { conds.push('(title LIKE ? OR content LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`) }
  if (status) { conds.push('status = ?'); args.push(status) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM scripts ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM scripts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  list.forEach((s) => { s.canManage = canManage(req.user.id, s.owner_id) })
  res.json(page(list, total, +pageNum, +pageSize))
})

router.get('/script/detail', authRequired, (req, res) => {
  const scope = teamCond(req.user.id)
  const s = db.prepare(`SELECT * FROM scripts WHERE id = ? AND ${scope.clause}`).get(req.query.id, ...scope.args)
  if (!s) return res.json(fail('脚本不存在', 404))
  s.canManage = canManage(req.user.id, s.owner_id)
  res.json(success(s))
})

router.post('/script/save', authRequired, (req, res) => {
  const { id, title, content, product_name, brand_id, category, status } = req.body
  if (!title) return res.json(fail('请输入脚本标题', 400))
  const wordCount = (content || '').length
  if (id) {
    const old = db.prepare('SELECT owner_id FROM scripts WHERE id = ?').get(id)
    if (!old) return res.json(fail('脚本不存在', 404))
    if (!canManage(req.user.id, old.owner_id)) return res.json(fail('无权修改他人脚本', 403))
    db.prepare("UPDATE scripts SET title = ?, content = ?, product_name = ?, brand_id = ?, category = ?, status = ?, word_count = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(title, content, product_name, brand_id, category, status || 'draft', wordCount, id)
    return res.json(success({ id: +id }, '保存成功'))
  }
  const info = db.prepare(`INSERT INTO scripts (title, content, product_name, brand_id, category, status, word_count, owner_id, owner_name)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title, content, product_name, brand_id, category, status || 'draft', wordCount, req.user.id, req.user.name)
  res.json(success({ id: info.lastInsertRowid }, '保存成功'))
})

router.post('/script/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的脚本', 400))
  const rows = db.prepare(`SELECT id, owner_id FROM scripts WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  const { allowed, denied } = splitManageable(req.user.id, rows)
  if (allowed.length) {
    db.prepare(`DELETE FROM scripts WHERE id IN (${allowed.map(() => '?').join(',')})`).run(...allowed)
    db.prepare(`DELETE FROM script_subitems WHERE script_id IN (${allowed.map(() => '?').join(',')})`).run(...allowed)
    allowed.forEach((id) => deleteDoc('scripts', id))
  }
  res.json(success({ deleted: allowed.length, denied: denied.length },
    denied.length ? `已删除${allowed.length}个，${denied.length}个无权限跳过` : '删除成功'))
})

// ============ 作品（团队域可见，删除限本人或主管，支持批量） ============
router.get('/work/list', authRequired, (req, res) => {
  const { source_module, keyword, pageNum = 1, pageSize = 12 } = req.query
  const scope = teamCond(req.user.id)
  const conds = [scope.clause]
  const args = [...scope.args]
  if (source_module) { conds.push('source_module = ?'); args.push(source_module) }
  if (keyword) { conds.push('name LIKE ?'); args.push(`%${keyword}%`) }
  const where = 'WHERE ' + conds.join(' AND ')
  const total = db.prepare(`SELECT COUNT(*) c FROM works ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM works ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, (+pageNum - 1) * +pageSize)
  list.forEach((w2) => { w2.canManage = canManage(req.user.id, w2.owner_id) })
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/work/delete', authRequired, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).map(Number).filter(Boolean)
  if (!ids.length) return res.json(fail('请选择要删除的作品', 400))
  const rows = db.prepare(`SELECT id, owner_id, url, cover FROM works WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  const { allowed, denied } = splitManageable(req.user.id, rows)
  if (allowed.length) {
    db.prepare(`DELETE FROM works WHERE id IN (${allowed.map(() => '?').join(',')})`).run(...allowed)
    const urls = rows.filter((r) => allowed.includes(r.id)).flatMap((r) => [r.url, r.cover])
    cleanupFiles(urls)
  }
  res.json(success({ deleted: allowed.length, denied: denied.length },
    denied.length ? `已删除${allowed.length}个，${denied.length}个无权限跳过` : '删除成功'))
})

export default router
