import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import db from '../db.js'
import { mgImageGen } from './aiProviders.js'
import { cutoutProduct } from './cutout.js'
import { inspectStudioProduct } from './studio.js'
import { FFMPEG, MEDIA_UPLOAD_DIR, localMediaPath, probeImage, runMedia } from './mediaTools.js'
import { h3Size } from './h3Spec.js'
import { presetByVoiceId } from './voicePresets.js'

function existing(url) {
  const file = localMediaPath(url)
  return Boolean(file && fs.existsSync(file))
}

// The two user images become one actual image-conditioned first frame.
// A generated background is used only when the user has not supplied a presenter.
export async function prepareHumanProductFrame(params, context, prompt) {
  if (!params.productImage) return { url: params.firstFrame || null, usedProduct: false }
  let work = db.prepare('SELECT * FROM human_product_workflows WHERE task_id = ?').get(context.taskId)
  if (!work) {
    db.prepare("INSERT INTO human_product_workflows (task_id,status,idempotency_key) VALUES (?,'pending',?)").run(context.taskId, crypto.randomUUID())
    work = db.prepare('SELECT * FROM human_product_workflows WHERE task_id = ?').get(context.taskId)
  }
  if (work.first_frame_url) {
    if (!existing(work.first_frame_url)) throw new Error('已保存的商品首帧不存在，请核对任务')
    return { url: work.first_frame_url, usedProduct: true }
  }
  let background = params.firstFrame || work.background_url
  if (!background) {
    if (work.status === 'background_submitting' && !work.provider_task_id) {
      const e = new Error('人物首帧提交状态未知，请核对后再处理'); e.code = 'MG_SUBMIT_UNCERTAIN'; throw e
    }
    context.onStage('正在准备人物画面')
    db.prepare("UPDATE human_product_workflows SET status = 'background_submitting' WHERE task_id = ?").run(context.taskId)
    let image
    try {
      const [height, width] = h3Size('9:16', params.resolution || '540P')
      const personPrompt = String(prompt || '').replace(/桌面上摆放着[^。]*。?/gu, '')
      const preset = presetByVoiceId(params.voiceProfileId)
      const gender = /女|男/.test(personPrompt) ? '' : preset?.gender === 'female' ? '女性主播。' : preset?.gender === 'male' ? '男性主播。' : ''
      image = await mgImageGen({
        prompt: `真实摄影风格人物口播视频的第一帧：${gender}${personPrompt}。仅生成人物、场景和桌面；画面下方留出放置商品的空间。不要画商品、字幕、标题、标识或水印。人物正面自然望向镜头。`,
        size: [height, width], idempotencyKey: work.idempotency_key, resumeTaskId: work.provider_task_id || null,
        onSubmitted: (id) => db.transaction(() => {
          db.prepare("UPDATE human_product_workflows SET status='background_running', provider_task_id=? WHERE task_id=?").run(id, context.taskId)
          db.prepare("UPDATE ai_tasks SET provider_task_id=?, stage='正在生成人物画面' WHERE id=? AND status='running'").run(id, context.taskId)
        }).immediate(),
      })
      background = image.images?.[0]
      if (!background || !existing(background)) throw new Error('人物首帧生成结果无效')
      db.transaction(() => {
        db.prepare("UPDATE human_product_workflows SET status='background_ready', background_url=? WHERE task_id=?").run(background, context.taskId)
        db.prepare('UPDATE ai_tasks SET provider_task_id=NULL WHERE id=?').run(context.taskId)
      }).immediate()
    } catch (error) {
      if (['MG_CONNECTION_UNAVAILABLE', 'MG_TASK_FAILED', 'MG_TASK_CANCELLED'].includes(error.code)) {
        db.prepare("UPDATE human_product_workflows SET status='pending',provider_task_id=NULL,idempotency_key=? WHERE task_id=?").run(crypto.randomUUID(), context.taskId)
        db.prepare('UPDATE ai_tasks SET provider_task_id=NULL WHERE id=?').run(context.taskId)
      }
      throw error
    }
  }
  if (!existing(background)) throw new Error('人物图片不存在')
  work = db.prepare('SELECT * FROM human_product_workflows WHERE task_id = ?').get(context.taskId)
  let product = params.productImage
  let inspected
  try { inspected = await inspectStudioProduct(product) }
  catch {
    if (work.cutout_url && existing(work.cutout_url)) product = work.cutout_url
    else {
      context.onStage('正在提取商品主体')
      const cutout = await cutoutProduct(params.productImage)
      product = cutout.url
      db.prepare('UPDATE human_product_workflows SET cutout_url=? WHERE task_id=?').run(product, context.taskId)
    }
    inspected = await inspectStudioProduct(product)
  }
  context.onStage('正在合成人物和商品首帧')
  const [height, width] = h3Size('9:16', params.resolution || '540P')
  const crop = inspected.crop
  const file = path.join(MEDIA_UPLOAD_DIR, `human_product_${crypto.randomUUID()}.png`)
  const url = '/uploads/' + path.basename(file)
  const maxW = Math.floor(width * 0.42 / 2) * 2
  const maxH = Math.floor(height * 0.28 / 2) * 2
  const bottom = Math.floor(height * 0.06)
  const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[bg];[1:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${maxW}:${maxH}:force_original_aspect_ratio=decrease,format=rgba[product];[bg][product]overlay=(W-w)/2:H-h-${bottom}:format=auto,format=rgb24[out]`
  try {
    await runMedia(FFMPEG, ['-y','-filter_complex_threads','1','-i',localMediaPath(background),'-i',inspected.file,
      '-filter_complex',filter,'-map','[out]','-frames:v','1','-c:v','png','-threads','1','-update','1',file], 120000)
    const info = await probeImage(file)
    if (info.width !== width || info.height !== height) throw new Error('合成的首帧尺寸无效')
    db.prepare("UPDATE human_product_workflows SET status='ready',first_frame_url=? WHERE task_id=?").run(url, context.taskId)
    return { url, usedProduct: true }
  } catch (error) {
    try { fs.unlinkSync(file) } catch {}
    throw error
  }
}
