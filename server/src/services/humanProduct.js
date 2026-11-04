import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import db from '../db.js'
import { mgImageFuse, mgImageGen } from './aiProviders.js'
import { buildProductScene } from './productScene.js'
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
  // 新链路：直接让图像模型把商品画进“主播 + 桌面”的画面里。
  // 旧的抠图 + 贴图 + 融合会保留商品原图的平光，商品像悬在人物胸前的一张图。
  if (process.env.HUMAN_ANCHOR_MODE !== 'composite') {
    try {
      const built = await buildProductScene({
        imageUrl: params.productImage,
        prompt,
        ratio: '9:16',
        resolution: params.resolution || '540P',
        taskId: context.taskId,
        onStage: context.onStage,
        mode: 'human',
      })
      if (built?.url) {
        db.prepare("UPDATE human_product_workflows SET status='ready',first_frame_url=? WHERE task_id=?").run(built.url, context.taskId)
        return { url: built.url, usedProduct: true, fused: true, mode: 'direct-scene' }
      }
    } catch (error) {
      console.warn('[humanProduct] 直绘首帧失败，回退到贴图合成:', String(error.message || error).slice(0, 160))
    }
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
        // 之前只写“留出放置商品的空间”，模型会画成人物半身特写，
        // 下方是衣服而不是桌面，商品贴上去就成了悬空。
        // 这里必须把“前景桌面”写成硬要求，并给出占比。
        prompt: `真实摄影风格人物口播视频的第一帧：${gender}${personPrompt}。`
          + '人物坐在桌前，正面自然望向镜头，半身构图。'
          // 只写“下方三分之一”，实测模型只给了一条桌沿，杯子会悬在桌外。
          + '前景是一张木质桌面，从画面底边一直延伸到人物腰部，占画面高度至少三成，'
          + '桌面有明确透视：靠近镜头的一端更宽、远处更窄，桌面上有自然的木纹和柔和反光。'
          + '柔和均匀的自然光，明暗过渡平缓，不要强烈侧光或硬阴影，桌面有轻微反光和景深。'
          + '不要画任何商品、杯子、瓶子、字幕、标题、标识或水印。',
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
  // 商品要落在桌面上，不能贴画面底边：底边留 13% 作为桌面厚度，
  // 高度收窄到 20% 保证完整不裁，宽度 34% 避免压住人物。
  const maxW = Math.floor(width * 0.26 / 2) * 2
  const maxH = Math.floor(height * 0.16 / 2) * 2
  const bottom = Math.floor(height * 0.17)
  // 抠图直接 overlay 会像贴纸：边缘是剪刀口、清晰度高于背景、亮度也不匹配。
  // 这里做三件事：轻微模糊模拟同景深、羽化 alpha 让边缘融进背景、压一点亮度让它落进环境光。
  const productChain = `[1:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},`
    + `scale=${maxW}:${maxH}:force_original_aspect_ratio=decrease,format=rgba,`
    + 'eq=brightness=-0.03:contrast=1.04:saturation=0.94,gblur=sigma=1.2:steps=2[product]'
  const shadowW = Math.max(2, Math.floor(maxW * 0.92))
  const shadowH = Math.max(2, Math.floor(maxH * 0.16))
  const productX = `(W-w)/2`
  const productY = `H-h-${bottom}`
  const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[bg];`
    + productChain + ';'
    // 接触阴影：用商品 alpha 压扁 + 模糊 + 压暗，垫在商品底部下方，制造“落在桌面上”的接触感
    + '[product]split[p1][ps];'
    + `[ps]alphaextract,scale=${shadowW}:${shadowH},gblur=sigma=10,colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55[sh];`
    + `[bg][sh]overlay=${productX}:${productY}+${Math.floor(maxH * 0.86)}:format=auto[bg2];`
    + `[bg2][p1]overlay=${productX}:${productY}:format=auto,format=rgb24[out]`
  try {
    await runMedia(FFMPEG, ['-y','-filter_complex_threads','1','-i',localMediaPath(background),'-i',inspected.file,
      '-filter_complex',filter,'-map','[out]','-frames:v','1','-c:v','png','-threads','1','-update','1',file], 120000)
    const info = await probeImage(file)
    if (info.width !== width || info.height !== height) throw new Error('合成的首帧尺寸无效')

    // 贴图合成的商品和场景不共享光照，看起来像贴纸。这里交给图像模型整图重画一遍：
    // 商品保留，接触阴影、反光和景深由模型重新建立。
    let finalUrl = url
    let fused = false
    if (process.env.PRODUCT_FUSE !== 'off') {
      context.onStage('正在让商品融入场景')
      try {
        const out = await mgImageFuse({
          imageUrl: url,
          // 整图重绘会连脸一起重画，必须显式锁人物；另外模型会把商品规格画成画面文字，
          // 实测出现过“这是第1段 350ml”这类伪字幕。
          prompt: '严格保持人物的面部特征、发型、肤色、服装和姿势完全不变，'
            // 之前写“柔和的接触阴影”，模型会画成一整块暗区，观感很重。
            // 改成“极轻的接触暗部”，并显式禁止明显投影。
            + '只调整桌面上的商品：商品底部与桌面之间只有极轻的接触暗部，'
            + '不要形成明显投影或大片暗块，桌面整体保持明亮，'
            + '商品表面的高光和反光方向与环境光一致但不过曝，'
            + '商品边缘有轻微景深过渡，不出现硬边或描边感。'
            + '商品表面保持干净，不要出现任何文字、数字、字母、规格说明或标识。'
            + '画面中不要出现任何字幕、标题或说明文字。'
            + '整体光影统一，看起来像一次真实拍摄，不要贴图痕迹。',
          size: [height, width],
        })
        const fusedUrl = out.images?.[0]
        if (fusedUrl && existing(fusedUrl)) {
          const fusedInfo = await probeImage(localMediaPath(fusedUrl))
          if (fusedInfo.width === width && fusedInfo.height === height) {
            finalUrl = fusedUrl
            fused = true
          }
        }
      } catch (error) {
        // 融合失败不影响出片，退回贴图版本
        console.warn('[humanProduct] 融合失败，使用贴图首帧:', String(error.message || error).slice(0, 160))
      }
    }

    db.prepare("UPDATE human_product_workflows SET status='ready',first_frame_url=? WHERE task_id=?").run(finalUrl, context.taskId)
    return { url: finalUrl, usedProduct: true, fused }
  } catch (error) {
    try { fs.unlinkSync(file) } catch {}
    throw error
  }
}
