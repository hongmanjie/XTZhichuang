// ============================================================
// 视频封面截帧服务：用 ffmpeg 从成片视频中抽取真实封面帧
// 解决历史问题：cover 由 .mp4 字符串替换成 .jpg 拼出来（文件不存在 → poster 404 黑屏）
// 或 mock 降级时用视频 URL 冒充封面（浏览器无法当图片渲染）
// 依赖：ffmpeg（PATH 中可用），单条失败返回 null 不阻塞业务
// ============================================================
import { execFile } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import db from '../db.js'
import { UPLOAD_DIR, localPathOf } from '../utils/fileStore.js'
import { FFMPEG } from './mediaTools.js'

function run(bin, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin} 失败: ${(stderr || err.message).slice(0, 300)}`))
      resolve({ stdout, stderr })
    })
  })
}

// 封面是否真实可用：必须是图片扩展名，且本地文件确实存在（视频冒充/拼出来的假路径都算无效）
export function isUsableCover(url) {
  if (!url || typeof url !== 'string') return false
  if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i.test(url)) return false
  if (!/\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(url)) return false
  const local = localPathOf(url)
  if (local) return fs.existsSync(local)
  return /^https?:\/\//.test(url) // 远程图片无法本地校验，视为可用
}

// 从视频截帧生成封面。输入支持本地平台 URL（/uploads/... /api/files/...）或远程 http 链接。
// 依次在 atSec / 0.5s / 0s 处尝试取帧，成功返回 /uploads/cov_*.jpg，失败返回 null
export async function ensureVideoCover(videoUrl, { atSec = 1.2 } = {}) {
  if (!videoUrl || typeof videoUrl !== 'string') return null
  const local = localPathOf(videoUrl)
  const input = local || (/^https?:\/\//.test(videoUrl) ? videoUrl : null)
  if (!input) return null
  if (local && !fs.existsSync(local)) return null

  const name = `cov_${Date.now()}_${crypto.randomInt(1000, 9999)}.jpg`
  const outPath = path.join(UPLOAD_DIR, name)
  for (const ss of [String(atSec), '0.5', '0']) {
    try {
      await run(FFMPEG, ['-y', '-ss', ss, '-i', input, '-frames:v', '1', '-q:v', '3', outPath])
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) return `/uploads/${name}`
    } catch { /* 尝试下一档时间点 */ }
  }
  try { fs.unlinkSync(outPath) } catch {}
  return null
}

// ---- DB 访问容错（封面补齐属于锦上添花，任何失败都不应影响启动） ----
function dbAll(sql, args = []) { try { return db.prepare(sql).all(...args) } catch (e) { console.warn(`[封面补齐] DB读取失败: ${e.message}`); return [] } }
function dbRun(sql, args = []) { try { return db.prepare(sql).run(...args) } catch (e) { console.warn(`[封面补齐] DB写入失败: ${e.message}`); return null } }

// 存量数据补齐：服务启动后后台执行一次。
// 扫描 ai_tasks.result.videos / materials / works 中封面无效的视频记录，ffmpeg 截帧补齐并回写 DB
export async function backfillVideoCovers({ maxTasks = 400 } = {}) {
  let fixed = 0
  const coverMap = new Map() // videoUrl -> 新封面（'' 表示确认无法截帧，避免重复尝试）

  const getCover = async (videoUrl) => {
    if (!videoUrl || coverMap.has(videoUrl)) return coverMap.get(videoUrl) ?? null
    const cover = (await ensureVideoCover(videoUrl)) || ''
    coverMap.set(videoUrl, cover)
    if (cover) fixed++
    return cover
  }

  // 1) ai_tasks.result.videos[].cover（"我的创作"等任务列表的封面来源）
  const tasks = dbAll(
    "SELECT id, result FROM ai_tasks WHERE status = 'success' AND result LIKE '%videos%' ORDER BY id DESC LIMIT ?",
    [maxTasks],
  )
  for (const t of tasks) {
    try {
      const result = JSON.parse(t.result || '{}')
      const videos = Array.isArray(result.videos) ? result.videos : []
      let changed = false
      for (const v of videos) {
        if (!v?.url || isUsableCover(v.cover)) continue
        const cover = await getCover(v.url)
        if (v.cover !== cover) { v.cover = cover; changed = true } // 无效封面置空或替换为真实截帧
      }
      if (changed) dbRun('UPDATE ai_tasks SET result = ? WHERE id = ?', [JSON.stringify(result), t.id])
    } catch { /* 单条损坏的 result 跳过 */ }
  }

  // 2) materials / works 表（资产库素材/作品网格的封面来源），按表回写
  const rows = [
    ...dbAll("SELECT id, url, cover FROM materials WHERE type = 'video'").map((r) => ({ ...r, tbl: 'materials' })),
    ...dbAll("SELECT id, url, cover FROM works WHERE type = 'video'").map((r) => ({ ...r, tbl: 'works' })),
  ]
  for (const r of rows) {
    if (isUsableCover(r.cover)) continue
    const cover = await getCover(r.url) // 同一视频复用步骤1的截帧结果
    if (r.cover !== cover) dbRun(`UPDATE ${r.tbl} SET cover = ? WHERE id = ?`, [cover, r.id])
  }

  console.log(`[封面补齐] 完成：本次修复 ${fixed} 个视频封面`)
  return fixed
}
