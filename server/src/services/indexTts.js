import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeAudio, probeMedia, runMedia } from './mediaTools.js'
import { burnSubtitles } from './subtitleBurn.js'
import { mgSpeech, modelGateStatus } from './aiProviders.js'
import { applyLipSync, lipSyncStatus } from './lipSync.js'
import { inspectVideoText, textCheckWarning } from './videoTextCheck.js'
import { presetByVoiceId } from './voicePresets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PRIVATE_DIR = process.env.PRIVATE_DATA_DIR ? path.resolve(process.env.PRIVATE_DATA_DIR) : path.resolve(__dirname, '../../data/private')

function ttsUrl(resource) {
  const base = process.env.INDEX_TTS_BASE_URL
  if (!base) throw new Error('IndexTTS 服务地址尚未配置')
  const parsed = new URL(base)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('IndexTTS 服务地址无效')
  return `${base.replace(/\/$/, '')}${resource}`
}

// Health checks do not submit synthesis jobs. A gateway that does not expose this
// endpoint is marked unknown so it can still be used after an explicit attempt.
async function voiceManagementStatus() {
  if (!process.env.INDEX_TTS_BASE_URL) return { available: false, reason: 'not_configured' }
  try {
    const response = await fetch(ttsUrl('/health'), { redirect: 'error', signal: AbortSignal.timeout(2500) })
    if (response.ok) return { available: true, reason: 'reachable' }
    if ([401, 403, 404, 405].includes(response.status)) return { available: null, reason: 'health_unknown' }
    return { available: false, reason: 'unavailable' }
  } catch { return { available: false, reason: 'unreachable' } }
}

export function ttsTextLimit() { return process.env.INDEX_TTS_SYNTHESIS_PROVIDER === 'modelgate' ? 400 : 600 }

export async function indexTtsStatus() {
  const provider = process.env.INDEX_TTS_SYNTHESIS_PROVIDER || 'direct'
  const [management, gateway, lipsync] = await Promise.all([voiceManagementStatus(), provider === 'modelgate' ? modelGateStatus() : Promise.resolve(null), lipSyncStatus()])
  const synthesis = provider === 'direct' ? management : provider === 'modelgate' ? gateway : { available: false, reason: 'invalid_provider' }
  return { ...synthesis, managementAvailable: management.available, managementReason: management.reason,
    synthesisProvider: provider, maxTextLength: ttsTextLimit(), lipSyncAvailable: lipsync.available,
    lipSyncReason: lipsync.reason, lipSyncProvider: lipsync.provider }
}

async function requireTtsReachable() {
  const status = await indexTtsStatus()
  if (status.available === false) throw new Error(status.reason === 'not_configured' ? '配音服务尚未配置' : '配音服务暂时不可连接，请检查网络或稍后重试')
}

async function requireVoiceManagementReachable() {
  const status = await voiceManagementStatus()
  if (status.available === false) throw new Error(status.reason === 'not_configured' ? '音色管理服务尚未配置' : '音色管理服务暂时不可连接，请检查网络或稍后重试')
}

async function ttsFetch(resource, options = {}, timeout = 300000) {
  try {
    const response = await fetch(ttsUrl(resource), { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) })
    if (!response.ok) {
      let message = `IndexTTS 服务返回 HTTP ${response.status}`
      try { const data = await response.json(); message = data?.error?.message || message } catch {}
      const error = new Error(String(message).slice(0, 250))
      error.status = response.status
      throw error
    }
    return response
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('IndexTTS 请求超时，请稍后重试')
    throw error
  }
}

