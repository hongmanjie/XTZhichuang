// ============================================================
// 文件存储工具：统一 UPLOAD_DIR 定义（全服务端唯一来源），
// 提供本地 URL → 物理路径解析与「无引用才删」的安全清理
// ============================================================
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 与 index.js 静态服务目录保持一致：server/uploads（可用环境变量覆盖）
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// 本地可服务的 URL 形态：/api/files/<sub>/<file>、/api/material/files/<sub>/<file>、/uploads/<file>
export function localPathOf(url) {
  if (!url || typeof url !== 'string') return null
  let rel = null
  const m = url.match(/^\/api\/(?:material\/)?files\/(.+)$/)
  if (m) rel = m[1]
  else if (url.startsWith('/uploads/')) rel = url.slice('/uploads/'.length)
  if (!rel) return null // 外链（CDN 等）不在本地管理范围
  const abs = path.resolve(UPLOAD_DIR, rel)
  // 防目录穿越：必须落在 UPLOAD_DIR 内
  if (!abs.startsWith(UPLOAD_DIR + path.sep) && abs !== UPLOAD_DIR) return null
  return abs
}

// 该 URL 是否仍被其它数据行引用（素材/作品/任务结果/高光片段/混剪工程）
function isReferenced(url, exclude = {}) {
  if (!url) return false
  const like = `%${url}%`
  const checks = []
  if (!exclude.materials) checks.push(db.prepare('SELECT 1 FROM materials WHERE url = ? OR cover = ? LIMIT 1').get(url, url))
  if (!exclude.works) checks.push(db.prepare('SELECT 1 FROM works WHERE url = ? OR cover = ? LIMIT 1').get(url, url))
  checks.push(db.prepare('SELECT 1 FROM ai_tasks WHERE result LIKE ? LIMIT 1').get(like))
  checks.push(db.prepare("SELECT 1 FROM ai_tasks WHERE params LIKE ? AND status IN ('pending', 'running', 'reconciling') LIMIT 1").get(like))
  checks.push(db.prepare('SELECT 1 FROM long_video_segments WHERE result_url = ? OR first_frame_url = ? LIMIT 1').get(url, url))
  checks.push(db.prepare('SELECT 1 FROM highlight_clips WHERE video_url = ? OR cover = ? LIMIT 1').get(url, url))
  checks.push(db.prepare('SELECT 1 FROM mix_projects WHERE timeline LIKE ? OR cover = ? LIMIT 1').get(url, url))
  return checks.some(Boolean)
}

// 安全删除一组 URL 对应的本地文件：仅当不再被任何表引用且文件确实存在时才删除
export function cleanupFiles(urls, { skipRefCheck = false } = {}) {
  let removed = 0
  for (const url of urls.filter(Boolean)) {
    const abs = localPathOf(url)
    if (!abs) continue
    try {
      if (!fs.existsSync(abs)) continue
      if (!skipRefCheck && isReferenced(url)) continue
      fs.unlinkSync(abs)
      removed++
    } catch (e) {
      console.warn(`[fileStore] 删除文件失败 ${url}: ${e.message}`)
    }
  }
  return removed
}
