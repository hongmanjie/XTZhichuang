import fs from 'node:fs'
import db from '../db.js'
import { mgASRDetails } from './aiProviders.js'

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

// Approximate comparison only; ASR itself can be wrong and numbers/homophones
// may be transcribed differently, so any result still requires listening.
export function compareSpeechText(expected, transcript) {
  const a = Array.from(normalizeText(expected))
  const b = Array.from(normalizeText(transcript))
  if (!a.length) return { status: 'unavailable', reason: 'empty_script' }
  if (!b.length) return { status: 'review', transcript: String(transcript || ''), similarity: 0 }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]))
    }
    previous = current
  }
  const score = Math.max(0, 1 - previous[b.length] / Math.max(a.length, b.length))
  return { status: score >= 0.85 ? 'matched' : 'review', transcript: String(transcript || '').slice(0, 1000), similarity: Math.round(score * 1000) / 1000 }
}

export async function checkHumanSpeech(taskId, audioPath, expected, onStage = () => {}, parts = []) {
  const row = db.prepare('SELECT speech_check, speech_timing FROM human_voice_workflows WHERE task_id = ?').get(taskId)
  if (!row) return { status: 'unavailable', reason: 'workflow_missing' }
  if (row.speech_check) {
    try {
      const saved = JSON.parse(row.speech_check)
      if (saved.status !== 'checking') return saved
      const interrupted = { status: 'unavailable', reason: 'previous_check_interrupted' }
      db.prepare('UPDATE human_voice_workflows SET speech_check = ? WHERE task_id = ?').run(JSON.stringify(interrupted), taskId)
      return interrupted
    } catch { return { status: 'unavailable', reason: 'invalid_saved_check' } }
  }
  db.prepare('UPDATE human_voice_workflows SET speech_check = ? WHERE task_id = ?').run(JSON.stringify({ status: 'checking' }), taskId)
  onStage('正在核对口播内容')
  let result
  try {
    if (fs.statSync(audioPath).size > 24 * 1024 * 1024) throw new Error('音频超过核对大小限制')
    if (parts.length > 1) {
      const timing = JSON.parse(row.speech_timing || '[]')
      if (timing.length !== parts.length) throw new Error('配音片段时间信息无效')
      const segments = []
      for (let i = 0; i < parts.length; i++) {
        onStage(`正在核对第 ${i + 1}/${parts.length} 段配音`)
        const response = await mgASRDetails(parts[i].path, { format: 'wav' })
        segments.push({ text: response.text, start: timing[i].start, end: timing[i].end })
      }
      result = { ...compareSpeechText(expected, segments.map((segment) => segment.text).join('')), segments, timingMethod: 'tts_segments' }
    } else {
      const response = await mgASRDetails(audioPath, { format: 'wav' })
      result = {
        ...compareSpeechText(expected, response.text),
        segments: (response.segments || [])
          .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
          .slice(0, 200),
        timingMethod: 'asr_segments',
      }
    }
  } catch { result = { status: 'unavailable', reason: 'recognition_failed' } }
  db.prepare('UPDATE human_voice_workflows SET speech_check = ? WHERE task_id = ?').run(JSON.stringify(result), taskId)
  return result
}
