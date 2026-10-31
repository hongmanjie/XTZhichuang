// ============================================================
// 艺术字幕二次叠加服务（数字人口播版块专用，可复用）
// 两段式稳定字幕方案：
//   第一段：视频生成模型以「无文字画面」约束出片（prompt 层约束）
//   第二段：本模块用 ffmpeg/ASS 把口播文案按时间轴烧录为艺术字字幕
// 优点：字幕永远清晰稳定，不受 AI 生成字幕变形/乱码影响
// 依赖：ffmpeg + ffprobe（PATH 中可用），失败时降级返回原视频不阻塞任务
// ============================================================
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { FFMPEG, FFPROBE } from './mediaTools.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 与 fileStore 的 UPLOAD_DIR 保持一致（此处独立定义，避免引入 db.js 依赖，保证烧录服务可独立运行）
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads')

// 本地 URL → 物理路径（/api/files/ 与历史 /uploads/ 均支持；防目录穿越）
function resolveLocalUrl(url) {
  let u = String(url || '').replace(/^https?:\/\/[^/]+/i, '')
  u = u.replace(/^\/api\/files\//i, '/').replace(/^\/uploads\//i, '/')
  try { u = decodeURIComponent(u.split('?')[0]) } catch { /* 保持原值 */ }
  if (!u.startsWith('/')) return null
  const abs = path.resolve(UPLOAD_DIR, '.' + u)
  if (!abs.startsWith(UPLOAD_DIR + path.sep) && abs !== UPLOAD_DIR) return null
  return abs
}

// ---------- 艺术字样式（ASS 颜色为 &HAABBGGRR）----------
export const SUBTITLE_STYLES = {
  vivid: {
    name: '电商爆款',
    desc: '亮黄花字 · 深棕描边 · 淡入动画',
    primary: '&H0000D7FF', // 金黄 FFD700
    outline: '&H0020105A', // 深棕 5A2010
    back: '&HA0000000',    // 半透明黑阴影/底
    outlineW: 3.6,
    shadowW: 1.4,
    fontRatio: 0.052,
  },
  pure: {
    name: '简洁白',
    desc: '纯白大字 · 黑描边 · 通用安全',
    primary: '&H00FFFFFF',
    outline: '&H00000000',
    back: '&H90000000',
    outlineW: 3,
    shadowW: 1,
    fontRatio: 0.048,
  },
  darkOnLight: {
    name: '浅底深字',
    desc: '深色字 · 浅色描边',
    primary: '&H00000000',
    outline: '&H00FFFFFF',
    back: '&H90000000',
    outlineW: 2.4,
    shadowW: 0,
    fontRatio: 0.048,
  },
  violet: {
    name: '品牌紫',
    desc: '白字紫边 · 兴图智创风格',
    primary: '&H00FFFFFF',
    outline: '&H00ED3A7C', // 品牌紫 7C3AED
    back: '&H80000000',
    outlineW: 3.2,
    shadowW: 1.2,
    fontRatio: 0.05,
  },
}

export const SUBTITLE_COVER_MODES = Object.freeze({ none: 0, bottom15: 0.15, bottom20: 0.20, bottom25: 0.25, bottom15White: 0.15, bottom20White: 0.20, bottom25White: 0.25 })
export const DEFAULT_SUBTITLE_STYLE = 'vivid'

const FONT_NAME = process.env.SUBTITLE_FONT_NAME || (process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC')
const FONTS_DIR = process.env.SUBTITLE_FONT_DIR || (process.platform === 'win32' ? 'C:\\Windows\\Fonts' : '/usr/share/fonts')
const SPEED_CHARS = 4.2 // 口播语速：字/秒（仅用于占比参考，实际按字数比例铺满总时长）

function run(bin, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin} ${args[0]} 失败: ${(stderr || err.message).slice(0, 300)}`))
      resolve({ stdout, stderr })
    })
  })
}

// ---------- 口播文案 → 时间轴段落 ----------
export function splitScript(text, totalDur) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600)
  if (!clean) return []
  // 按中英文标点断句
  let clauses = clean.split(/(?<=[，。！？；、…：,.!?;:])/).map((clause) => clause.trim()).filter(Boolean)
  // 短句/助词开头句并入前段
  const merged = []
  for (const c of clauses) {
    const joinPrev = merged.length && (c.length < 3 || /^[的了吗呢吧啊呀哦嘛]/.test(c))
    if (joinPrev) merged[merged.length - 1] += c
    else merged.push(c)
  }
  // 超长句硬切（无标点的连续长文案）
  clauses = []
  for (const c of merged) {
    if (c.length <= 16) { clauses.push(c); continue }
    for (let i = 0; i < c.length; i += 12) clauses.push(c.slice(i, i + 12))
  }
  const totalChars = clauses.reduce((s, c) => s + c.length, 0)
  if (!totalChars) return []
  // 按字数占比铺满总时长
  let cursor = 0
  return clauses.map((c, i) => {
    let dur = (c.length / totalChars) * totalDur
    if (i === clauses.length - 1) dur = Math.max(0, totalDur - cursor)
    const seg = { text: c.replace(/[，、]$/, ''), start: cursor, end: Math.min(totalDur, cursor + dur) }
    cursor += dur
    return seg
  })
}

// ---------- ASS 字幕文件 ----------
function assTime(sec) {
  const ticks = Math.round(sec * 100)
  const h = Math.floor(ticks / 360000)
  const m = Math.floor((ticks % 360000) / 6000)
  const s = (ticks % 6000) / 100
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

export function validateSubtitleSegments(segments, duration) {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 80) throw new Error('请填写 1–80 条字幕')
  let previousEnd = 0
  return segments.map((segment, index) => {
    if (!segment || typeof segment.text !== 'string') throw new Error(`第 ${index + 1} 条字幕无效`)
    const text = segment.text.replace(/[{}\\\r\n]/g, ' ').trim()
    const start = Number(segment.start)
    const end = Number(segment.end)
    if (!text || text.length > 120) throw new Error(`第 ${index + 1} 条字幕须为 1–120 字`)
    if (typeof segment.start !== 'number' || typeof segment.end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.05 || end > duration + 0.01 || start < previousEnd - 0.001) {
      throw new Error(`第 ${index + 1} 条字幕时间无效，请检查先后顺序和视频时长`)
    }
    previousEnd = end
    return { text, start, end: Math.min(end, duration) }
  })
}

export function buildAss(segments, styleKey, playRes) {
  const st = SUBTITLE_STYLES[styleKey] || SUBTITLE_STYLES[DEFAULT_SUBTITLE_STYLE]
  const { width, height } = playRes
  const fontSize = Math.round(height * st.fontRatio)
  const marginLR = Math.round(width * 0.07)
  const marginV = Math.round(height * 0.075)
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Main,${FONT_NAME},${fontSize},${st.primary},&H00FFFFFF,${st.outline},${st.back},-1,0,0,0,100,100,0.6,0,1,${st.outlineW},${st.shadowW},2,${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const events = segments.map((seg) => {
    const txt = seg.text.replace(/[{}\\\r\n]/g, ' ')
    return `Dialogue: 0,${assTime(seg.start)},${assTime(seg.end)},Main,,0,0,0,,{\\fad(160,140)}${txt}`
  })
  return header.join('\n') + '\n' + events.join('\n') + '\n'
}

// ---------- 视频定位/下载 ----------
async function resolveVideo(videoUrl) {
  const raw = String(videoUrl || '')
  // 绝对物理路径直传（内部调用场景）
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(raw)) {
    if (!fs.existsSync(raw)) throw new Error(`本地文件不存在: ${videoUrl}`)
    return { localPath: raw, isTemp: false }
  }
  if (/^https?:\/\//i.test(raw)) {
    // 本机服务的 /api/files/、/uploads/ 按本地文件处理，避免自我下载
    const pathPart = raw.replace(/^https?:\/\/[^/]+/i, '')
    if (/^\/(api\/files|uploads)\//i.test(pathPart)) {
      const rel = resolveLocalUrl(pathPart)
      if (rel && fs.existsSync(rel)) return { localPath: rel, isTemp: false }
      throw new Error(`本地文件不存在: ${videoUrl}`)
    }
    // 外链远程视频：下载到临时文件
    const tmp = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.round(Math.random() * 1e6)}.mp4`)
    const res = await fetch(raw)
    if (!res.ok) throw new Error(`下载视频失败 HTTP ${res.status}`)
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
    return { localPath: tmp, isTemp: true }
  }
  const rel = resolveLocalUrl(raw)
  if (rel && fs.existsSync(rel)) return { localPath: rel, isTemp: false }
  throw new Error(`无法解析的视频地址: ${videoUrl}`)
}

