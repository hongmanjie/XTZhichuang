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

let media, providers, spec, db, tasks, server, tts
const submissions = []
const failureJobs = new Set()
const imageJobs = new Set()
const heldJobs = new Set()
const cancelledJobs = new Set()
let failSubmissionAt = 0
let failNextChat = false
let holdNextVideo = false
let failOCR = false
let failSpeech = false
const fixture = path.join(uploads, 'fixture.mp4')

before(async () => {
  media = await import('../src/services/mediaTools.js')
  spec = await import('../src/services/h3Spec.js')
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=red:s=160x96:d=8:r=24', '-f', 'lavfi', '-i', 'color=blue:s=160x96:d=1:r=24', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture])
  await media.runMedia(media.FFMPEG, ['-y', '-ss', '1', '-i', fixture, '-frames:v', '1', path.join(uploads, 'input.jpg')])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=240x320:d=1,format=rgba,drawbox=x=70:y=60:w=100:h=200:color=red@1.0:t=fill:replace=1', '-frames:v', '1', path.join(uploads, 'fixture-transparent.png')])
  await media.runMedia(media.FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'pcm_s16le', path.join(temp, 'sample.wav')])
  await media.runMedia(media.FFMPEG, ['-y', '-i', fixture, '-i', path.join(temp, 'sample.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-af', 'apad', '-t', '9', path.join(uploads, 'with-audio.mp4')])
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/xt-platform/models/v1/infer') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const payload = JSON.parse(body)
        if (payload.model === 'FunASR-Nano') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result: { prediction: { results: [{ text: '识别出的语音', start_time: 0, end_time: 3 }] } } }))
          return
        }
        if (payload.model === 'PPOCR-v5-Server') {
          if (failOCR) { res.writeHead(503); res.end('{}'); return }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result: { lines: [{ text: '识别出的画面文字' }] } }))
          return
        }
        if (payload.model !== 'MiniMax-H3' && payload.task !== 't2i') {
          if (failNextChat) { failNextChat = false; res.writeHead(503); res.end('{}'); return }
          if (payload.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '真实模型回答' } }] })}\n\n`)
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
      res.end(JSON.stringify({ result: failureJobs.has(jobId) ? { status: 'failed', message: 'test failure' } : cancelledJobs.has(jobId) ? { status: 'cancelled' } : heldJobs.has(jobId) ? { status: 'running' } : { status: 'succeeded', resultUrl: imageJobs.has(jobId) ? '/input.jpg' : '/fixture.mp4' } }))
    } else if (req.url === '/input.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' })
      fs.createReadStream(path.join(uploads, 'input.jpg')).pipe(res)
    } else if (req.url === '/fixture.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      fs.createReadStream(fixture).pipe(res)
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
  assert.match(completed.result.analysis.limitation, /未理解/)
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
  const { burnSubtitles, splitScript } = await import('../src/services/subtitleBurn.js')
  const short = splitScript('第一句，第二句，第三句，第四句，第五句。', 1)
  assert.ok(short.every((segment) => segment.end > segment.start && segment.end <= 1))
  const enabled = await burnSubtitles('/uploads/fixture.mp4', { text: '这是一段字幕测试。', style: 'pure' })
  assert.equal(enabled.subtitleBurned, true)
  assert.ok((await media.probeMedia(media.localMediaPath(enabled.url))).duration > 8)
  const disabled = await burnSubtitles('/uploads/fixture.mp4', { text: '不应显示字幕', burn: false })
  assert.equal(disabled.subtitleBurned, false)
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
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('private image','image','/uploads/private-other.jpg',?)").run(outsider)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('image','image','/uploads/input.jpg',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('transparent product','image','/uploads/fixture-transparent.png',?)").run(owner)
  assert.equal(fs.existsSync(media.localMediaPath('/uploads/input.jpg')), true)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('video','video','/uploads/fixture.mp4',?)").run(owner)
  db.prepare("INSERT INTO materials (name,type,url,owner_id) VALUES ('audio video','video','/uploads/with-audio.mp4',?)").run(owner)
  const scriptId = db.prepare("INSERT INTO scripts (title, content, owner_id) VALUES ('test','original',?)").run(owner).lastInsertRowid
  db.prepare("INSERT INTO script_subitems (script_id,scene_no,scene_desc,line,duration,sort) VALUES (?,1,'用户原有分镜','原有台词',5,0)").run(scriptId)
  const portProbe = net.createServer()
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  const port = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['src/index.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), AI_REAL_ENABLED: 'true', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
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
    const post = async (url, body) => (await fetch(`${base}/api${url}`, { method: 'POST', headers, body: JSON.stringify(body) })).json()
    const legacyTask = await (await fetch(`${base}/api/task/detail?id=${legacyId}`, { headers })).json()
    assert.match(legacyTask.data.result.warnings.join('；'), /模拟结果/)
    const conversation = await post('/conversations', { title: 'test', skill: 'script' })
    assert.equal(conversation.code, 0)
    const chat = await (await fetch(`${base}/api/conversations/chat?conversationId=${conversation.data.id}&message=test`, { headers })).text()
    assert.match(chat, /event: message.done/)
    assert.match(chat, /真实模型回答/)
    const images = await (await fetch(`${base}/api/material/list?type=image`, { headers })).json()
    assert.ok(images.data.list.some((entry) => entry.url === '/uploads/input.jpg'), JSON.stringify(images))
    assert.equal((await post('/super/resolution/create/new', { sourceUrl: '/uploads/fixture.mp4' })).code, 503)
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
    const foreignVoice = db.prepare('SELECT id FROM voice_profiles WHERE owner_id != ? LIMIT 1').get(owner)
    if (foreignVoice) assert.equal((await post('/create/human', { text: '测试', voiceProfileId: foreignVoice.id })).code, 400)
    assert.equal((await post('/create/human', { text: '测试', voice: 1 })).code, 400)
    const human = await post('/create/human', { text: '测试配音', firstFrame: '/uploads/input.jpg', voiceProfileId: voiceRes.data.id, subtitle: { enabled: true } })
    assert.equal(human.code, 0, human.message)
    const humanTask = await waitTask(human.data.id)
    assert.equal(humanTask.result.voice.dubbed, true)
    const dubbed = await post('/voice/dub', { videoUrl: '/uploads/fixture.mp4', voiceId: voiceRes.data.id, text: '测试配音', mode: 'replace', speed: 1, lang: 'zh', subtitle: true })
    assert.equal(dubbed.code, 0)
    const dubTask = await waitTask(dubbed.data.id)
    assert.equal((await fetch(`${base}${dubTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
    const analyzed = await post('/video-analysis/create', { videoUrl: '/uploads/with-audio.mp4' })
    assert.equal(analyzed.code, 0, analyzed.message)
    const analysisTask = await waitTask(analyzed.data.id)
    assert.equal(analysisTask.result.analysis.transcript, '识别出的语音')
    const balanceBeforeStudio = db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points
    const rejectedStudio = await post('/create/studio', { imageUrl: '/uploads/input.jpg', prompt: '白色影棚', count: 1 })
    assert.equal(rejectedStudio.code, 400)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeStudio)
    const studio = await post('/create/studio', { imageUrl: '/uploads/fixture-transparent.png', prompt: '白色影棚', count: 1 })
    assert.equal(studio.code, 0, studio.message)
    const studioTask = await waitTask(studio.data.id)
    assert.equal(studioTask.result.images[0].resolution, '1024x1024')
    assert.match(studioTask.result.warnings.join('；'), /不支持自动抠图/)
    assert.equal((await fetch(`${base}${studioTask.result.images[0].url}`, { headers: { Cookie: cookie } })).status, 200)
    assert.equal(db.prepare('SELECT ai_points FROM users WHERE id = ?').get(owner).ai_points, balanceBeforeStudio - 30)
    const rejectedReplica = await post('/create/replica', { videoUrl: '/uploads/with-audio.mp4', firstFrame: '/uploads/private-other.jpg', prompt: '介绍商品', duration: 4 })
    assert.equal(rejectedReplica.code, 400)
    const replica = await post('/create/replica', { videoUrl: '/uploads/with-audio.mp4', firstFrame: '/uploads/input.jpg', prompt: '介绍我的商品', duration: 4, ratio: '9:16', resolution: '540P', count: 1 })
    assert.equal(replica.code, 0, replica.message)
    const replicaTask = await waitTask(replica.data.id)
    assert.equal(replicaTask.result.reference.transcript, '识别出的语音')
    assert.equal(replicaTask.params.referenceAnalysis.transcript, '识别出的语音')
    assert.match(replicaTask.result.warnings.join('；'), /未理解或复制画面/)
    assert.match(JSON.stringify(submissions.at(-1).body), /识别出的语音/)
    assert.equal((await fetch(`${base}${replicaTask.result.videos[0].url}`, { headers: { Cookie: cookie, Range: 'bytes=0-100' } })).status, 206)
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }
})
