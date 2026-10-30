import fs from 'fs'
import os from 'os'
import path from 'path'
import { FFMPEG, localMediaPath, probeMedia, runMedia } from './mediaTools.js'
import { chat, mgASRDetails, mgOCR } from './aiProviders.js'

// Detect abrupt visual changes only; a detected cut does not explain scene content.
export async function detectSceneChanges(input, duration) {
  const { stderr } = await runMedia(FFMPEG, ['-hide_banner', '-nostats', '-loglevel', 'info', '-i', input, '-an',
    '-vf', 'scale=320:-2,select=gt(scene\\,0.32),showinfo', '-f', 'null', '-'], 180000)
  const times = []
  let truncated = false
  for (const match of stderr.matchAll(/\bpts_time:([\d.]+)/g)) {
    const time = Number(match[1])
    if (!Number.isFinite(time) || time < 0.2 || time > duration - 0.2 || (times.length && time - times[times.length - 1] < 0.5)) continue
    if (times.length >= 50) { truncated = true; break }
    times.push(Math.round(time * 100) / 100)
  }
  return { times, truncated, method: 'ffmpeg-scene-change' }
}

export async function analyzeVideo(params, onStage = () => {}) {
  const input = localMediaPath(params.videoUrl)
  if (!input || !fs.existsSync(input)) throw new Error('视频文件不存在')
  const video = await probeMedia(input)
  if (video.duration > 120) throw new Error('当前解析支持不超过 120 秒的视频')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yimetai-analysis-'))
  const files = []
  const warnings = []
  let transcript = { text: '', segments: [] }
  let speechChecked = false
  const frames = []
  let successfulOcr = 0
  let sceneChanges = null
  try {
    if (video.hasAudio) {
      onStage('正在提取并识别语音')
      const wav = path.join(dir, 'audio.wav')
      files.push(wav)
      try {
        await runMedia(FFMPEG, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 180000)
        if (fs.statSync(wav).size > 24 * 1024 * 1024) throw new Error('音频超过网关大小限制')
        transcript = await mgASRDetails(wav, { format: 'wav' })
        speechChecked = true
      } catch (error) { warnings.push(`语音识别未完成：${error.message}`) }
    }
    const count = Math.min(5, Math.max(3, Math.ceil(video.duration / 6)))
    for (let i = 0; i < count; i++) {
      onStage(`正在识别第 ${i + 1}/${count} 张抽帧文字`)
      const time = Math.max(0, Math.min(video.duration - 0.1, (i + 0.5) * video.duration / count))
      const frame = path.join(dir, `frame-${i}.jpg`)
      files.push(frame)
      try {
        await runMedia(FFMPEG, ['-y', '-ss', String(time), '-i', input, '-frames:v', '1', '-q:v', '3', frame], 60000)
        const result = await mgOCR(frame)
        frames.push({ time: Math.round(time * 10) / 10, text: result.text || '' })
        successfulOcr++
      } catch (error) {
        warnings.push(`第 ${i + 1} 张抽帧识别未完成：${error.message}`)
      }
    }
    if (!speechChecked && !successfulOcr) throw new Error(video.hasAudio ? '语音识别和画面文字识别均未完成' : '视频无音轨且画面文字识别未完成')
    onStage('正在检测疑似画面切换')
    try { sceneChanges = await detectSceneChanges(input, video.duration) }
    catch (error) { warnings.push(`画面切换检测未完成：${error.message}`) }
    let summary = ''
    const recognized = [transcript.text ? `语音转写：${transcript.text}` : '', ...frames.filter((frame) => frame.text).map((frame) => `${frame.time}秒画面文字：${frame.text}`)].filter(Boolean).join('\n')
    if (recognized) {
      onStage('正在整理识别结果')
      try {
        summary = await chat([
          { role: 'system', content: '你是文字整理助手，只能看到语音转写和 OCR 文本，看不到视频画面。只概括这些文字明确表达的内容，再提出针对文案本身的改写建议。不能推断或描述画面布局、颜色、人物、动作、场景、产品功效、品牌、数据、镜头、配音与画面同步关系。不要猜测 OCR 的正确拼写；不确定时明确说不知道。' },
          { role: 'user', content: recognized.slice(0, 5000) },
        ], { temperature: 0.3, max_tokens: 600 })
      } catch (error) { warnings.push(`AI 整理未完成：${error.message}`) }
    }
    return {
      title: '视频文字与语音解析', engine: 'real', provider: 'modelgate', model: 'FunASR-Nano / PPOCR-v5-Server', generatedAt: new Date().toISOString(), warnings,
      analysis: { videoUrl: params.videoUrl, duration: video.duration, transcript: transcript.text, transcriptSegments: transcript.segments, frames, sceneChanges, summary,
        limitation: '只识别语音、抽帧文字和疑似画面切换，暂未理解人物、动作、画面语义或镜头结构；识别内容可能有误。' },
    }
  } finally {
    for (const file of files) { try { fs.unlinkSync(file) } catch {} }
    try { fs.rmdirSync(dir) } catch {}
  }
}
