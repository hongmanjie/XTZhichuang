import express from 'express'
import multer from 'multer'
import fs from 'fs'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, asyncHandler } from '../utils/response.js'
import { teamCond } from '../utils/teamScope.js'
import { localMediaPath, probeMedia } from '../services/mediaTools.js'
import { uploadVoice, deleteVoice, indexTtsStatus } from '../services/indexTts.js'
import { createTask } from '../services/aiEngine.js'
import { splitScript, SUBTITLE_STYLES, validateSubtitleSegments } from '../services/subtitleBurn.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.get('/voice/status', authRequired, asyncHandler(async (req, res) => {
  res.json(success(await indexTtsStatus()))
}))

async function subtitleVideo(userId, videoUrl) {
  if (typeof videoUrl !== 'string') throw new Error('请选择视频')
  const scope = teamCond(userId)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'video' AND ${scope.clause}`).get(videoUrl, ...scope.args)
  const file = localMediaPath(videoUrl)
  if (!material || !file || !fs.existsSync(file)) throw new Error('视频不存在或无权使用')
  let video
  try { video = await probeMedia(file) } catch { throw new Error('视频文件无效或无法读取') }
  if (video.duration > 180 || Math.max(video.width, video.height) > 1920 || Math.min(video.width, video.height) > 1080) {
    throw new Error('字幕处理暂支持 180 秒以内、最大 1080p 的视频')
  }
  return video
}

router.post('/voice/subtitles/estimate', authRequired, asyncHandler(async (req, res) => {
  const { videoUrl, text } = req.body
  if (typeof text !== 'string' || !text.trim() || text.length > 600) return res.json(fail('请输入 1–600 字的字幕文案', 400))
  try {
    const video = await subtitleVideo(req.user.id, videoUrl)
    const draft = splitScript(text, video.duration).map((segment) => ({ ...segment, start: +segment.start.toFixed(2), end: +segment.end.toFixed(2) }))
    const segments = validateSubtitleSegments(draft, video.duration)
    res.json(success({ duration: video.duration, segments, timing: 'estimated' }))
  } catch (error) { res.json(fail(error.message, 400)) }
}))

router.post('/voice/subtitles/create', authRequired, asyncHandler(async (req, res) => {
  const { videoUrl, segments, style = 'pure' } = req.body
  if (typeof style !== 'string' || !Object.hasOwn(SUBTITLE_STYLES, style)) return res.json(fail('字幕样式无效', 400))
  try {
    const video = await subtitleVideo(req.user.id, videoUrl)
    const checked = validateSubtitleSegments(segments, video.duration)
    const task = createTask(req.user.id, 'subtitleEdit', { videoUrl, segments: checked, style }, 0)
    res.json(success(task))
  } catch (error) { res.json(fail(error.message, 400)) }
}))

router.get('/voice/profiles', authRequired, (req, res) => {
  const list = db.prepare('SELECT id, name, created_at FROM voice_profiles WHERE owner_id = ? ORDER BY id DESC').all(req.user.id)
  res.json(success(list))
})

router.post('/voice/profiles', authRequired, upload.single('audio'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name || name.length > 50) return res.json(fail('请输入 1–50 字的音色名称', 400))
  if (req.body.consent !== 'true') return res.json(fail('请确认已获得音色使用授权', 400))
  if (!req.file) return res.json(fail('请上传参考音频', 400))
  try { res.json(success(await uploadVoice(req.user.id, name, req.file.buffer, req.file.originalname))) }
  catch (error) { res.json(fail(error.message, 400)) }
}))

router.delete('/voice/profiles/:id', authRequired, asyncHandler(async (req, res) => {
  try { await deleteVoice(req.user.id, Number(req.params.id)); res.json(success(null, '音色已删除')) }
  catch (error) { res.json(fail(error.message, 400)) }
}))

router.post('/voice/dub', authRequired, asyncHandler(async (req, res) => {
  const { videoUrl, voiceId, text, mode = 'replace', speed = 1, lang = 'zh', subtitle = false } = req.body
  if (typeof text !== 'string' || !text.trim() || text.length > 600) return res.json(fail('请输入 1–600 字的配音文案', 400))
  if (!['replace', 'mix'].includes(mode) || !Number.isFinite(Number(speed)) || Number(speed) < 0.5 || Number(speed) > 2 || !['zh', 'en', 'ja', 'es', 'ar', 'zhen'].includes(lang)) return res.json(fail('配音参数无效', 400))
  const voice = db.prepare('SELECT id FROM voice_profiles WHERE id = ? AND owner_id = ?').get(Number(voiceId), req.user.id)
  if (!voice) return res.json(fail('请选择自己上传的音色', 400))
  const scope = teamCond(req.user.id)
  const material = db.prepare(`SELECT id FROM materials WHERE url = ? AND type = 'video' AND ${scope.clause}`).get(videoUrl, ...scope.args)
  const file = localMediaPath(videoUrl)
  if (!material || !file || !fs.existsSync(file)) return res.json(fail('视频不存在或无权使用，请先上传视频', 400))
  if (!process.env.INDEX_TTS_BASE_URL) return res.json(fail('IndexTTS 服务地址尚未配置', 503))
  if (typeof subtitle !== 'boolean') return res.json(fail('字幕选项无效', 400))
  const health = await indexTtsStatus()
  if (health.available === false) return res.json(fail('音色服务暂时不可连接，请检查网络或稍后重试', 503))
  const task = createTask(req.user.id, 'voiceDub', { videoUrl, voiceId: Number(voiceId), text: text.trim(), mode, speed: Number(speed), lang, subtitle }, 0)
  res.json(success(task))
}))

export default router
