import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xtzc-adapter-test-'))
const uploads = path.join(root, 'uploads')
fs.mkdirSync(uploads)
process.env.DB_PATH = path.join(root, 'test.db')
process.env.UPLOAD_DIR = uploads
process.env.PRIVATE_DATA_DIR = path.join(root, 'private')
process.env.EMBEDDING_PROVIDER = 'direct'
process.env.LIPSYNC_PROVIDER = 'direct'
process.env.INDEX_TTS_SYNTHESIS_PROVIDER = 'direct'
let server, media, db, tts, providers, failLip = false, badVector = false, lipUploads = 0, busyHealth = false
const received = []

before(async () => {
  media = await import('../src/services/mediaTools.js')
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x96:d=3:r=25', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(uploads, 'source.mp4')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', path.join(uploads, 'source.mp4'), '-vf', 'tpad=stop_mode=clone:stop_duration=0.5', '-an', '-c:v', 'libx264', path.join(root, 'silent.mp4')])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', path.join(root, 'speech.wav')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', path.join(uploads, 'source.mp4'), '-frames:v', '1', path.join(uploads, 'image.jpg')])
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    if (req.method === 'GET' && req.url === '/healthz') { if (busyHealth) return; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return }
    if (req.method === 'POST' && req.url === '/v1/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); fs.createReadStream(path.join(root, 'speech.wav')).pipe(res); return }
    if (req.method === 'POST' && req.url === '/v1/lipsync') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        lipUploads++
        const form = Buffer.concat(chunks).toString('latin1')
        assert.match(form, /name="video"/)
        assert.match(form, /name="audio"/)
        if (failLip) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"detail":"no face"}'); return }
        res.writeHead(200, { 'Content-Type': 'video/mp4' }); fs.createReadStream(path.join(root, 'silent.mp4')).pipe(res)
      })
      return
    }
    if (req.method === 'POST' && req.url === '/infer') {
      req.resume()
      req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result: { lines: [] } })) })
      return
    }
    if (req.method === 'POST' && req.url === '/v1/embeddings') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const payload = JSON.parse(body); received.push(payload)
        const count = payload.input ? payload.input.length : 1
        const dims = badVector ? 2 : 2048
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({ index, embedding: Array(dims).fill(index + 0.5) })) }))
      })
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  process.env.MODELGATE_BASE = base
  process.env.MODELGATE_API_KEY = 'isolated-adapter-key'
  process.env.EMBEDDING_DIRECT_BASE_URL = base
  process.env.LIPSYNC_DIRECT_BASE_URL = base
  process.env.INDEX_TTS_BASE_URL = base
  db = (await import('../src/db.js')).default
  providers = await import('../src/services/aiProviders.js')
  tts = await import('../src/services/indexTts.js')
})

after(async () => {
  if (db) db.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  const safeRoot = path.resolve(os.tmpdir()) + path.sep
  if (!path.resolve(root).startsWith(safeRoot) || !path.basename(root).startsWith('xtzc-adapter-test-')) throw new Error('Unexpected test directory')
  fs.rmSync(root, { recursive: true, force: true })
})

test('direct multimodal adapter sends real image bytes and validates vector dimensions', async () => {
  const texts = await providers.embedTexts(['白色杯子', '人物'])
  assert.equal(texts.length, 2)
  assert.equal(texts[0].length, 2048)
  const image = await providers.embedImage('/uploads/image.jpg')
  assert.equal(image.length, 2048)
  assert.match(received.at(-1).messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/)
  await assert.rejects(providers.embedImage('/uploads/../../outside.jpg'), /不存在/)
  badVector = true
  try { await assert.rejects(providers.embedTexts(['错误维度']), /维度/) } finally { badVector = false }
  process.env.EMBEDDING_PROVIDER = 'modelgate'
  try { await assert.rejects(providers.embedImage('/uploads/image.jpg'), /尚未开放/) } finally { process.env.EMBEDDING_PROVIDER = 'direct' }
})

test('lip-sync uses clean speech, keeps original audio for mixing and falls back explicitly', async () => {
  const owner = db.prepare("INSERT INTO users (account,password,name) VALUES ('adapter-owner','test','test')").run().lastInsertRowid
  const voice = db.prepare("INSERT INTO voice_profiles (owner_id,name,provider_name,consent_granted_at) VALUES (?,'合成测试音色','test-voice',datetime('now'))").run(owner).lastInsertRowid
  const params = { videoUrl: '/uploads/source.mp4', voiceId: Number(voice), text: '测试', mode: 'mix', speed: 1, lang: 'zh', subtitle: false, lipSync: true }
  const synced = await tts.dubVideo(owner, params)
  assert.equal(synced.lipSync.applied, true)
  assert.equal(lipUploads, 1)
  const info = await media.probeMedia(media.localMediaPath(synced.videos[0].url))
  assert.equal(info.hasAudio, true)
  assert.ok(Math.abs(info.duration - 3) < 0.2)
  failLip = true
  try {
    const fallback = await tts.dubVideo(owner, params)
    assert.equal(fallback.lipSync.applied, false)
    assert.match(fallback.warnings.join(' '), /口型同步未完成/)
    assert.equal((await media.probeMedia(media.localMediaPath(fallback.videos[0].url))).hasAudio, true)
  } finally { failLip = false }
  assert.equal(fs.readdirSync(process.env.PRIVATE_DATA_DIR).length, 0)
})

test('sampled OCR ignores weak one-character shape errors but detects real captions', async () => {
  const { inspectVideoText } = await import('../src/services/videoTextCheck.js')
  const weak = await inspectVideoText('/uploads/source.mp4', { ocr: async () => ({ lines: [{ text: 'V', conf: 0.64 }] }) })
  assert.equal(weak.status, 'clear')
  assert.equal(weak.samples, 3)
  const caption = await inspectVideoText('/uploads/source.mp4', { ocr: async () => ({ lines: [{ text: '欢迎来到小店', conf: 0.99 }] }) })
  assert.equal(caption.status, 'text_detected')
  const oneStrong = await inspectVideoText('/uploads/source.mp4', { ocr: async () => ({ lines: [{ text: '字', conf: 0.96 }] }) })
  assert.equal(oneStrong.status, 'text_detected')
})

test('a busy lip-sync health endpoint is unknown rather than offline', async () => {
  const { lipSyncStatus } = await import('../src/services/lipSync.js')
  busyHealth = true
  try {
    const status = await lipSyncStatus()
    assert.equal(status.available, null)
    assert.equal(status.reason, 'busy_or_unknown')
  } finally { busyHealth = false }
  const original = process.env.LIPSYNC_DIRECT_BASE_URL
  process.env.LIPSYNC_DIRECT_BASE_URL = 'http://127.0.0.1:1'
  try { assert.equal((await lipSyncStatus()).available, false) }
  finally { process.env.LIPSYNC_DIRECT_BASE_URL = original }
})
