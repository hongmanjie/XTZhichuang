/**
 * ModelGate 8 模型接入验证脚本
 * 用法：node test-modelgate.mjs [--skip-video]
 * 逐一实测：chat(非流式/流式) / embed / rerank / OCR / ASR / SAM / 图像生成 / 视频生成(可选)
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  mgEnabled, EMBED_DIMS,
  mgChat, mgChatStream, mgEmbed, mgEmbedQuery, mgRerank,
  mgASR, mgOCR, mgSAM,
  mgImageGen, mgVideoGen,
} from './src/services/aiProviders.js'

const SKIP_VIDEO = process.argv.includes('--skip-video')
const DIR = import.meta.dirname
const results = []

function log(name, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`[${tag}] ${name} ${detail || ''}`)
  results.push({ name, ok })
}

// ---------- 生成 ASR 测试 WAV（16kHz 单声道 3 秒扫频正弦波） ----------
function genWav(file, seconds = 3, rate = 16000) {
  const n = seconds * rate
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    // 220Hz→880Hz 扫频，振幅缓慢包络
    const f = 220 + 660 * (t / seconds)
    const env = Math.min(1, t * 4, (seconds - t) * 4)
    const v = Math.round(Math.sin(2 * Math.PI * f * t) * env * 12000)
    data.writeInt16LE(v, i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34); header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, data]))
  return file
}

async function main() {
  console.log(`ModelGate enabled: ${mgEnabled()}, EMBED_DIMS=${EMBED_DIMS}`)
  if (!mgEnabled()) { console.error('ModelGate 未启用，检查 .env'); process.exit(1) }

  // 1) chat 非流式（mgChat 返回纯字符串 content）
  try {
    const text = await mgChat([{ role: 'user', content: '用一句话介绍易迈台平台' }])
    log('chat(非流式)', typeof text === 'string' && text.length > 0, `→ ${String(text).slice(0, 60).replace(/\n/g, ' ')}`)
  } catch (e) { log('chat(非流式)', false, e.message) }

  // 2) chat 流式（yield { delta } / { reasoning }）
  try {
    let out = '', first = 0, t0 = Date.now()
    for await (const chunk of mgChatStream([{ role: 'user', content: '数到3，用顿号分隔' }])) {
      if (!first) first = Date.now() - t0
      out += chunk?.delta || ''
    }
    log('chat(流式)', out.length > 0, `首包 ${first}ms, 共 ${out.length} 字 → ${out.slice(0, 40).replace(/\n/g, ' ')}`)
  } catch (e) { log('chat(流式)', false, e.message) }

  // 3) embed
  try {
    const vecs = await mgEmbed(['易迈台AI创作平台', '短视频脚本生成'])
    const dim = vecs?.[0]?.length || 0
    log('embed', dim === EMBED_DIMS, `维度=${dim} (期望${EMBED_DIMS})`)
  } catch (e) { log('embed', false, e.message) }

  // 4) embed query + rerank
  try {
    const qv = await mgEmbedQuery('AI生成视频')
    const docs = ['用AI一键生成带货短视频', '今天天气不错适合出门', '智能剪辑工具推荐']
    const ranked = await mgRerank('AI视频生成工具', docs, 3)
    log('rerank', Array.isArray(ranked) && ranked.length > 0,
      `query维度=${qv.length}, top1=${JSON.stringify(ranked[0]).slice(0, 60)}`)
  } catch (e) { log('rerank', false, e.message) }

  // 5) OCR
  try {
    const img = path.join(DIR, 'mg_test_ocr.png')
    const r = await mgOCR(img)
    const text = r?.text || ''
    log('OCR', /YIMETAI|ModelGate|OCR/i.test(text), `识别 ${text.length} 字 → ${text.slice(0, 50).replace(/\n/g, ' | ')}`)
  } catch (e) { log('OCR', false, e.message) }

  // 6) ASR（Node 生成 wav）
  try {
    const wav = genWav(path.join(DIR, 'mg_test_asr.wav'))
    const r = await mgASR(wav, { format: 'wav' })
    log('ASR', r !== undefined && r !== null, `返回=${JSON.stringify(r).slice(0, 80)}（正弦波无语音，链路通即可）`)
  } catch (e) { log('ASR', false, e.message) }

  // 7) SAM 分割
  try {
    const img = path.join(DIR, 'mg_test_ocr.png')
    const r = await mgSAM(img, { text: 'text' })
    const masks = r?.masks || r
    log('SAM', !!masks, `返回=${JSON.stringify(r).slice(0, 80)}`)
  } catch (e) { log('SAM', false, e.message) }

  // 8) 图像生成（异步任务 202 + 轮询），返回 { provider, model, task_id, images: [local] }
  try {
    const t0 = Date.now()
    const r = await mgImageGen({ prompt: '一只可爱的橘猫坐在窗台上看夕阳，电影感光影', size: [1024, 1024] })
    const saved = r?.images?.[0] || ''
    const exists = saved && fs.existsSync(path.join(DIR, saved.replace(/^\//, '').replace(/\//g, path.sep)))
    log('图像生成', !!exists, `${Math.round((Date.now() - t0) / 1000)}s → ${saved}`)
  } catch (e) { log('图像生成', false, e.message) }

  // 9) 视频生成（异步任务，5-25 分钟，可 --skip-video 跳过），返回 { videos: [{ url }] }
  if (SKIP_VIDEO) {
    log('视频生成', true, '（--skip-video 跳过）')
  } else {
    try {
      const t0 = Date.now()
      const r = await mgVideoGen({ prompt: '窗外雨滴落下，玻璃上的水珠缓慢滑落，安静氛围', task: 't2av' })
      const saved = r?.videos?.[0]?.url || ''
      const exists = saved && fs.existsSync(path.join(DIR, saved.replace(/^\//, '').replace(/\//g, path.sep)))
      log('视频生成', !!exists, `${Math.round((Date.now() - t0) / 1000)}s → ${saved}`)
    } catch (e) { log('视频生成', false, e.message) }
  }

  const pass = results.filter(r => r.ok).length
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`)
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
