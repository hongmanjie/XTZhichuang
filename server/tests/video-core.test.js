import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import net from 'node:net'
import Database from 'better-sqlite3'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yimetai-core-test-'))
const uploads = path.join(temp, 'uploads')
fs.mkdirSync(uploads)
process.env.DB_PATH = path.join(temp, 'test.db')
process.env.UPLOAD_DIR = uploads
process.env.PRIVATE_DATA_DIR = path.join(temp, 'private')
process.env.MODELGATE_API_KEY = 'isolated-test-key'
process.env.MODELGATE_ENABLED = 'true'
process.env.MODELGATE_POLL_INITIAL_MS = '0'
process.env.MODELGATE_ASR_MODEL = 'FunASR-Nano'
process.env.MODELGATE_OCR_MODEL = 'PPOCR-v5-Server'
process.env.AI_REAL_ENABLED = 'true'
process.env.INDEX_TTS_SYNTHESIS_PROVIDER = 'direct'

let media, providers, spec, db, tasks, server, tts
const submissions = []
const chatRequests = []
const gatewaySpeechRequests = []
const failureJobs = new Set()
const imageJobs = new Set()
const restorationJobs = new Set()
const heldJobs = new Set()
const cancelledJobs = new Set()
let failSubmissionAt = 0
let failNextChat = false
let holdNextChat = false
let heldChatClosed = false
let holdNextVideo = false
let failOCR = false
let ocrText = ''
let failSpeech = false
let asrErrorStatus = 0
let asrCalls = 0
let ttsHealthCode = 200
let failGatewayConnection = false
let invalidRestorationResult = false
const fixture = path.join(uploads, 'fixture.mp4')

before(async () => {
  media = await import('../src/services/mediaTools.js')
  spec = await import('../src/services/h3Spec.js')
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=red:s=160x96:d=8:r=24', '-f', 'lavfi', '-i', 'color=blue:s=160x96:d=1:r=24', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=blue:s=160x96:d=3:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(uploads, 'blue.mp4')])
  await media.runMedia(media.FFMPEG, ['-y', '-ss', '1', '-i', fixture, '-frames:v', '1', path.join(uploads, 'input.jpg')])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=240x320:d=1,format=rgba,drawbox=x=70:y=60:w=100:h=200:color=red@1.0:t=fill:replace=1', '-frames:v', '1', path.join(uploads, 'fixture-transparent.png')])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'pcm_s16le', path.join(temp, 'sample.wav')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', fixture, '-i', path.join(temp, 'sample.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-af', 'apad', '-t', '9', path.join(uploads, 'with-audio.mp4')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', fixture, '-i', path.join(temp, 'sample.wav'), '-t', '1', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', path.join(uploads, 'short-audio.mp4')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', path.join(uploads, 'short-audio.mp4'), '-vf', 'scale=320:192', '-an', '-c:v', 'libx264', path.join(uploads, 'enhanced.mp4')])
  server = http.createServer((req, res) => {
    if (req.method === 'HEAD' && req.url === '/xt-platform/models/v1' && failGatewayConnection) {
      req.socket.destroy()
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(ttsHealthCode, { 'Content-Type': 'application/json' })
      res.end('{}')
    } else if (req.method === 'POST' && req.url === '/xt-platform/models/v1/infer') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const payload = JSON.parse(body)
        if (payload.model === 'FunASR-Nano') {
          asrCalls++
          if (asrErrorStatus) { res.writeHead(asrErrorStatus, { 'Content-Type': 'application/json' }); res.end('{}'); return }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result: { prediction: { results: [{ text: '识别出的语音', start_time: 0, end_time: 3 }] } } }))
          return
        }
        if (payload.model === 'PPOCR-v5-Server') {
          if (failOCR) { res.writeHead(503); res.end('{}'); return }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result: { lines: ocrText ? [{ text: ocrText }] : [] } }))
          return
        }
        if (payload.model === 'IndexTTS-2.5') {
          gatewaySpeechRequests.push(payload)
          res.writeHead(200, { 'Content-Type': 'audio/wav' })
          fs.createReadStream(path.join(temp, 'sample.wav')).pipe(res)
          return
        }
        if (payload.model !== 'MiniMax-H3' && payload.model !== 'SeedVR2-3B' && payload.task !== 't2i') {
          chatRequests.push(payload)
          if (failNextChat) { failNextChat = false; res.writeHead(503); res.end('{}'); return }
          if (payload.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '真实模型回答' } }] })}\n\n`)
            if (holdNextChat) {
              holdNextChat = false
              res.on('close', () => { heldChatClosed = true })
              return
            }
            res.end('data: [DONE]\n\n')
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          const isScript = payload.messages?.[0]?.content?.includes('短视频分镜脚本专家')
          const plannedCount = Number(payload.messages?.[1]?.content?.match(/共 (\d+) 段/)?.[1] || 2)
          const content = isScript ? [{ scene_desc: '产品展示', line: '产品介绍', duration: 5 }] : {
            visual_style: '暖色自然光', music: '柔和背景音乐',
            shots: Array.from({ length: plannedCount }, (_, i) => ({ visual: `产品镜头 ${i + 1}`, start: '产品居中', action: '缓慢推进', camera: '轻微移动', end: '产品特写', soundscape: '安静室内' })),
          }
          res.end(JSON.stringify({ result: { choices: [{ message: { content: JSON.stringify(content) } }] } }))
          return
        }
        submissions.push({ body: payload, key: req.headers['idempotency-key'] })
        if (payload.task === 't2i') imageJobs.add(`job-${submissions.length}`)
        if (payload.model === 'SeedVR2-3B') restorationJobs.add(`job-${submissions.length}`)
        if (payload.model === 'MiniMax-H3' && holdNextVideo) { heldJobs.add(`job-${submissions.length}`); holdNextVideo = false }
        if (submissions.length === failSubmissionAt) failureJobs.add(`job-${submissions.length}`)
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ result: { task_id: `job-${submissions.length}` } }))
      })
    } else if (req.method === 'POST' && req.url === '/v1/audio/voices') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1')
        const name = body.match(/name="name"\r\n\r\n([^\r]+)/)?.[1]
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, voice: { name } }))
      })
    } else if (req.method === 'POST' && req.url === '/v1/audio/speech') {
      if (failSpeech) { res.writeHead(503); res.end('{}'); return }
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      fs.createReadStream(path.join(temp, 'sample.wav')).pipe(res)
    } else if (req.method === 'DELETE' && req.url?.startsWith('/v1/audio/voices/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}')
    } else if (req.method === 'DELETE' && req.url?.startsWith('/xt-platform/models/v1/tasks/')) {
      const jobId = req.url.split('/').at(-1)
      heldJobs.delete(jobId)
      cancelledJobs.add(jobId)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ result: { status: 'canceling', cancelRequested: true } }))
    } else if (req.url?.startsWith('/xt-platform/models/v1/tasks/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const jobId = req.url.split('/').at(-1)
      res.end(JSON.stringify({ result: failureJobs.has(jobId) ? { status: 'failed', message: 'test failure' } : cancelledJobs.has(jobId) ? { status: 'cancelled' } : heldJobs.has(jobId) ? { status: 'running' } : { status: 'succeeded', resultUrl: imageJobs.has(jobId) ? '/input.jpg' : restorationJobs.has(jobId) && !invalidRestorationResult ? '/enhanced.mp4' : '/fixture.mp4' } }))
    } else if (req.url === '/input.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      fs.createReadStream(path.join(uploads, 'input.jpg')).pipe(res)
    } else if (req.url === '/fixture.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      fs.createReadStream(fixture).pipe(res)
    } else if (req.url === '/enhanced.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      fs.createReadStream(path.join(uploads, 'enhanced.mp4')).pipe(res)
    } else { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.MODELGATE_BASE = `http://127.0.0.1:${server.address().port}/xt-platform/models/v1`
  process.env.INDEX_TTS_BASE_URL = `http://127.0.0.1:${server.address().port}`
  providers = await import('../src/services/aiProviders.js')
  db = (await import('../src/db.js')).default
  tasks = await import('../src/services/aiEngine.js')
  tts = await import('../src/services/indexTts.js')
})

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (db) db.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  const safeRoot = path.resolve(os.tmpdir()) + path.sep
  if (!path.resolve(temp).startsWith(safeRoot) || !path.basename(temp).startsWith('yimetai-core-test-')) throw new Error('Refusing to clean an unexpected path')
  fs.rmSync(temp, { recursive: true, force: true })
})