async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('音频结果过大')
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) throw new Error('音频结果过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function uploadVoice(ownerId, name, audio, filename) {
  if (!audio?.length || audio.length > 10 * 1024 * 1024) throw new Error('参考音频大小须在 10 MB 以内')
  await requireVoiceManagementReachable()
  const temp = path.join(os.tmpdir(), `yimetai-voice-${crypto.randomUUID()}.audio`)
  const wav = `${temp}.wav`
  try {
    fs.writeFileSync(temp, audio, { mode: 0o600 })
    const { duration } = await probeAudio(temp)
    if (duration < 1 || duration > 30) throw new Error('参考音频时长须为 1–30 秒，推荐 3–10 秒')
    await runMedia(FFMPEG, ['-y', '-i', temp, '-vn', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', wav], 60000)
    const providerName = `ym_${ownerId}_${crypto.randomUUID().replace(/-/g, '')}`
    const form = new FormData()
    form.append('audio_sample', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'reference.wav')
    form.append('name', providerName)
    form.append('consent', `yimetai-${ownerId}-${crypto.randomUUID()}`)
    const response = await ttsFetch('/v1/audio/voices', { method: 'POST', body: form }, 120000)
    const payload = await response.json()
    if (!payload.success || payload.voice?.name !== providerName) throw new Error('音色服务未确认上传结果')
    try {
      const id = db.prepare("INSERT INTO voice_profiles (owner_id, name, provider_name, consent_granted_at) VALUES (?, ?, ?, datetime('now','localtime'))")
        .run(ownerId, String(name).trim().slice(0, 50), providerName).lastInsertRowid
      return { id, name: String(name).trim().slice(0, 50) }
    } catch (error) {
      try { await ttsFetch(`/v1/audio/voices/${encodeURIComponent(providerName)}`, { method: 'DELETE' }, 30000) } catch {}
      throw error
    }
  } finally { try { fs.unlinkSync(temp) } catch {}; try { fs.unlinkSync(wav) } catch {} }
}

export async function deleteVoice(ownerId, id) {
  if (presetByVoiceId(id)) throw new Error('内置音色不能删除')
  const voice = db.prepare('SELECT * FROM voice_profiles WHERE id = ? AND owner_id = ?').get(id, ownerId)
  if (!voice) throw new Error('音色不存在')
  try { await ttsFetch(`/v1/audio/voices/${encodeURIComponent(voice.provider_name)}`, { method: 'DELETE' }, 30000) }
  catch (error) { if (error.status !== 404) throw error }
  db.prepare('DELETE FROM voice_profiles WHERE id = ? AND owner_id = ?').run(id, ownerId)
}

function resolveVoice(ownerId, voiceId) {
  const preset = presetByVoiceId(voiceId)
  if (preset) return { provider_name: preset.providerName, system: true }
  const stored = db.prepare('SELECT * FROM voice_profiles WHERE id = ? AND owner_id = ?').get(voiceId, ownerId)
  return stored || null
}

// TTS 服务会在首尾各留 0.5–1.5 秒静音，短文案时几乎听不到人声。
// 只裁掉边缘静音并保留一点气口，句中停顿保持原样。
async function trimEdgeSilence(filePath) {
  const trimmed = `${filePath}.trim.wav`
  try {
    await runMedia(FFMPEG, ['-y', '-i', filePath, '-af',
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse',
      '-ac', '1', '-c:a', 'pcm_s16le', trimmed], 120000)
    if (!fs.existsSync(trimmed) || fs.statSync(trimmed).size < 2048) throw new Error('裁剪结果为空')
    return trimmed
  } catch {
    try { fs.unlinkSync(trimmed) } catch {}
    return null
  }
}

// A complete speech file is created before video planning. Callers own the
// returned private path and must either persist it safely or delete it.
export async function synthesizeSpeech(ownerId, params, context = {}) {
  const synthesisProvider = process.env.INDEX_TTS_SYNTHESIS_PROVIDER || 'direct'
  const voice = resolveVoice(ownerId, params.voiceId)
  if (!voice) throw new Error('音色不存在或无权使用')
  if (typeof params.text !== 'string' || !params.text.trim() || params.text.length > ttsTextLimit()) throw new Error('配音文案长度无效')
  await requireTtsReachable()
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const audioPath = path.join(PRIVATE_DIR, `speech_${crypto.randomUUID()}.wav`)
  try {
    let data
    let response
    try {
      context.onStage?.('正在合成配音')
      response = synthesisProvider === 'modelgate'
        ? await mgSpeech({ input: params.text, voice: voice.provider_name, speed: params.speed, lang: params.lang || 'zh' })
        : await ttsFetch('/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'IndexTTS-2.5', input: params.text, voice: voice.provider_name, response_format: 'wav', speed: params.speed, extra_params: { lang: params.lang || 'zh' } }) })
      data = await readLimited(response, 50 * 1024 * 1024)
    } catch (cause) {
      if (cause.code === 'MG_CONNECTION_UNAVAILABLE' || cause.code === 'TTS_UNCERTAIN' || (cause.status && cause.status < 500 && ![408, 409].includes(cause.status))) throw cause
      const error = new Error('配音服务响应中断，重新发起可能再次占用模型资源')
      error.code = 'TTS_UNCERTAIN'; error.cause = cause; throw error
    }
    if (!data.length || !(response.headers.get('content-type') || '').startsWith('audio/')) throw new Error('IndexTTS 未返回有效音频')
    fs.writeFileSync(audioPath, data, { mode: 0o600, flag: 'wx' })
    const original = await probeAudio(audioPath)
    let audio = original
    const trimmed = await trimEdgeSilence(audioPath)
    if (trimmed) {
      const probe = await probeAudio(trimmed)
      if (probe.duration > 0.3 && probe.duration <= original.duration) {
        fs.renameSync(trimmed, audioPath)
        audio = probe
      } else { try { fs.unlinkSync(trimmed) } catch {} }
    }
    return { path: audioPath, duration: audio.duration, synthesisProvider,
      trimmedSeconds: Number(Math.max(0, original.duration - audio.duration).toFixed(3)) }
  } catch (error) {
    try { fs.unlinkSync(audioPath) } catch {}
    throw error
  }
}

export async function dubVideo(ownerId, params, context = {}) {
  const synthesisProvider = process.env.INDEX_TTS_SYNTHESIS_PROVIDER || 'direct'
  const videoPath = localMediaPath(params.videoUrl)
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('视频文件不存在')
  const video = await probeMedia(videoPath)
  let audioPath = null
  const outName = `dubbing_${crypto.randomUUID()}.mp4`
  const output = path.join(MEDIA_UPLOAD_DIR, outName)
  let synced = null
  let lipSync = { requested: params.lipSync === true, applied: false }
  const warnings = []
  try {
    const audio = await synthesizeSpeech(ownerId, params, context)
    audioPath = audio.path
    if (audio.duration > video.duration + 0.15) throw new Error(`配音约 ${audio.duration.toFixed(1)} 秒，超过视频 ${video.duration.toFixed(1)} 秒；请缩短文案或加快语速`)
    let visualPath = videoPath
    if (params.lipSync === true) {
      context.onStage?.('正在同步口型')
      try {
        synced = await applyLipSync(videoPath, audioPath)
        visualPath = synced.path
        lipSync = { requested: true, applied: true, provider: 'LatentSync' }
      } catch (error) {
        lipSync = { requested: true, applied: false, provider: 'LatentSync' }
        warnings.push('口型同步未完成，已保留普通配音视频：' + error.message)
      }
    }
    // The third input is always the untouched source so the mix mode retains its original audio.
    const filters = params.mode === 'mix' && video.hasAudio
      ? `[2:a]volume=0.2,apad,atrim=duration=${video.duration}[original];[1:a]apad,atrim=duration=${video.duration}[speech];[original][speech]amix=inputs=2:duration=first:dropout_transition=0[a]`
      : `[1:a]apad,atrim=duration=${video.duration}[a]`
    await runMedia(FFMPEG, ['-y', '-i', visualPath, '-i', audioPath, '-i', videoPath, '-filter_complex', filters, '-map', '0:v:0', '-map', '[a]', '-t', String(video.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', output], 900000)
    const result = await probeMedia(output)
    if (!result.hasAudio || Math.abs(result.duration - video.duration) > 0.2) throw new Error('配音成片校验失败')
    let finalUrl = `/uploads/${outName}`
    let cover = ''
    let subtitle = null
    const textCheck = context.frameTextCheck || await inspectVideoText(params.videoUrl, { onStage: context.onStage })
    const checkWarning = textCheckWarning(textCheck, !!params.subtitle)
    if (checkWarning && !context.textCheckWarningHandled) warnings.push(checkWarning)
    if (params.subtitle && textCheck.status === 'clear') {
      context.onStage?.('正在添加字幕')
      const subtitled = await burnSubtitles(finalUrl, { text: params.text, style: 'pure', subtitleDuration: audio.duration })
      if (!subtitled.subtitleBurned) throw new Error('字幕叠加失败')
      finalUrl = subtitled.url
      cover = subtitled.cover || ''
      subtitle = { burned: true, timing: 'estimated', originalTextRemoved: false }
      try { fs.unlinkSync(output) } catch {}
    } else if (params.subtitle) {
      subtitle = { burned: false, reason: textCheck.status, originalTextRemoved: false }
    }
    return { title: '配音视频', desc: params.text.slice(0, 80), engine: 'real', provider: 'indextts', synthesisProvider, model: 'IndexTTS-2.5', generatedAt: new Date().toISOString(),
      subtitle, lipSync, qualityCheck: textCheck, warnings, videos: [{ name: '配音成片', url: finalUrl, cover, ...result, resolution: `${result.width}x${result.height}` }], images: [] }
  } catch (error) {
    try { fs.unlinkSync(output) } catch {}
    throw error
  } finally { try { fs.unlinkSync(audioPath) } catch {}; try { synced?.cleanup() } catch {} }
}
