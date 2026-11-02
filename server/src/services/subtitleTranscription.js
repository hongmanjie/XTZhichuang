import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mgASRDetails } from './aiProviders.js'
import { FFMPEG, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { splitScript, validateSubtitleSegments } from './subtitleBurn.js'

const configuredPoints = Number(process.env.SUBTITLE_TRANSCRIBE_POINTS || 10)
export const SUBTITLE_TRANSCRIBE_POINTS = Number.isSafeInteger(configuredPoints) && configuredPoints > 0 && configuredPoints <= 10000 ? configuredPoints : 10

export function subtitleDraftFromSpeech(transcript, duration) {
  const text = String(transcript?.text || '').trim()
  if (!text) throw new Error('未识别到语音，请手动填写字幕')
  if (text.length > 600) throw new Error('识别文案超过 600 字，请缩短视频后重试')
  const raw = Array.isArray(transcript?.segments) ? transcript.segments : []
  let previousEnd = 0
  const timed = []
  for (const item of raw) {
    const content = String(item?.text || '').trim()
    const start = Number(item?.start), end = Number(item?.end)
    if (!content || item.start == null || item.end == null || !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end <= start || end > duration + 0.25 || start < previousEnd - 0.02 || start >= duration) {
      timed.length = 0
      break
    }
    const from = Math.max(previousEnd, start)
    const to = Math.min(duration, end)
    if (to - from < 0.05) { timed.length = 0; break }
    timed.push({ text: content, start: from, end: to })
    previousEnd = to
  }
  const sources = timed.length ? timed : [{ text, start: 0, end: duration }]
  let splitWithinSegment = false
  const draft = []
  for (const segment of sources) {
    let parts = splitScript(segment.text, segment.end - segment.start)
    if (parts.some((part) => part.end - part.start < 0.06)) {
      if (segment.text.length > 120) throw new Error('识别时间过短，无法生成可校对字幕')
      parts = [{ text: segment.text, start: 0, end: segment.end - segment.start }]
    }
    if (parts.length > 1) splitWithinSegment = true
    for (const part of parts) {
      if (!part.text.trim()) continue
      draft.push({ text: part.text, start: +(segment.start + part.start).toFixed(2), end: +(segment.start + part.end).toFixed(2) })
    }
  }
  const segments = validateSubtitleSegments(draft, duration)
  const timing = timed.length ? (splitWithinSegment ? 'segment_estimated' : 'segment') : 'estimated'
  return { text, segments, timing }
}

export async function transcribeSubtitles(videoUrl, onStage = () => {}) {
  const input = localMediaPath(videoUrl)
  if (!input || !fs.existsSync(input)) throw new Error('视频文件不存在')
  const video = await probeMedia(input)
  if (!video.hasAudio) throw new Error('该视频没有音轨，请手动填写字幕')
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 180) throw new Error('语音识别暂支持 180 秒以内的视频')
  const wav = path.join(os.tmpdir(), `yimetai-subtitle-asr-${crypto.randomUUID()}.wav`)
  try {
    onStage('正在提取视频语音')
    await runMedia(FFMPEG, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 180000)
    if (fs.statSync(wav).size > 24 * 1024 * 1024) throw new Error('音频超过网关大小限制')
    onStage('正在识别语音')
    const speech = await mgASRDetails(wav, { format: 'wav' })
    const draft = subtitleDraftFromSpeech(speech, video.duration)
    return { title: '语音字幕草稿', engine: 'real', provider: 'modelgate', model: process.env.MODELGATE_ASR_MODEL || 'FunASR-Nano',
      generatedAt: new Date().toISOString(), subtitles: { ...draft, videoUrl, duration: video.duration },
      warnings: ['语音识别可能有误；时间基于模型返回的片段及估算，生成前请逐句校对。'] }
  } finally { try { fs.unlinkSync(wav) } catch {} }
}