test('long video plans and joins real segments, and retry preserves finished segments', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('long','test','test',100)").run().lastInsertRowid
  const startCount = submissions.length
  failSubmissionAt = startCount + 2
  const task = tasks.createTask(user, 'materialField', {
    prompt: '一个产品的连续展示', duration: 15, ratio: '9:16', resolution: '540P',
    refs: [{ type: 'image', role: 'first', url: '/uploads/input.jpg' }, { type: 'image', role: 'last', url: '/uploads/input.jpg' }],
  }, 48)
  const waitFor = async (status) => {
    for (let i = 0; i < 600; i++) {
      const current = tasks.getTask(task.id)
      if (current.status === status) return current
      if (['failed', 'reconciling'].includes(current.status) && current.status !== status) throw new Error(current.error)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`timed out waiting for ${status}`)
  }
  await waitFor('failed')
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
  assert.deepEqual(db.prepare('SELECT status FROM long_video_segments WHERE task_id = ? ORDER BY position').all(task.id).map((row) => row.status), ['completed', 'pending'])
  tasks.retryTask(task.id)
  const completed = await waitFor('success')
  assert.equal(submissions.length - startCount, 3, 'only the failed segment is regenerated')
  assert.deepEqual(submissions.slice(startCount).map((entry) => entry.body.task), ['i2av', 'fl2av', 'fl2av'])
  const compiledPrompt = JSON.parse(submissions[startCount].body.prompt)
  assert.equal(compiledPrompt.overall_soundscape, '安静室内')
  assert.equal(compiledPrompt.non_diegetic_music, '柔和背景音乐')
  assert.match(compiledPrompt.integrated_multimodal_description, /暖色自然光/)
  assert.ok(Math.abs(completed.result.videos[0].duration - 15) < 0.5)
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 52)
  const segments = db.prepare('SELECT result_url, first_frame_url FROM long_video_segments WHERE task_id = ?').all(task.id)
  const intermediate = segments.flatMap((row) => [row.result_url, row.first_frame_url]).filter(Boolean).map(media.localMediaPath)
  const output = media.localMediaPath(completed.result.videos[0].url)
  tasks.deleteTask(task.id)
  assert.ok(intermediate.every((file) => !fs.existsSync(file)), 'unreferenced segment files should be cleaned up')
  assert.equal(fs.existsSync(output), true, 'the final video remains in works/materials')
})

test('unreachable gateway before submission refunds and long video can retry safely', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('gateway-offline','test','test',100)").run().lastInsertRowid
  const before = submissions.length
  failGatewayConnection = true
  const task = tasks.createTask(user, 'materialField', { prompt: '测试断网', duration: 15, ratio: '9:16', resolution: '540P', refs: [] }, 48)
  try {
    for (let i = 0; i < 600 && tasks.getTask(task.id).status !== 'failed'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(tasks.getTask(task.id).status, 'failed')
    assert.match(tasks.getTask(task.id).error, /任务未提交/)
    assert.equal(submissions.length, before)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
    assert.ok(db.prepare('SELECT status, provider_task_id FROM long_video_segments WHERE task_id = ?').all(task.id).every((row) => row.status === 'pending' && !row.provider_task_id))
  } finally { failGatewayConnection = false }
  tasks.retryTask(task.id)
  for (let i = 0; i < 600 && tasks.getTask(task.id).status !== 'success'; i++) {
    const current = tasks.getTask(task.id)
    if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(tasks.getTask(task.id).status, 'success')
  assert.equal(submissions.length - before, 2)
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 52)
})

test('H3 frame counts and [height,width] sizes match the gateway contract', () => {
  assert.equal(spec.h3FramesForDuration(4), 124)
  assert.equal(spec.h3FramesForDuration(8), 192)
  assert.deepEqual(spec.h3Size('16:9', '720P'), [736, 1280])
  assert.deepEqual(spec.h3Size('9:16', '540P'), [960, 544])
  assert.throws(() => spec.validateH3Frames(243))
  assert.throws(() => spec.h3FramesForDuration(10))
  assert.equal(media.localMediaPath('/uploads/%2e%2e/secret'), null)
})

test('one-minute video is split into bounded automatic segments', async () => {
  const { segmentDurations } = await import('../src/services/longVideo.js')
  assert.deepEqual(segmentDurations(60), [8, 8, 8, 8, 8, 8, 8, 4])
  assert.throws(() => segmentDurations(Infinity))
  assert.throws(() => segmentDurations(97))
})

test('one-minute workflow automatically generates and combines eight video segments', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('one-minute','test','test',1000)").run().lastInsertRowid
  const before = submissions.length
  const task = tasks.createTask(user, 'materialField', { prompt: '一分钟产品展示', duration: 60, ratio: '9:16', resolution: '540P', refs: [] }, 192)
  for (let i = 0; i < 1500 && tasks.getTask(task.id).status !== 'success'; i++) {
    const current = tasks.getTask(task.id)
    if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const completed = tasks.getTask(task.id)
  assert.equal(completed.status, 'success')
  assert.equal(submissions.length - before, 8)
  assert.ok(Math.abs(completed.result.videos[0].duration - 60) < 1)
})

test('all four H3 input modes submit actual frames and produce probed videos', async () => {
  const one = Buffer.from('first').toString('base64')
  const last = Buffer.from('last').toString('base64')
  const modes = [
    { task: 't2av' }, { task: 'i2av', imageSrc: one },
    { task: 'l2av', lastFrameSrc: last }, { task: 'fl2av', imageSrc: one, lastFrameSrc: last },
  ]
  for (const mode of modes) {
    const result = await providers.mgVideoGen({ ...mode, prompt: 'test', size: [544, 960], num_frames: 124, targetDuration: 4, idempotencyKey: `key-${mode.task}` })
    const submitted = submissions.at(-1)
    assert.equal(submitted.body.task, mode.task)
    assert.equal(submitted.key, `key-${mode.task}`)
    assert.equal(!!submitted.body.image_path, !!mode.imageSrc)
    assert.equal(!!submitted.body.last_frame_path, !!mode.lastFrameSrc)
    assert.ok(Math.abs(result.videos[0].duration - 4) < 0.15)
    if (mode.lastFrameSrc) {
      const image = spawnSync(media.FFMPEG, ['-v', 'error', '-ss', '3.7', '-i', media.localMediaPath(result.videos[0].url), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: null })
      assert.equal(image.status, 0)
      assert.ok(image.stdout[2] > image.stdout[0], 'ending should remain blue, not be cut away')
    }
  }
  const count = submissions.length
  await providers.mgVideoGen({ prompt: 'resume', task: 't2av', size: [544, 960], num_frames: 124, resumeTaskId: 'known-job' })
  assert.equal(submissions.length, count, 'resuming must not submit a duplicate')
  await assert.rejects(providers.mgDownload('http://127.0.0.1:9/steal.mp4', 'mp4'), /不属于已配置的网关/)
})

test('failed and canceled jobs refund exactly once, with no mock success', async () => {
  process.env.AI_REAL_ENABLED = 'false'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('test','test','test',100)").run().lastInsertRowid
  const task = tasks.createTask(user, 'materialField', { prompt: 'test' }, 20)
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 80)
  for (let i = 0; i < 100 && tasks.getTask(task.id).status !== 'failed'; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  const failed = tasks.getTask(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.result, null)
  assert.equal(failed.billing_state, 'refunded')
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works WHERE source_id = ?').get(task.id).n, 0)
  const canceled = tasks.createTask(user, 'materialField', { prompt: 'cancel' }, 20)
  await tasks.cancelTask(canceled.id)
  await assert.rejects(tasks.cancelTask(canceled.id))
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
  assert.throws(() => tasks.createTask(user, 'materialField', { prompt: 'too expensive' }, 101), /点数不足/)
})

test('restart recovers known upstream tasks without submitting duplicates', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('recovery','test','test',100)").run().lastInsertRowid
  const params = JSON.stringify({ prompt: 'recover', duration: 4, ratio: '9:16', resolution: '540P', refs: [] })
  const insert = db.prepare("INSERT INTO ai_tasks (task_no,module,title,params,status,owner_id,points_cost,idempotency_key,provider_task_id,billing_state) VALUES (?, 'materialField','recover',?,'running',?,0,?,?, 'reserved')")
  const known = insert.run('RECOVER-KNOWN', params, user, 'same-idempotency', 'known-job').lastInsertRowid
  const count = submissions.length
  tasks.recoverAiTasks()
  for (let i = 0; i < 300 && tasks.getTask(known).status !== 'success'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(tasks.getTask(known).status, 'success')
  assert.equal(submissions.length, count)
  const unknown = insert.run('RECOVER-UNKNOWN', params, user, 'unknown-idempotency', null).lastInsertRowid
  tasks.recoverAiTasks()
  assert.equal(tasks.getTask(unknown).status, 'reconciling')
  assert.throws(() => tasks.retryTask(unknown), /没有上游任务编号/)
})

