import db from '../db.js'
import { verifyToken } from './auth.js'
import { teamUserIds } from '../utils/teamScope.js'
import { localMediaPath } from '../services/mediaTools.js'

export function mediaAccess(req, res, next) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('yimetai_media='))
  let token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token && cookie) {
    try { token = decodeURIComponent(cookie.slice('yimetai_media='.length)) } catch { token = '' }
  }
  const payload = token && verifyToken(token)
  const user = payload && db.prepare('SELECT id FROM users WHERE id = ? AND status = 1').get(payload.id)
  if (!user) return res.status(401).end()
  const raw = req.path.replace(/^\/+/, '')
  const canonical = `/api/files/${raw}`
  if (!localMediaPath(canonical)) return res.status(404).end()
  let rel
  try { rel = decodeURIComponent(raw) } catch { return res.status(404).end() }
  const urls = [`/api/files/${rel}`, `/api/material/files/${rel}`, `/uploads/${rel}`]
  const ids = teamUserIds(user.id)
  const owners = ids.map(() => '?').join(',')
  const placeholders = urls.map(() => '?').join(',')
  const material = db.prepare(`SELECT 1 FROM materials WHERE owner_id IN (${owners}) AND (url IN (${placeholders}) OR cover IN (${placeholders})) LIMIT 1`).get(...ids, ...urls, ...urls)
  const work = material || db.prepare(`SELECT 1 FROM works WHERE owner_id IN (${owners}) AND (url IN (${placeholders}) OR cover IN (${placeholders})) LIMIT 1`).get(...ids, ...urls, ...urls)
  const asset = work || db.prepare(`SELECT 1 FROM human_assets WHERE owner_id IN (${owners}) AND url IN (${placeholders}) LIMIT 1`).get(...ids, ...urls)
  if (!asset) return res.status(404).end()
  return next()
}