// ffprobe 取视频信息
async function probeVideo(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', file,
  ], 30000)
  const info = JSON.parse(stdout)
  const width = info.streams?.[0]?.width || 720
  const height = info.streams?.[0]?.height || 1280
  const duration = parseFloat(info.format?.duration || '0') || 5
  return { width, height, duration }
}

// 检测是否含音频流
export async function hasAudioStream(file) {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file,
    ], 30000)
    return stdout.trim().length > 0
  } catch { return false }
}

// ass 滤镜路径转义（Windows 盘符冒号）
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// ---------- 配音音频定位 ----------
async function resolveAudio(audioUrl) {
  const raw = String(audioUrl || '')
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(raw)) {
    if (!fs.existsSync(raw)) throw new Error(`本地音频不存在: ${audioUrl}`)
    return raw
  }
  const rel = resolveLocalUrl(raw)
  if (rel && fs.existsSync(rel)) return rel
  throw new Error(`无法解析的音频地址: ${audioUrl}`)
}

async function probeAudioDuration(file) {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], 30000)
    return parseFloat(JSON.parse(stdout).format?.duration || '0') || 0
  } catch { return 0 }
}

// ---------- 主入口：烧录字幕 + TTS 配音混流 ----------
// opts:
//   text      口播文案（字幕内容 + TTS 配音内容）
//   style     字幕风格 vivid/pure/violet
//   voice     voiceId（1-4，传则触发 TTS 配音）
//   audioUrl  已合成的配音文件（优先于 voice，避免重复合成）
// 时长策略：成片时长 = max(视频, 配音)；视频短于配音时末帧冻结补齐（tpad），配音短于视频时静音填充（apad）
export async function burnSubtitles(videoUrl, { text, segments: requestedSegments = null, style = DEFAULT_SUBTITLE_STYLE, voice = null, audioUrl = null, burn = true, subtitleDuration = null, coverMode = 'none' } = {}) {
  if (!Object.hasOwn(SUBTITLE_COVER_MODES, coverMode)) throw new Error('字幕遮挡选项无效')
  const src = await resolveVideo(videoUrl)
  let audioTmp = null // 内部合成的配音临时文件路径
  let assPath = null // ASS 字幕临时文件路径
  let outPath = null
  let covPath = null
  let completed = false
  try {
    const { width, height, duration: videoDur } = await probeVideo(src.localPath)

    // ----- 配音准备 -----
    let audioPath = null
    let audioInfo = null
    if (audioUrl) {
      audioPath = await resolveAudio(audioUrl)
    } else if (voice && text) {
      const { synthesizeVoice } = await import('./tts.js')
      audioInfo = await synthesizeVoice(text, voice)
      // 配音不可用时跳过混音（保留视频原声/无声），字幕照常烧录
      if (audioInfo) {
        audioPath = await resolveAudio(audioInfo.url)
        audioTmp = audioPath
      }
    }

    const audioDur = audioPath ? await probeAudioDuration(audioPath) : 0
    const effectiveDur = Math.max(videoDur, audioDur) || videoDur

    // ----- 字幕时间轴（覆盖全片）-----
    let segments = []
    if (requestedSegments && burn) {
      segments = validateSubtitleSegments(requestedSegments, effectiveDur)
    } else if (text && burn) {
      const duration = Number(subtitleDuration)
      segments = splitScript(text, Number.isFinite(duration) && duration > 0 ? Math.min(duration, effectiveDur) : effectiveDur)
    }
    if (segments.length) {
      for (const seg of segments) {
        if (seg.start >= effectiveDur) seg.end = effectiveDur
        seg.end = Math.min(seg.end, effectiveDur)
      }
      assPath = path.join(os.tmpdir(), `subs_${Date.now()}_${Math.round(Math.random() * 1e6)}.ass`)
      const effectiveStyle = coverMode.endsWith('White') && style === 'pure' ? 'darkOnLight' : style
      fs.writeFileSync(assPath, buildAss(segments, effectiveStyle, { width, height }), 'utf8')
    }

    const stamp = `${Date.now()}_${Math.round(Math.random() * 1e4)}`
    const outName = `sub_${stamp}.mp4`
    const covName = `cov_${stamp}.jpg`
    outPath = path.join(UPLOAD_DIR, outName)
    covPath = path.join(UPLOAD_DIR, covName)

    // ----- ffmpeg 滤镜链 -----
    const assFilter = assPath ? `ass='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'` : null
    const srcHasAudio = await hasAudioStream(src.localPath)
    const args = ['-y', '-i', src.localPath]
    if (audioPath) args.push('-i', audioPath)

    let vchain = []
    const coverHeight = SUBTITLE_COVER_MODES[coverMode]
    if (coverHeight) {
      const color = coverMode.endsWith('White') ? 'white' : 'black'
      vchain.push(`drawbox=x=0:y=ih*(1-${coverHeight}):w=iw:h=ih*${coverHeight}:color=${color}:t=fill`)
    }
    if (assFilter) vchain.push(assFilter)
    // 视频短于配音：末帧冻结补齐
    if (audioPath && audioDur > videoDur + 0.05) {
      vchain.push(`tpad=stop_mode=clone:stop_duration=${(audioDur - videoDur).toFixed(3)}`)
    }

    if (audioPath) {
      // 源自带音轨 → 原声压低做环境音 + 配音主音（ducking 混音）；否则纯配音
      if (srcHasAudio) {
        const fc = []
        if (vchain.length) fc.push(`[0:v]${vchain.join(',')}[vout]`)
        fc.push(`[0:a]volume=0.22[bg]`, `[1:a]apad[vo]`, `[vo][bg]amix=inputs=2:duration=first:dropout_transition=2[mix]`)
        args.push('-filter_complex', fc.join(';'))
        args.push('-map', vchain.length ? '[vout]' : '0:v:0', '-map', '[mix]')
      } else {
        const fc = []
        if (vchain.length) fc.push(`[0:v]${vchain.join(',')}[vout]`)
        fc.push(`[1:a]apad[aud]`)
        args.push('-filter_complex', fc.join(';'))
        args.push('-map', vchain.length ? '[vout]' : '0:v:0')
        args.push('-map', '[aud]')
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
      args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100')
      // apad 无限填充必须用 -shortest 截断到视频流长度
      args.push('-shortest')
    } else {
      const fc = vchain.length ? `[0:v]${vchain.join(',')}[vout]` : null
      if (fc) {
        args.push('-filter_complex', fc, '-map', '[vout]')
        if (srcHasAudio) args.push('-map', '0:a:0')
      }
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
      // 源无音轨时显式 -an，避免静默无声成片
      if (srcHasAudio) args.push('-c:a', 'copy')
      else args.push('-an')
    }
    args.push('-movflags', '+faststart', outPath)
    await run(FFMPEG, args, 300000)

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) throw new Error('烧录输出异常')

    // 封面截帧（1.2s 处，带字幕画面）
    const coverArgs = ['-y', '-ss', String(Math.min(1.2, effectiveDur / 3)), '-i', outPath, '-frames:v', '1', '-q:v', '3', covPath]
    let cover = null
    try {
      await run(FFMPEG, coverArgs, 30000)
      cover = fs.existsSync(covPath) ? `/api/files/${covName}` : null
    } catch { /* 封面失败不影响成片 */ }

    completed = true
    return {
      url: `/api/files/${outName}`,
      cover,
      duration: Math.round(effectiveDur * 10) / 10,
      resolution: `${width}x${height}`,
      subtitleBurned: segments.length > 0,
      subtitleStyle: segments.length ? style : null,
      coverMode,
      segmentCount: segments.length,
      dubbed: !!audioPath,
      audioEngine: audioInfo?.engine || (audioUrl ? 'external' : null),
      voiceName: audioInfo?.voiceName || null,
    }
  } finally {
    // 清理临时文件（下载源/ASS/内部合成配音）
    if (src.isTemp) { try { fs.unlinkSync(src.localPath) } catch {} }
    if (assPath) { try { fs.unlinkSync(assPath) } catch {} }
    if (audioTmp) { try { fs.unlinkSync(audioTmp) } catch {} }
    if (!completed) for (const file of [outPath, covPath]) { if (file) { try { fs.unlinkSync(file) } catch {} } }
  }
}
