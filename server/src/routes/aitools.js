import express from 'express'
import { success, fail, asyncHandler } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { mgEnabled, mgASR, mgOCR, mgSAM, MODEL_CATALOG } from '../services/aiProviders.js'

const router = express.Router()

// ============ ModelGate AI 工具（OCR / 语音转写 / 目标分割） ============

// 工具可用性与模型清单
router.get('/ai/tools/status', authRequired, (req, res) => {
  res.json(success({ enabled: mgEnabled(), models: MODEL_CATALOG.tools }))
})

// 图片文字识别（OCR）：body { image: url|base64|dataURL }
router.post('/ai/tools/ocr', authRequired, asyncHandler(async (req, res) => {
  const { image } = req.body
  if (!image) return res.json(fail('缺少 image 参数', 400))
  if (!mgEnabled()) return res.json(fail('ModelGate 未启用', 503))
  try {
    const out = await mgOCR(image)
    res.json(success(out))
  } catch (e) {
    console.warn(`[AI工具] OCR失败: ${e.message}`)
    res.json(fail(`OCR失败: ${e.message.slice(0, 150)}`))
  }
}))

// 语音转写（ASR）：body { audio: url|base64|dataURL, format? }
router.post('/ai/tools/asr', authRequired, asyncHandler(async (req, res) => {
  const { audio, format } = req.body
  if (!audio) return res.json(fail('缺少 audio 参数', 400))
  if (!mgEnabled()) return res.json(fail('ModelGate 未启用', 503))
  try {
    const text = await mgASR(audio, { format })
    res.json(success({ text }))
  } catch (e) {
    console.warn(`[AI工具] ASR失败: ${e.message}`)
    res.json(fail(`转写失败: ${e.message.slice(0, 150)}`))
  }
}))

// 目标分割（SAM3）：body { image, text?, boxes?, points?, conf? }
router.post('/ai/tools/segment', authRequired, asyncHandler(async (req, res) => {
  const { image, text, boxes, points, conf } = req.body
  if (!image) return res.json(fail('缺少 image 参数', 400))
  if (!mgEnabled()) return res.json(fail('ModelGate 未启用', 503))
  try {
    const masks = await mgSAM(image, { text, boxes, points, conf })
    res.json(success({ masks, count: masks.length }))
  } catch (e) {
    console.warn(`[AI工具] SAM失败: ${e.message}`)
    res.json(fail(`分割失败: ${e.message.slice(0, 150)}`))
  }
}))

export default router
