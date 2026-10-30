import db from '../db.js'
import { analyzeVideo } from './videoAnalysis.js'

// Current gateway only exposes text chat. Use the actual reference speech/OCR,
// and explicitly avoid pretending to understand its visual content.
export async function prepareReferenceVideo(params, context) {
  const row = db.prepare('SELECT params FROM ai_tasks WHERE id = ? AND status = ?').get(context.taskId, 'running')
  if (!row) throw new Error('任务不存在或已停止')
  const saved = JSON.parse(row.params || '{}')
  let reference = saved.referenceAnalysis
  if (!reference) {
    saved.referencePhase = 'analyzing'
    db.prepare("UPDATE ai_tasks SET params = ? WHERE id = ? AND status = 'running'").run(JSON.stringify(saved), context.taskId)
    context.onStage('正在识别参考视频的语音和画面文字')
    const result = await analyzeVideo({ videoUrl: params.videoUrl }, context.onStage)
    const analysis = result.analysis
    const transcript = String(analysis.transcript || '').trim().slice(0, 2500)
    const ocr = [...new Set((analysis.frames || []).map((frame) => String(frame.text || '').trim()).filter(Boolean))].join('\n').slice(0, 1500)
    if (!transcript && !ocr) throw new Error('参考视频没有识别出语音或文字，当前无法据此生成；请更换素材')
    reference = { transcript, ocr, duration: analysis.duration, warnings: result.warnings || [] }
    saved.referenceAnalysis = reference
    saved.referencePhase = 'ready'
    const updated = db.prepare("UPDATE ai_tasks SET params = ? WHERE id = ? AND status = 'running'").run(JSON.stringify(saved), context.taskId)
    if (updated.changes !== 1) throw new Error('任务状态已变化')
  }
  const prompt = [
    `用户的新视频要求：${params.prompt}`,
    reference.transcript ? `参考视频语音转写（可能有误，仅供理解文案）：${reference.transcript}` : '',
    reference.ocr ? `参考视频抽帧文字（可能有误，仅供参考）：${reference.ocr}` : '',
    '依据用户要求和可确认的文字创作新视频，不要照搬参考中的未经确认的品牌、价格、数据或功效。不要假设你看过参考视频画面。',
  ].filter(Boolean).join('\n').slice(0, 5000)
  return { reference, prompt }
}
