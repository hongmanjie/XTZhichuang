// ============================================================
// TTS 语音合成服务（数字人口播配音，修复成片无声问题）
// 主路径：msedge-tts 神经音色（需可访问 wss://speech.platform.bing.com）
// 兜底：Windows SAPI（System.Speech，本机离线稳定可用，中文 Huihui 音色）
// 输出：音频文件落盘 uploads/，返回 /api/files/ URL + 时长 + 引擎信息
// ============================================================
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { FFPROBE } from './mediaTools.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads')

// 音色映射：voiceId → edge 神经音色 + SAPI 兜底语速（SAPI 本机仅 Huihui 中文女声）
export const TTS_VOICES = {
  1: { id: 1, name: '标准女声', edge: 'zh-CN-XiaoxiaoNeural', sapiRate: 0, sapiPitch: 0 },
  2: { id: 2, name: '浑厚男声', edge: 'zh-CN-YunyangNeural', sapiRate: -1, sapiPitch: -20 },
  3: { id: 3, name: '甜美女声', edge: 'zh-CN-XiaoyiNeural', sapiRate: 1, sapiPitch: 10 },
  4: { id: 4, name: '激情男声', edge: 'zh-CN-YunxiNeural', sapiRate: 2, sapiPitch: -10 },
}
export const DEFAULT_TTS_VOICE = 1

function run(bin, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin} 失败: ${(stderr || err.message).slice(0, 300)}`))
      resolve({ stdout, stderr })
    })
  })
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600)
}

// ---------- 主路径：msedge-tts（带重试，wss 连接间歇性被重置，重试成功率高） ----------
async function edgeTts(text, voice, retries = 3) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts')
      const tts = new MsEdgeTTS()
      await tts.setMetadata(voice.edge, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      const { audioStream } = await tts.toStream(text)
      const chunks = []
      for await (const c of audioStream) chunks.push(c)
      const buf = Buffer.concat(chunks)
      if (buf.length < 1024) throw new Error('edge-tts 音频流为空')

      const name = `tts_${Date.now()}_${Math.round(Math.random() * 1e4)}.mp3`
      const outPath = path.join(UPLOAD_DIR, name)
      fs.writeFileSync(outPath, buf)
      return { file: outPath, url: `/api/files/${name}`, ext: 'mp3' }
    } catch (e) {
      lastErr = e
      if (attempt < retries) {
        console.warn(`[TTS] edge-tts 第${attempt + 1}次失败（${String(e.message).slice(0, 80)}），1.5s后重试`)
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
  }
  throw lastErr
}

// ---------- 兜底已移除：SAPI 机械音质感过低，宁缺毋滥（edge-tts 失败则跳过配音） ----------

// ffprobe 音频时长
async function probeDuration(file) {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file,
    ], 30000)
    return Math.round((parseFloat(JSON.parse(stdout).format?.duration || '0') || 0) * 10) / 10
  } catch { return 0 }
}

// ---------- 主入口：合成配音 ----------
// 返回 null = 配音不可用（调用方跳过混音，成片保留原声/无声，但字幕照常烧录）
export async function synthesizeVoice(text, voiceId = DEFAULT_TTS_VOICE) {
  const clean = cleanText(text)
  if (!clean) return null
  const voice = TTS_VOICES[voiceId] || TTS_VOICES[DEFAULT_TTS_VOICE]

  let res
  try {
    res = await edgeTts(clean, voice)
  } catch (e) {
    console.warn(`[TTS] edge-tts 重试后仍不可用（${String(e.message).slice(0, 120)}），本片不配音`)
    return null
  }

  const duration = await probeDuration(res.file)
  return {
    url: res.url,
    engine: 'edge-tts',
    voice: voice.edge,
    voiceName: voice.name,
    duration,
    sizeBytes: fs.statSync(res.file).size,
  }
}