test('image tasks persist the upstream id and save a real image asset', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('image-task','test','test',100)").run().lastInsertRowid
  const task = tasks.createTask(user, 'humanAsset', { assetType: 'scene', sceneKey: 'studio', title: '测试场景' }, 10)
  for (let i = 0; i < 300 && tasks.getTask(task.id).status !== 'success'; i++) {
    const current = tasks.getTask(task.id)
    if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const complete = tasks.getTask(task.id)
  assert.equal(complete.status, 'success')
  assert.ok(complete.provider_task_id)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM human_assets WHERE owner_id = ?').get(user).n, 1)
  assert.ok(fs.existsSync(media.localMediaPath(complete.result.images[0].url)))
})

test('administrator bootstrap only runs against an empty database', () => {
  const targetDb = path.join(temp, 'bootstrap.db')
  const env = { ...process.env, DB_PATH: targetDb, BOOTSTRAP_ADMIN_ACCOUNT: 'first-admin', BOOTSTRAP_ADMIN_PASSWORD: 'isolated-strong-test-password' }
  const first = spawnSync(process.execPath, ['src/bootstrap-admin.js'], { cwd: path.resolve('.'), env, encoding: 'utf8', windowsHide: true })
  assert.equal(first.status, 0, first.stderr)
  const second = spawnSync(process.execPath, ['src/bootstrap-admin.js'], { cwd: path.resolve('.'), env, encoding: 'utf8', windowsHide: true })
  assert.equal(second.status, 1)
  assert.match(second.stderr, /already has users/)
  const blockedSeed = spawnSync(process.execPath, ['src/seed.js'], { cwd: path.resolve('.'), env: { ...env, NODE_ENV: 'test', ALLOW_DESTRUCTIVE_DEMO_SEED: '' }, encoding: 'utf8', windowsHide: true })
  assert.equal(blockedSeed.status, 1)
  const check = new Database(targetDb, { readonly: true })
  assert.equal(check.prepare('SELECT COUNT(*) n FROM users').get().n, 1)
  check.close()
})

