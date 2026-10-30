import express from 'express'
import fs from 'fs'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, asyncHandler } from '../utils/response.js'
import { teamCond } from '../utils/teamScope.js'
import { localMediaPath, probeMedia } from '../services/mediaTools.js'
import { realEnabled } from '../services/aiProviders.js'
import { createTask } from '../services/aiEngine.js'

const router = express.Router()
router.post('/video-analysis/create', authRequired, asyncHandler(async (req, res) => {
  const { videoUrl } = req.body
  const scope = teamCond(req.user.id)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'video' AND ${scope.clause}`).get(videoUrl, ...scope.args)
  const file = localMediaPath(videoUrl)
  if (!material || !file || !fs.existsSync(file)) return res.json(fail('视频不存在或无权使用，请先上传视频', 400))
  let info
  try { info = await probeMedia(file) } catch { return res.json(fail('视频文件无效', 400)) }
  if (info.duration > 120) return res.json(fail('当前支持不超过 120 秒的视频', 400))
  if (!realEnabled()) return res.json(fail('AI 引擎尚未启用', 503))
  const cost = 50
  if (req.user.ai_points < cost) return res.json(fail('AI 点数不足，请联系管理员', 400))
  const task = createTask(req.user.id, 'videoAnalysis', { videoUrl }, cost)
  res.json(success(task))
}))
export default router
