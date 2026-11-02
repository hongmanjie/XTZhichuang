import fs from 'node:fs'
import db from '../db.js'

export async function humanWordAlignment(taskId, audioPath, onStage = () => {}) {
  if ((process.env.ALIGNMENT_PROVIDER || 'disabled') === 'disabled') return null
  const base = (process.env.ALIGN_SERVICE_BASE_URL || '').replace(/\/+$/, '')
  const token = process.env.ALIGN_SERVICE_TOKEN || ''
  if (!/^https?:\/\//i.test(base) || token.length < 32) return null
  const row = db.prepare('SELECT subtitle_alignment FROM human_voice_workflows WHERE task_id = ?').get(taskId)
  if (row?.subtitle_alignment) {
    try { return JSON.parse(row.subtitle_alignment) } catch { return null }
  }
  try {
    const size = fs.statSync(audioPath).size
    if (!size || size > 24 * 1024 * 1024) return null
    onStage('正在对齐字幕时间')
    const data = await fs.openAsBlob(audioPath, { type: 'audio/wav' })
    const response = await fetch(`${base}/align`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` }, body: data, signal: AbortSignal.timeout(180000) })
    if (!response.ok) return null
    const result = await response.json()
    if (!Array.isArray(result?.tokens) || !result.tokens.length || result.tokens.length > 1200) return null
    db.prepare('UPDATE human_voice_workflows SET subtitle_alignment = ? WHERE task_id = ?').run(JSON.stringify(result.tokens), taskId)
    return result.tokens
  } catch { return null }
}