test('IndexTTS voice upload and replacement produce a real audio track and enforce ownership', async () => {
  const owner = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('voice','test','test',100)").run().lastInsertRowid
  const other = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('other','test','test',100)").run().lastInsertRowid
  const voice = await tts.uploadVoice(owner, '测试音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  assert.equal(voice.name, '测试音色')
  const params = { videoUrl: '/uploads/fixture.mp4', voiceId: voice.id, text: '这是一段测试配音', speed: 1, lang: 'zh', mode: 'replace', subtitle: true }
  await assert.rejects(tts.dubVideo(other, params), /无权使用/)
  const result = await tts.dubVideo(owner, params)
  assert.equal(result.subtitle.burned, true)
  assert.equal(result.subtitle.timing, 'estimated')
  const info = await media.probeMedia(media.localMediaPath(result.videos[0].url))
  assert.equal(info.hasAudio, true)
  assert.ok(Math.abs(info.duration - 9) < 0.2)
  assert.equal(fs.readdirSync(process.env.PRIVATE_DATA_DIR).length, 0)
  await tts.deleteVoice(owner, voice.id)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_profiles WHERE id = ?').get(voice.id).n, 0)
})

test('automatic subtitles stop when sampled frames contain text or OCR is unavailable', async () => {
  const owner = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('text-guard','test','test',100)").run().lastInsertRowid
  const voice = await tts.uploadVoice(owner, '测试音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  const params = { videoUrl: '/uploads/fixture.mp4', voiceId: voice.id, text: '新的配音字幕', speed: 1, lang: 'zh', mode: 'replace', subtitle: true }
  try {
    ocrText = '已有字幕'
    const detected = await tts.dubVideo(owner, params)
    assert.equal(detected.qualityCheck.status, 'text_detected')
    assert.equal(detected.subtitle.burned, false)
    assert.match(detected.warnings.join(' '), /暂停添加新字幕/)
    assert.equal((await media.probeMedia(media.localMediaPath(detected.videos[0].url))).hasAudio, true)
    ocrText = ''
    failOCR = true
    const unavailable = await tts.dubVideo(owner, params)
    assert.equal(unavailable.qualityCheck.status, 'unavailable')
    assert.equal(unavailable.subtitle.burned, false)
    assert.match(unavailable.warnings.join(' '), /检查未完成/)
  } finally {
    ocrText = ''
    failOCR = false
    await tts.deleteVoice(owner, voice.id)
  }
})

test('gateway speech uses the enrolled voice even when direct voice management is unavailable', async () => {
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('gateway-voice','test','test',100)").run().lastInsertRowid
  const voice = await tts.uploadVoice(user, '网关音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  const originalProvider = process.env.INDEX_TTS_SYNTHESIS_PROVIDER
  const originalBase = process.env.INDEX_TTS_BASE_URL
  try {
    process.env.INDEX_TTS_SYNTHESIS_PROVIDER = 'modelgate'
    process.env.INDEX_TTS_BASE_URL = 'http://127.0.0.1:1'
    const status = await tts.indexTtsStatus()
    assert.equal(status.available, true)
    assert.equal(status.managementAvailable, false)
    assert.equal(status.maxTextLength, 400)
    const result = await tts.dubVideo(user, { videoUrl: '/uploads/with-audio.mp4', voiceId: voice.id, text: '网关配音测试', mode: 'replace', speed: 1, lang: 'zh', subtitle: false })
    assert.equal(result.provider, 'indextts')
    assert.equal(result.synthesisProvider, 'modelgate')
    assert.equal((await media.probeMedia(media.localMediaPath(result.videos[0].url))).hasAudio, true)
    const sent = gatewaySpeechRequests.at(-1)
    assert.equal(sent.input, '网关配音测试')
    assert.equal(sent.voice, db.prepare('SELECT provider_name FROM voice_profiles WHERE id = ?').get(voice.id).provider_name)
    assert.equal(sent.response_format, 'wav')
    process.env.INDEX_TTS_BASE_URL = originalBase
    failGatewayConnection = true
    const offline = await tts.indexTtsStatus()
    assert.equal(offline.available, false)
    assert.equal(offline.managementAvailable, true)
    const count = gatewaySpeechRequests.length
    await assert.rejects(tts.dubVideo(user, { videoUrl: '/uploads/with-audio.mp4', voiceId: voice.id, text: '不可达', mode: 'replace', speed: 1, lang: 'zh' }), /配音服务暂时不可连接/)
    assert.equal(gatewaySpeechRequests.length, count)
  } finally {
    failGatewayConnection = false
    process.env.INDEX_TTS_BASE_URL = originalBase
    if (originalProvider === undefined) delete process.env.INDEX_TTS_SYNTHESIS_PROVIDER
    else process.env.INDEX_TTS_SYNTHESIS_PROVIDER = originalProvider
    await tts.deleteVoice(user, voice.id)
  }
})

test('speech subtitle drafts preserve valid provider timing and mark fallback estimates', async () => {
  const { subtitleDraftFromSpeech } = await import('../src/services/subtitleTranscription.js')
  const exact = subtitleDraftFromSpeech({ text: '第一句。第二句。', segments: [{ text: '第一句。', start: 1, end: 2 }, { text: '第二句。', start: 4, end: 5 }] }, 8)
  assert.equal(exact.timing, 'segment')
  assert.deepEqual(exact.segments.map(({ start, end }) => [start, end]), [[1, 2], [4, 5]])
  const estimated = subtitleDraftFromSpeech({ text: '第一句。第二句。', segments: [{ text: '第一句。第二句。', start: null, end: null }] }, 8)
  assert.equal(estimated.timing, 'estimated')
  assert.equal(estimated.segments[0].start, 0)
  assert.equal(estimated.segments.at(-1).end, 8)
  const split = subtitleDraftFromSpeech({ text: '第一句。第二句。', segments: [{ text: '第一句。第二句。', start: 1, end: 5 }] }, 8)
  assert.equal(split.timing, 'segment_estimated')
  assert.equal(split.segments[0].start, 1)
  assert.equal(split.segments.at(-1).end, 5)
  assert.throws(() => subtitleDraftFromSpeech({ text: '' }, 8), /未识别到语音/)
})

test('digital-human generation prompt does not expose the script as on-screen text', () => {
  const prompt = tasks.buildHumanScenePrompt({ text: '欢迎来到小店', humanName: '主播' })
  assert.doesNotMatch(prompt, /欢迎来到小店/)
  assert.match(prompt, /自然说话/)
  assert.match(prompt, /字幕/)
})

test('digital-human task uses the selected authorized voice and adds subtitles', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('human','test','test',200)").run().lastInsertRowid
  const voice = await tts.uploadVoice(user, '我的音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  const task = tasks.createTask(user, 'human', { text: '这是一段测试配音', firstFrame: '/uploads/input.jpg', voiceProfileId: voice.id, subtitle: { enabled: true, style: 'pure' } }, 70)
  for (let i = 0; i < 600 && tasks.getTask(task.id).status !== 'success'; i++) {
    const current = tasks.getTask(task.id)
    if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const completed = tasks.getTask(task.id)
  assert.equal(completed.status, 'success')
  assert.equal(completed.result.voice.provider, 'IndexTTS')
  assert.equal(completed.result.voice.dubbed, true)
  assert.equal(completed.result.subtitle.enabled, true)
  assert.deepEqual(completed.result.warnings, [])
  assert.equal((await media.probeMedia(media.localMediaPath(completed.result.videos[0].url))).hasAudio, true)
})

test('digital-human subtitle fallback does not bypass the text check', async () => {
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('human-text-guard','test','test',200)").run().lastInsertRowid
  const voice = await tts.uploadVoice(user, '测试音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  try {
    ocrText = '旧画面字幕'
    const task = tasks.createTask(user, 'human', { text: '测试配音', voiceProfileId: voice.id, subtitle: { enabled: true } }, 70)
    for (let i = 0; i < 600 && !['success', 'failed', 'reconciling'].includes(tasks.getTask(task.id).status); i++) await new Promise((resolve) => setTimeout(resolve, 20))
    const completed = tasks.getTask(task.id)
    assert.equal(completed.status, 'success')
    assert.equal(completed.result.qualityCheck.status, 'text_detected')
    assert.equal(completed.result.voice.dubbed, true)
    assert.equal(completed.result.subtitle.enabled, false)
    assert.match(completed.result.warnings.join(' '), /暂停添加新字幕/)
  } finally { ocrText = ''; await tts.deleteVoice(user, voice.id) }
})

test('digital-human task retains generated video and warns if voice synthesis fails', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('human-no-voice','test','test',200)").run().lastInsertRowid
  const voice = await tts.uploadVoice(user, '我的音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  failSpeech = true
  try {
    const task = tasks.createTask(user, 'human', { text: '这是一段测试配音', voiceProfileId: voice.id, subtitle: { enabled: true, style: 'pure' } }, 70)
    for (let i = 0; i < 600 && tasks.getTask(task.id).status !== 'success'; i++) {
      const current = tasks.getTask(task.id)
      if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const completed = tasks.getTask(task.id)
    assert.equal(completed.status, 'success')
    assert.equal(completed.result.voice.dubbed, false)
    assert.equal(completed.result.subtitle.enabled, true)
    assert.match(completed.result.warnings.join('；'), /配音未完成/)
  } finally { failSpeech = false }
})

test('video generation and dubbing use separate concurrency limits', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('parallel','test','test',100)").run().lastInsertRowid
  const voice = await tts.uploadVoice(user, '并发音色', fs.readFileSync(path.join(temp, 'sample.wav')), 'sample.wav')
  holdNextVideo = true
  const video = tasks.createTask(user, 'materialField', { prompt: 'parallel', duration: 4, ratio: '9:16', resolution: '540P', refs: [] }, 0)
  for (let i = 0; i < 200 && !tasks.getTask(video.id).provider_task_id; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  const providerId = tasks.getTask(video.id).provider_task_id
  assert.ok(providerId && heldJobs.has(providerId))
  const speech = tasks.createTask(user, 'voiceDub', { videoUrl: '/uploads/fixture.mp4', voiceId: voice.id, text: '并发测试', speed: 1, lang: 'zh', mode: 'replace' }, 0)
  for (let i = 0; i < 300 && tasks.getTask(speech.id).status !== 'success'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(tasks.getTask(speech.id).status, 'success')
  assert.equal(tasks.getTask(video.id).status, 'running')
  heldJobs.delete(providerId)
  for (let i = 0; i < 400 && tasks.getTask(video.id).status !== 'success'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(tasks.getTask(video.id).status, 'success')
  await tts.deleteVoice(user, voice.id)
})

test('video analysis uses real extraction paths and reports recognized audio and frame text', async () => {
  ocrText = '识别出的画面文字'
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('analysis','test','test',100)").run().lastInsertRowid
  const task = tasks.createTask(user, 'videoAnalysis', { videoUrl: '/uploads/with-audio.mp4' }, 50)
  for (let i = 0; i < 500 && tasks.getTask(task.id).status !== 'success'; i++) {
    const current = tasks.getTask(task.id)
    if (['failed', 'reconciling'].includes(current.status)) throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const completed = tasks.getTask(task.id)
  assert.equal(completed.status, 'success')
  assert.equal(completed.result.analysis.transcript, '识别出的语音')
  assert.deepEqual(completed.result.analysis.transcriptSegments[0], { text: '识别出的语音', start: 0, end: 3 })
  assert.equal(completed.result.analysis.frames.length, 3)
  assert.ok(completed.result.analysis.frames.every((frame) => frame.text === '识别出的画面文字'))
  assert.ok(completed.result.analysis.sceneChanges.times.some((time) => Math.abs(time - 8) < 0.15), 'detect the actual red-to-blue cut')
  assert.match(completed.result.analysis.limitation, /未理解/)
  ocrText = ''
})

test('video analysis fails and refunds when a silent video cannot be OCRed', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('analysis-failure','test','test',100)").run().lastInsertRowid
  failOCR = true
  try {
    const task = tasks.createTask(user, 'videoAnalysis', { videoUrl: '/uploads/fixture.mp4' }, 50)
    for (let i = 0; i < 500 && tasks.getTask(task.id).status !== 'failed'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(tasks.getTask(task.id).status, 'failed')
    assert.equal(tasks.getTask(task.id).result, null)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
  } finally { failOCR = false }
})

test('reference video generation fails and refunds when no reference text can be read', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('replica-failure','test','test',200)").run().lastInsertRowid
  const before = submissions.length
  failOCR = true
  try {
    const task = tasks.createTask(user, 'replica', { videoUrl: '/uploads/fixture.mp4', prompt: '介绍商品', duration: 4, ratio: '9:16', resolution: '540P' }, 62)
    for (let i = 0; i < 500 && tasks.getTask(task.id).status !== 'failed'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(tasks.getTask(task.id).status, 'failed')
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 200)
    assert.equal(submissions.length, before)
  } finally { failOCR = false }
})

test('historical demo and unverifiable outputs are labelled without altering stored records', () => {
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('legacy-review','test','test',100)").run().lastInsertRowid
  const insert = db.prepare("INSERT INTO ai_tasks (task_no,module,status,params,result,owner_id) VALUES (?,?,'success','{}',?,?)")
  const cases = [
    ['legacy-mock', 'factory', { engine: 'mock' }, /模拟结果/],
    ['legacy-studio', 'studio', { engine: 'real', provider: 'modelgate' }, /无法确认商品保真/],
    ['legacy-replica', 'replica', { engine: 'real', provider: 'modelgate' }, /无法确认是否真实参考原片/],
  ]
  for (const [number, module, result, expected] of cases) {
    const original = JSON.stringify(result)
    const id = insert.run(number, module, original, user).lastInsertRowid
    assert.match(tasks.getTask(id).result.warnings.join('；'), expected)
    assert.equal(db.prepare('SELECT result FROM ai_tasks WHERE id = ?').get(id).result, original)
  }
})

test('submitted video cancellation waits for upstream confirmation before refunding', async () => {
  process.env.AI_REAL_ENABLED = 'true'
  const user = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('cancel-model','test','test',100)").run().lastInsertRowid
  holdNextVideo = true
  const task = tasks.createTask(user, 'materialField', { prompt: 'cancel', duration: 4, ratio: '9:16', resolution: '540P', refs: [] }, 20)
  for (let i = 0; i < 200 && !tasks.getTask(task.id).provider_task_id; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(tasks.getTask(task.id).provider_task_id)
  const cancel = await tasks.cancelTask(task.id)
  assert.equal(cancel.status, 'canceling')
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 80)
  for (let i = 0; i < 500 && tasks.getTask(task.id).status !== 'canceled'; i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(tasks.getTask(task.id).status, 'canceled')
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(user).ai_points, 100)
  await assert.rejects(tasks.cancelTask(task.id))
})

test('subtitles are burned onto a real video and can be disabled', async () => {
  const { burnSubtitles, splitScript, validateSubtitleSegments, buildAss } = await import('../src/services/subtitleBurn.js')
  const short = splitScript('第一句，第二句，第三句，第四句，第五句。', 1)
  assert.ok(short.every((segment) => segment.end > segment.start && segment.end <= 1))
  assert.match(splitScript('Hello world, welcome.', 4)[0].text, /Hello world/)
  assert.throws(() => validateSubtitleSegments([{ text: 'one', start: 0, end: 2 }, { text: 'two', start: 1, end: 3 }], 4), /时间无效/)
  assert.throws(() => validateSubtitleSegments([{ text: 'one', start: null, end: 2 }], 4), /时间无效/)
  const safe = validateSubtitleSegments([{ text: 'safe{\\pos(1,1)}\nline', start: 0, end: 1 }], 4)
  assert.doesNotMatch(safe[0].text, /[{}\\\n]/)
  assert.match(buildAss([{ text: 'time', start: 59.999, end: 61 }], 'pure', { width: 640, height: 360 }), /0:01:00\.00,0:01:01\.00/)
  const enabled = await burnSubtitles('/uploads/fixture.mp4', { text: '这是一段字幕测试。', style: 'pure' })
  assert.equal(enabled.subtitleBurned, true)
  assert.ok((await media.probeMedia(media.localMediaPath(enabled.url))).duration > 8)
  const disabled = await burnSubtitles('/uploads/fixture.mp4', { text: '不应显示字幕', burn: false })
  assert.equal(disabled.subtitleBurned, false)
})

test('interrupted local video join is marked for review and can be retried', async () => {
  const owner = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('join-recovery','test','test',10)").run().lastInsertRowid
  const id = db.prepare("INSERT INTO ai_tasks (task_no,module,title,params,status,owner_id,billing_state,idempotency_key) VALUES ('join-recovery-task','videoJoin','join',?,'running',?,'reserved','join-recovery-key')")
    .run(JSON.stringify({ title: 'join', videoUrls: ['/uploads/blue.mp4', '/uploads/fixture.mp4'] }), owner).lastInsertRowid
  tasks.recoverAiTasks()
  assert.equal(tasks.getTask(id).status, 'reconciling')
  assert.match(tasks.getTask(id).stage, /拼接中断/)
  tasks.retryTask(id)
  for (let i = 0; i < 600 && tasks.getTask(id).status !== 'success'; i++) {
    const current = tasks.getTask(id)
    if (current.status === 'failed') throw new Error(current.error)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(tasks.getTask(id).status, 'success')
  assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, 10)
})

test('uploaded media is available only to an authenticated owner or team', async () => {
  const owner = db.prepare("INSERT INTO users (account,password,name) VALUES ('media-owner','test','owner')").run().lastInsertRowid
  const outsider = db.prepare("INSERT INTO users (account,password,name) VALUES ('media-other','test','other')").run().lastInsertRowid
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('private','video','/uploads/fixture.mp4',?)").run(owner)
  const { signToken } = await import('../src/middleware/auth.js')
  const { mediaAccess } = await import('../src/middleware/mediaAccess.js')
  const authorize = (userId) => {
    const user = userId && db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    const req = { path: '/fixture.mp4', headers: user ? { cookie: `yimetai_media=${signToken(user)}` } : {} }
    let status = 200
    const res = { status(code) { status = code; return this }, end() {} }
    mediaAccess(req, res, () => { status = 200 })
    return status
  }
  assert.equal(authorize(null), 401)
  assert.equal(authorize(owner), 200)
  assert.equal(authorize(outsider), 404)
})

test('isolated HTTP flow protects data and produces playable H3 and dubbing results', async () => {
  const bcrypt = (await import('bcryptjs')).default
  const password = await bcrypt.hash('only-for-isolated-test', 4)
  const owner = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('e2e',?,'e2e',300)").run(password).lastInsertRowid
  const outsider = db.prepare("INSERT INTO users (account,password,name,ai_points) VALUES ('e2e-outsider',?,'outsider',100)").run(password).lastInsertRowid
  const legacyId = db.prepare("INSERT INTO ai_tasks (task_no,module,status,params,result,owner_id) VALUES ('e2e-legacy','factory','success','{}',?,?)").run(JSON.stringify({ engine: 'mock', videos: [] }), owner).lastInsertRowid
  fs.copyFileSync(path.join(uploads, 'input.jpg'), path.join(uploads, 'private-other.jpg'))
  fs.copyFileSync(fixture, path.join(uploads, 'private-other.mp4'))
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('private image','image','/uploads/private-other.jpg',?)").run(outsider)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('private video','video','/uploads/private-other.mp4',?)").run(outsider)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('image','image','/uploads/input.jpg',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('transparent product','image','/uploads/fixture-transparent.png',?)").run(owner)
  assert.equal(fs.existsSync(media.localMediaPath('/uploads/input.jpg')), true)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('video','video','/uploads/fixture.mp4',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('audio video','video','/uploads/with-audio.mp4',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('blue','video','/uploads/blue.mp4',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('short audio','video','/uploads/short-audio.mp4',?)").run(owner)
  db.prepare("UPDATE materials SET size = 111 WHERE url = '/uploads/input.jpg' AND owner_id = ?").run(owner)
  db.prepare("UPDATE materials SET size = 9999 WHERE url = '/uploads/private-other.jpg' AND owner_id = ?").run(outsider)
  const scriptId = db.prepare("INSERT INTO scripts (title, content, owner_id) VALUES ('test','original',?)").run(owner).lastInsertRowid
  db.prepare("INSERT INTO script_subitems (script_id,scene_no,scene_desc,line,duration,sort) VALUES (?,1,'用户原有分镜','原有台词',5,0)").run(scriptId)
  const portProbe = net.createServer()
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  const port = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['src/index.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), AI_REAL_ENABLED: 'true', NODE_ENV: 'production', JWT_SECRET: 'isolated-production-test-secret-0123456789' }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += String(chunk).slice(0, 2000) })
  try {
    let healthy = false
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) break
      try { if ((await fetch(`${base}/health`)).ok) { healthy = true; break } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(healthy, true, `test server should start: ${errors.slice(-1000)}`)
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'e2e', password: 'only-for-isolated-test' }) })
    const session = await login.json()
    assert.equal(session.code, 0)
    assert.equal(session.data.userInfo.id, Number(owner))
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const headers = { Authorization: `Bearer ${session.data.token}`, 'Content-Type': 'application/json' }
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers })
    assert.equal((await logout.json()).code, 0)
    const clearedCookie = logout.headers.get('set-cookie') || ''
    assert.match(clearedCookie, /yimetai_media=/)
    assert.doesNotMatch(clearedCookie, /;\s*secure(?:;|$)/i)
    const post = async (url, body) => (await fetch(`${base}/api${url}`, { method: 'POST', headers, body: JSON.stringify(body) })).json()
    const legacyTask = await (await fetch(`${base}/api/task/detail?id=${legacyId}`, { headers })).json()
    assert.match(legacyTask.data.result.warnings.join('；'), /模拟结果/)
    const conversation = await post('/conversations', { title: 'test', skill: 'script' })
    assert.equal(conversation.code, 0)
    const chat = await (await fetch(`${base}/api/conversations/chat?conversationId=${conversation.data.id}&message=test`, { headers })).text()
    assert.match(chat, /event: message.done/)
    assert.match(chat, /真实模型回答/)
    assert.equal((await post('/conversations', { skill: 'invalid' })).code, 400)
    assert.equal((await post(`/conversations/${conversation.data.id}/skill`, { skill: 'invalid' })).code, 400)
    const otherConversation = db.prepare("INSERT INTO conversations (title,skill,owner_id) VALUES ('other','script',?)").run(outsider).lastInsertRowid
    assert.equal((await post(`/conversations/${otherConversation}/skill`, { skill: 'video' })).code, 404)
    assert.equal(db.prepare('SELECT skill FROM conversations WHERE id = ?').get(otherConversation).skill, 'script')
    assert.equal((await post(`/conversations/${conversation.data.id}/skill`, { skill: 'video' })).code, 0)
    const stream = await (await fetch(`${base}/api/conversations/chat/stream`, {
      method: 'POST', headers, body: JSON.stringify({ conversationId: conversation.data.id, message: '请规划分镜' }),
    })).text()
    assert.match(stream, /event: message.done/)
    assert.match(chatRequests.at(-1).messages[0].content, /当前技能：视频脚本/)
    assert.match(chatRequests.at(-1).messages[0].content, /只能读取用户输入的文字/)
    assert.equal(db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(conversation.data.id).content, '真实模型回答')
    const invalidStream = await fetch(`${base}/api/conversations/chat/stream`, {
      method: 'POST', headers, body: JSON.stringify({ conversationId: conversation.data.id, message: 'x'.repeat(4001) }),
    })
    assert.equal(invalidStream.status, 400)
    failNextChat = true
    const failedStream = await (await fetch(`${base}/api/conversations/chat/stream`, {
      method: 'POST', headers, body: JSON.stringify({ conversationId: conversation.data.id, message: '模型失败测试' }),
    })).text()
    assert.match(failedStream, /event: task.error/)
    assert.doesNotMatch(failedStream, /event: message.done/)
    assert.equal(db.prepare("SELECT role FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1").get(conversation.data.id).role, 'user')
    holdNextChat = true
    heldChatClosed = false
    const stopController = new AbortController()
    const timeout = setTimeout(() => stopController.abort(), 4000)
    try {
      const stoppedResponse = await fetch(`${base}/api/conversations/chat/stream`, {
        method: 'POST', headers, signal: stopController.signal,
        body: JSON.stringify({ conversationId: conversation.data.id, message: '停止流式对话测试' }),
      })
      const reader = stoppedResponse.body.getReader()
      let received = ''
      while (!received.includes('event: assistant.preview')) {
        const part = await reader.read()
        if (part.done) break
        received += new TextDecoder().decode(part.value)
      }
      assert.match(received, /event: assistant.preview/)
      stopController.abort()
      for (let i = 0; i < 80 && !heldChatClosed; i++) await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(heldChatClosed, true, 'stopping the client should close the upstream chat connection')
    } finally { clearTimeout(timeout); stopController.abort() }
    assert.equal((await (await fetch(`${base}/api/agent/generations`, { headers })).json()).code, 503)
    assert.equal((await (await fetch(`${base}/api/artifacts`, { headers })).json()).code, 503)
    const images = await (await fetch(`${base}/api/material/list?type=image`, { headers })).json()
    assert.ok(images.data.list.some((entry) => entry.url === '/uploads/input.jpg'), JSON.stringify(images))
    const memberStatus = await (await fetch(`${base}/api/charge/memberStatus`, { headers })).json()
    assert.equal(memberStatus.data.storage_used, 111)
    assert.equal(memberStatus.data.member_count, 1)
    assert.equal(memberStatus.data.points_total, null)
    assert.equal(memberStatus.data.seat_limit, null)
    assert.equal((await post('/super/resolution/estimate', { sourceUrl: '/uploads/private-other.mp4' })).code, 400)
    assert.equal((await post('/super/resolution/create/new', { sourceUrl: '/uploads/short-audio.mp4', mode: 'pro' })).code, 400)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, 300)
    failNextChat = true
    const failPlan = await post('/ai/script/intelligent/generation', { scriptId, productName: 'test' })
    assert.equal(failPlan.code, 503)
    assert.equal(db.prepare('SELECT scene_desc FROM script_subitems WHERE script_id = ?').get(scriptId).scene_desc, '用户原有分镜')
    const plan = await post('/ai/script/intelligent/generation', { scriptId, productName: 'test' })
    assert.equal(plan.code, 0)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM script_subitems WHERE script_id = ?').get(scriptId).n, 2)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM script_generation_records WHERE script_id = ?').get(scriptId).n, 1)
    const generated = await post('/create/materialField', { prompt: '真实请求链路测试', model: 'MiniMax-H3', ratio: '9:16', resolution: '540P', duration: 4, refs: [{ type: 'image', role: 'first', url: '/uploads/input.jpg' }, { type: 'image', role: 'last', url: '/uploads/input.jpg' }] })
    assert.equal(generated.code, 0, generated.message)
    const waitTask = async (id) => {
      for (let i = 0; i < 300; i++) {
        const task = await (await fetch(`${base}/api/task/detail?id=${id}`, { headers })).json()
        if (task.data?.status === 'success') return task.data
        if (['failed', 'reconciling'].includes(task.data?.status)) throw new Error(task.data.error)
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('task timed out')
    }
    const videoTask = await waitTask(generated.data.id)
    const url = videoTask.result.videos[0].url
    assert.equal((await fetch(`${base}${url}`)).status, 401)
    assert.equal((await fetch(`${base}${url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    const voiceForm = new FormData()
    voiceForm.set('name', 'e2e voice'); voiceForm.set('consent', 'true')
    voiceForm.set('audio', new Blob([fs.readFileSync(path.join(temp, 'sample.wav'))], { type: 'audio/wav' }), 'sample.wav')
    const voiceRes = await (await fetch(`${base}/api/voice/profiles`, { method: 'POST', headers: { Authorization: `Bearer ${session.data.token}` }, body: voiceForm })).json()
    assert.equal(voiceRes.code, 0)
    assert.equal((await (await fetch(`${base}/api/voice/status`, { headers })).json()).data.available, true)
    ttsHealthCode = 503
    try {
      assert.equal((await (await fetch(`${base}/api/voice/status`, { headers })).json()).data.available, false)
      const count = db.prepare("SELECT COUNT(*) n FROM ai_tasks WHERE module = 'voiceDub' AND owner_id = ?").get(owner).n
      const unavailable = await post('/voice/dub', { videoUrl: '/uploads/fixture.mp4', voiceId: voiceRes.data.id, text: '测试配音', mode: 'replace', speed: 1, lang: 'zh', subtitle: false })
      assert.equal(unavailable.code, 503)
      assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_tasks WHERE module = 'voiceDub' AND owner_id = ?").get(owner).n, count)
    } finally { ttsHealthCode = 200 }
    ttsHealthCode = 404
    try { assert.equal((await (await fetch(`${base}/api/voice/status`, { headers })).json()).data.available, null) }
    finally { ttsHealthCode = 200 }
    const foreignVoice = db.prepare('SELECT id FROM voice_profiles WHERE owner_id != ? LIMIT 1').get(owner)
    if (foreignVoice) assert.equal((await post('/create/human', { text: '测试', voiceProfileId: foreignVoice.id })).code, 400)
    assert.equal((await post('/create/human', { text: '测试', voice: 1 })).code, 400)
    assert.equal((await post('/create/human', { text: '测试', resolution: '8K' })).code, 400)
    const human = await post('/create/human', { text: '测试配音', firstFrame: '/uploads/input.jpg', voiceProfileId: voiceRes.data.id, resolution: '540P', subtitle: { enabled: true } })
    assert.equal(human.code, 0, human.message)
    const humanTask = await waitTask(human.data.id)
    assert.equal(humanTask.result.voice.dubbed, true)
    assert.deepEqual(submissions.at(-1).body.size, [960, 544])
    const dubbed = await post('/voice/dub', { videoUrl: '/uploads/fixture.mp4', voiceId: voiceRes.data.id, text: '测试配音', mode: 'replace', speed: 1, lang: 'zh', subtitle: true })
    assert.equal(dubbed.code, 0)
    const dubTask = await waitTask(dubbed.data.id)
    assert.equal((await fetch(`${base}${dubTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    const analyzed = await post('/video-analysis/create', { videoUrl: '/uploads/with-audio.mp4' })
    assert.equal(analyzed.code, 0, analyzed.message)
    const analysisTask = await waitTask(analyzed.data.id)
    assert.equal(analysisTask.result.analysis.transcript, '识别出的语音')
    assert.equal((await post('/voice/subtitles/transcribe', { videoUrl: '/uploads/private-other.mp4' })).code, 400)
    assert.equal((await post('/voice/subtitles/transcribe', { videoUrl: '/uploads/fixture.mp4' })).code, 400)
    const beforeTranscription = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    const transcription = await post('/voice/subtitles/transcribe', { videoUrl: '/uploads/with-audio.mp4' })
    assert.equal(transcription.code, 0, transcription.message)
    const transcribedTask = await waitTask(transcription.data.id)
    assert.equal(transcribedTask.result.subtitles.text, '识别出的语音')
    assert.equal(transcribedTask.result.subtitles.timing, 'segment')
    assert.deepEqual(transcribedTask.result.subtitles.segments.map(({ start, end }) => [start, end]), [[0, 3]])
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, beforeTranscription - transcription.data.points_cost)
    asrErrorStatus = 400
    try {
      const failedRecognition = await post('/voice/subtitles/transcribe', { videoUrl: '/uploads/with-audio.mp4' })
      assert.equal(failedRecognition.code, 0)
      let failed
      for (let i = 0; i < 300; i++) {
        failed = (await (await fetch(`${base}/api/task/detail?id=${failedRecognition.data.id}`, { headers })).json()).data
        if (failed.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(failed.status, 'failed')
      assert.equal(failed.billing_state, 'refunded')
      assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, beforeTranscription - transcription.data.points_cost)
    } finally { asrErrorStatus = 0 }
    assert.equal((await post('/voice/subtitles/estimate', { videoUrl: '/uploads/private-other.mp4', text: '测试字幕' })).code, 400)
    const draft = await post('/voice/subtitles/estimate', { videoUrl: '/uploads/with-audio.mp4', text: '第一句。第二句。' })
    assert.equal(draft.code, 0, draft.message)
    assert.equal(draft.data.timing, 'estimated')
    assert.ok(draft.data.segments.length >= 2)
    assert.equal((await post('/voice/subtitles/create', { videoUrl: '/uploads/with-audio.mp4', segments: [{ text: 'bad', start: 2, end: 1 }] })).code, 400)
    const captions = await post('/voice/subtitles/create', { videoUrl: '/uploads/with-audio.mp4', style: 'pure', segments: [{ text: '第一句', start: 0.5, end: 1.5 }, { text: '第二句', start: 2, end: 3 }] })
    assert.equal(captions.code, 0, captions.message)
    const captionTask = await waitTask(captions.data.id)
    assert.equal(captionTask.result.subtitle.timing, 'user')
    assert.equal(captionTask.result.videos[0].hasAudio, true)
    assert.match(captionTask.result.warnings.join('；'), /硬字幕不会被去除/)
    assert.equal(db.prepare('SELECT source FROM materials WHERE url = ? AND owner_id = ?').get(captionTask.result.videos[0].url, owner).source, 'edit')
    assert.equal((await fetch(`${base}${captionTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    assert.equal((await post('/voice/subtitles/create', { videoUrl: captionTask.result.videos[0].url, segments: [{ text: '替换', start: 0.5, end: 1.5 }], coverMode: 'drawbox=bad' })).code, 400)
    const covered = await post('/voice/subtitles/create', { videoUrl: captionTask.result.videos[0].url, style: 'pure', coverMode: 'bottom20', segments: [{ text: '新字幕', start: 0.5, end: 1.5 }] })
    assert.equal(covered.code, 0, covered.message)
    const coveredTask = await waitTask(covered.data.id)
    assert.equal(coveredTask.result.subtitle.coverMode, 'bottom20')
    assert.equal(coveredTask.result.videos[0].hasAudio, true)
    assert.match(coveredTask.result.warnings.join('；'), /并非无痕去字/)
    const coveredFile = media.localMediaPath(coveredTask.result.videos[0].url)
    const pixelAtY = (y) => {
      const frame = spawnSync(media.FFMPEG, ['-v', 'error', '-ss', '0.2', '-i', coveredFile, '-vf', `crop=2:2:4:${y},scale=1:1,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'])
      assert.equal(frame.status, 0)
      return frame.stdout
    }
    const top = pixelAtY(20), bottom = pixelAtY(90)
    assert.ok(top[0] > 150, 'the picture above the mask remains visible')
    assert.ok(bottom[0] < 20 && bottom[1] < 20 && bottom[2] < 20, 'the lower band is visibly covered')
    const balanceBeforeJoin = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    assert.equal((await post('/ai-mix/join', { videoUrls: ['/uploads/blue.mp4'] })).code, 400)
    assert.equal((await post('/ai-mix/join', { videoUrls: ['/uploads/blue.mp4', '/uploads/private-other.mp4'] })).code, 400)
    const join = await post('/ai-mix/join', { title: 'test join', videoUrls: ['/uploads/blue.mp4', '/uploads/with-audio.mp4'] })
    assert.equal(join.code, 0, join.message)
    const joined = await waitTask(join.data.id)
    assert.deepEqual(joined.result.inputUrls, ['/uploads/blue.mp4', '/uploads/with-audio.mp4'])
    const joinedPath = media.localMediaPath(joined.result.videos[0].url)
    const joinedMeta = await media.probeMedia(joinedPath)
    assert.ok(Math.abs(joinedMeta.duration - 12) < 0.5)
    assert.equal(joinedMeta.hasAudio, true)
    const pixelAt = (seconds) => {
      const frame = spawnSync(media.FFMPEG, ['-v', 'error', '-ss', String(seconds), '-i', joinedPath, '-vf', 'scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'])
      assert.equal(frame.status, 0)
      return frame.stdout
    }
    const firstPixel = pixelAt(1), secondPixel = pixelAt(4)
    assert.ok(firstPixel[2] > firstPixel[0] + 100, 'first clip is blue')
    assert.ok(secondPixel[0] > secondPixel[2] + 100, 'second clip is red')
    const joinedMaterial = db.prepare('SELECT source, engine FROM materials WHERE url = ? AND owner_id = ?').get(joined.result.videos[0].url, owner)
    assert.deepEqual(joinedMaterial, { source: 'edit', engine: 'real' })
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeJoin)
    assert.equal((await fetch(`${base}${joined.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    const balanceBeforeStudio = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    const materialCountBeforePrepare = db.prepare('SELECT COUNT(*) n FROM materials WHERE owner_id = ?').get(owner).n
    const preparedTransparent = await post('/create/studio/prepare', { imageUrl: '/uploads/fixture-transparent.png' })
    assert.equal(preparedTransparent.code, 0, preparedTransparent.message)
    assert.equal(preparedTransparent.data.url, '/uploads/fixture-transparent.png')
    assert.equal(preparedTransparent.data.method, 'original')
    assert.equal((await post('/create/studio/prepare', { imageUrl: '/uploads/private-other.jpg' })).code, 400)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM materials WHERE owner_id = ?').get(owner).n, materialCountBeforePrepare)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeStudio)
    const rejectedStudio = await post('/create/studio', { imageUrl: '/uploads/input.jpg', prompt: '白色影棚', count: 1 })
    assert.equal(rejectedStudio.code, 400)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeStudio)
    const studio = await post('/create/studio', { imageUrl: '/uploads/fixture-transparent.png', prompt: '白色影棚', count: 1 })
    assert.equal(studio.code, 0, studio.message)
    const studioTask = await waitTask(studio.data.id)
    assert.equal(studioTask.result.images[0].resolution, '1024x1024')
    assert.match(studioTask.result.warnings.join('；'), /人工检查/)
    assert.equal((await fetch(`${base}${studioTask.result.images[0].url}`, { headers: { Cookie: cookie } })).status, 200)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeStudio - 30)
    const rejectedReplica = await post('/create/replica', { videoUrl: '/uploads/with-audio.mp4', firstFrame: '/uploads/private-other.jpg', prompt: '介绍商品', duration: 4 })
    assert.equal(rejectedReplica.code, 400)
    const replica = await post('/create/replica', { videoUrl: '/uploads/with-audio.mp4', firstFrame: '/uploads/input.jpg', prompt: '介绍我的商品', duration: 4, ratio: '9:16', resolution: '540P', count: 1 })
    assert.equal(replica.code, 0, replica.message)
    const replicaTask = await waitTask(replica.data.id)
    assert.equal(replicaTask.result.reference.transcript, '识别出的语音')
    assert.equal(replicaTask.params.referenceAnalysis.transcript, '识别出的语音')
    assert.ok(replicaTask.result.reference.sceneChanges.times.some((time) => Math.abs(time - 8) < 0.15))
    assert.match(replicaTask.result.warnings.join('；'), /未理解或复制画面/)
    assert.match(JSON.stringify(submissions.at(-1).body), /识别出的语音/)
    assert.match(JSON.stringify(submissions.at(-1).body), /画面变化/)
    assert.equal((await fetch(`${base}${replicaTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)

    const estimate = await post('/super/resolution/estimate', { sourceUrl: '/uploads/short-audio.mp4' })
    assert.equal(estimate.code, 0, estimate.message)
    assert.equal(estimate.data.width, 160)
    assert.equal(estimate.data.hasAudio, true)
    assert.ok(estimate.data.points > 0)
    const balanceBeforeEnhance = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    const enhance = await post('/super/resolution/create/new', { sourceUrl: '/uploads/short-audio.mp4' })
    assert.equal(enhance.code, 0, enhance.message)
    const enhancedTask = await waitTask(enhance.data.id)
    assert.equal(enhancedTask.result.model, 'SeedVR2-3B')
    const enhancedInfo = await media.probeMedia(media.localMediaPath(enhancedTask.result.videos[0].url))
    assert.equal(enhancedInfo.width, 320)
    assert.equal(enhancedInfo.height, 192)
    assert.equal(enhancedInfo.hasAudio, true, 'original soundtrack must be restored when the provider returns silent video')
    assert.ok(Math.abs(enhancedInfo.duration - estimate.data.duration) < 0.25)
    const measured = spawnSync(media.FFMPEG, ['-i', media.localMediaPath(enhancedTask.result.videos[0].url), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(measured.status, 0)
    const peak = Number(measured.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1])
    assert.ok(Number.isFinite(peak) && peak > -80, 'the restored soundtrack should not be silent')
    const lastSubmission = submissions.at(-1).body
    assert.equal(lastSubmission.model, 'SeedVR2-3B')
    assert.deepEqual(Buffer.from(lastSubmission.file.split(',')[1], 'base64'), fs.readFileSync(path.join(uploads, 'short-audio.mp4')))
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeEnhance - estimate.data.points)
    assert.equal((await fetch(`${base}${enhancedTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    const listing = await (await fetch(`${base}/api/super/resolution/task/list`, { headers })).json()
    assert.ok(listing.data.list.some((item) => item.id === enhance.data.id))

    const balanceBeforeFailedEnhance = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    failSubmissionAt = submissions.length + 1
    const failedEnhance = await post('/super/resolution/create/new', { sourceUrl: '/uploads/short-audio.mp4' })
    assert.equal(failedEnhance.code, 0, failedEnhance.message)
    let failedTask
    for (let i = 0; i < 300; i++) {
      failedTask = (await (await fetch(`${base}/api/task/detail?id=${failedEnhance.data.id}`, { headers })).json()).data
      if (failedTask.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    failSubmissionAt = 0
    assert.equal(failedTask.status, 'failed')
    assert.equal(failedTask.billing_state, 'refunded')
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeFailedEnhance)
    invalidRestorationResult = true
    try {
      const invalidEnhance = await post('/super/resolution/create/new', { sourceUrl: '/uploads/short-audio.mp4' })
      assert.equal(invalidEnhance.code, 0, invalidEnhance.message)
      let invalidTask
      for (let i = 0; i < 300; i++) {
        invalidTask = (await (await fetch(`${base}/api/task/detail?id=${invalidEnhance.data.id}`, { headers })).json()).data
        if (invalidTask.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(invalidTask.status, 'failed')
      assert.equal(invalidTask.billing_state, 'refunded')
      assert.match(invalidTask.error, /尺寸、画幅或时长/)
      assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeFailedEnhance)
    } finally { invalidRestorationResult = false }
    const legacy = db.prepare("INSERT INTO super_res_tasks (name,source_url,mode,owner_id,result_url) VALUES ('old','/uploads/short-audio.mp4','standard',?,'/uploads/short-audio.mp4')").run(owner).lastInsertRowid
    assert.equal((await post('/super/resolution/task/delete', { id: legacy })).code, 503)
    assert.equal(fs.existsSync(path.join(uploads, 'short-audio.mp4')), true)
    assert.equal((await post('/three/second/make/video', { name: '开场', prompt: '杯子展示', firstFrame: '/uploads/private-other.jpg' })).code, 400)
    assert.equal((await post('/three/second/make/video', { name: '开场', prompt: '杯子展示', hookType: 'invalid' })).code, 400)
    const beforeHook = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    const hook = await post('/three/second/make/video', { name: '开场', prompt: '展示白色杯子，镜头推进', hookType: 'visual', firstFrame: '/uploads/input.jpg', resolution: '540P' })
    assert.equal(hook.code, 0, hook.message)
    const hookTask = await waitTask(hook.data.id)
    assert.equal(hookTask.result.model, 'MiniMax-H3')
    assert.match(hookTask.result.warnings.join('；'), /不保证播放量或完播率/)
    assert.ok(Math.abs((await media.probeMedia(media.localMediaPath(hookTask.result.videos[0].url))).duration - 3) < 0.15)
    assert.equal(submissions.at(-1).body.task, 'i2av')
    assert.equal(submissions.at(-1).body.num_frames, 124)
    assert.deepEqual(submissions.at(-1).body.size, [960, 544])
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, beforeHook - 30)
    asrErrorStatus = 503
    try {
      const before = asrCalls
      const uncertainRecognition = await post('/voice/subtitles/transcribe', { videoUrl: '/uploads/with-audio.mp4' })
      assert.equal(uncertainRecognition.code, 0)
      let uncertain
      for (let i = 0; i < 300; i++) {
        uncertain = (await (await fetch(`${base}/api/task/detail?id=${uncertainRecognition.data.id}`, { headers })).json()).data
        if (uncertain.status === 'reconciling') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(uncertain.status, 'reconciling')
      assert.equal(uncertain.billing_state, 'reserved')
      assert.equal((await post('/task/retry', { id: uncertainRecognition.data.id })).code, 400)
      assert.equal(asrCalls, before + 1, 'an uncertain recognition must not be submitted again automatically')
    } finally { asrErrorStatus = 0 }
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }
})

test('incompatible Elasticsearch dimensions never delete existing indices', async () => {
  const { esClient, initES, isESAvailable } = await import('../src/services/esService.js')
  const cluster = esClient.cluster
  const indices = esClient.indices
  const original = { health: cluster.health, exists: indices.exists, getFieldMapping: indices.getFieldMapping, delete: indices.delete }
  let deletes = 0
  cluster.health = async () => ({ status: 'green' })
  indices.exists = async () => true
  indices.getFieldMapping = async () => ({ index: { mappings: { embedding: { mapping: { embedding: { dims: 1 } } } } } })
  indices.delete = async () => { deletes++ }
  try {
    assert.equal(await initES(), false)
    assert.equal(isESAvailable(), false)
    assert.equal(deletes, 0)
  } finally {
    cluster.health = original.health
    indices.exists = original.exists
    indices.getFieldMapping = original.getFieldMapping
    indices.delete = original.delete
  }
})

test('red Elasticsearch cluster is reported unavailable and runtime failures downgrade', async () => {
  const { esClient, initES, isESAvailable, refreshESHealth } = await import('../src/services/esService.js')
  const cluster = esClient.cluster
  const indices = esClient.indices
  const original = { health: cluster.health, exists: indices.exists, create: indices.create }
  cluster.health = async () => ({ status: 'red' })
  try {
    assert.equal(await initES(), false)
    assert.equal(isESAvailable(), false)
    cluster.health = async () => ({ status: 'green' })
    indices.exists = async () => false
    indices.create = async () => ({})
    assert.equal(await initES(), true)
    cluster.health = async () => ({ status: 'red' })
    assert.equal(await refreshESHealth(), false)
    assert.equal(isESAvailable(), false)
  } finally {
    cluster.health = original.health
    indices.exists = original.exists
    indices.create = original.create
  }
})

test('interrupted lip-sync tasks never resubmit automatically after restart', () => {
  const owner = db.prepare("INSERT INTO users (account,password,name) VALUES ('lip-recovery','test','test')").run().lastInsertRowid
  const insert = db.prepare("INSERT INTO ai_tasks (task_no,module,status,stage,params,owner_id,provider_task_id,idempotency_key) VALUES (?,?, 'running','正在同步口型','{}',?,?,?)")
  const voice = insert.run('lip-voice-recovery', 'voiceDub', owner, null, null).lastInsertRowid
  const human = insert.run('lip-human-recovery', 'human', owner, 'h3-job', 'h3-key').lastInsertRowid
  tasks.recoverAiTasks()
  for (const id of [voice, human]) {
    const task = db.prepare('SELECT status,stage,error FROM ai_tasks WHERE id = ?').get(id)
    assert.equal(task.status, 'reconciling')
    assert.equal(task.stage, '口型状态待核对')
    assert.match(task.error, /不自动重复提交/)
    assert.throws(() => tasks.retryTask(id), /上游状态未确认/)
  }
})

test('interrupted speech and its post-processing do not resubmit upstream work', () => {
  const owner = db.prepare("INSERT INTO users (account,password,name) VALUES ('speech-recovery','test','test')").run().lastInsertRowid
  const insert = db.prepare("INSERT INTO ai_tasks (task_no,module,status,stage,params,owner_id,provider_task_id,idempotency_key) VALUES (?,?,'running',?,?,?,?,?)")
  const voice = insert.run('speech-voice-recovery', 'voiceDub', '正在抽帧检查画面文字', '{}', owner, null, null).lastInsertRowid
  const human = insert.run('speech-human-recovery', 'human', '正在添加字幕', '{"voiceProfileId":1}', owner, 'h3-job', 'h3-key').lastInsertRowid
  tasks.recoverAiTasks()
  for (const id of [voice, human]) {
    const task = db.prepare('SELECT status,stage FROM ai_tasks WHERE id = ?').get(id)
    assert.equal(task.status, 'reconciling')
    assert.equal(task.stage, '配音状态待核对')
    assert.throws(() => tasks.retryTask(id), /配音上游状态未确认/)
  }
})
