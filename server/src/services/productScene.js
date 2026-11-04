import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { mgChat, mgImageFuse } from './aiProviders.js'
import { MEDIA_UPLOAD_DIR, localMediaPath, probeImage } from './mediaTools.js'
import { h3Size } from './h3Spec.js'
import { classifyImageRole } from './visionProvider.js'

function existing(url) {
  const file = localMediaPath(url)
  return Boolean(file && fs.existsSync(file))
}

// 把用户的一句话改写成“商品在场景里”的完整画面描述。
// 只补环境、台面、光线、景别，不改商品本身，也不允许新增商品事实。
async function rewriteAsScene(userPrompt, mode) {
  const fallback = mode === 'human'
    ? '一位年轻的女主播坐在木质桌子后面对镜头自然说话，室内柔和的自然光从右侧窗户照进来，画面下方前景是木质桌面。'
    : '商品放在木质桌面上，右侧窗户的自然光斜射进来，背景是虚化的室内环境，浅景深，真实摄影。'
  try {
    const answer = await mgChat([
      {
        role: 'system',
        content:
          '你是电商视频的画面设计助手。把用户的一句话扩写成一段可直接用于图像生成的画面描述，'
          + '只补充环境、台面、光线方向、景深和构图，不要改变商品本身，不要编造品牌、价格、功效或参数，'
          + '不要出现任何文字。只输出描述本身，不超过 120 个汉字。',
      },
      { role: 'user', content: String(userPrompt || '').slice(0, 600) },
    ], { temperature: 0.4, max_tokens: 400, timeoutMs: 45000 })
    const text = String(answer || '').replace(/\s+/g, ' ').trim()
    return text.length >= 12 ? text.slice(0, 500) : fallback
  } catch {
    return fallback
  }
}

// 基于用户上传的商品图，直接让图像模型重绘出一张“商品在真实场景里”的画面。
// 之前用抠图 + ffmpeg 贴到生成背景上，商品和场景不共享光照，永远是贴纸感；
// 改成整图重绘后，接触阴影、透视和光线由模型一起生成，视觉上才成立。
export async function buildProductScene({
  imageUrl,
  prompt,
  ratio = '9:16',
  resolution = '720P',
  taskId,
  onStage,
  mode = 'product',
  extra = '',
} = {}) {
  if (!imageUrl || !existing(imageUrl)) return null

  let role = 'unknown'
  try { role = await classifyImageRole(imageUrl) } catch { role = 'unknown' }
  // 实拍场景图、人物照不重建，直接用原图当首帧
  if (role !== 'product') return { url: imageUrl, rebuilt: false, role }

  const [height, width] = h3Size(ratio, resolution)
  const cacheName = `anchor_${taskId || crypto.randomUUID()}.png`
  const cacheFile = path.join(MEDIA_UPLOAD_DIR, cacheName)
  if (fs.existsSync(cacheFile)) {
    const info = await probeImage(cacheFile)
    if (info.width === width && info.height === height) {
      return { url: '/uploads/' + cacheName, rebuilt: true, role, cached: true }
    }
  }

  onStage?.(mode === 'human' ? '正在把商品放进主播画面' : '正在把商品放进场景')
  // 数字人传进来的已经是完整的人物场景描述，再让模型改写会丢人设细节，直接用原文
  const scene = mode === 'human' && String(prompt || '').length >= 20
    ? String(prompt).slice(0, 600)
    : await rewriteAsScene(prompt, mode)
  const placement = mode === 'human'
    ? '商品完整地放在画面下方的前景桌面上，位置偏下但不贴画面边缘，杯底与桌面有窄而自然的接触暗部；'
      + '商品宽度不超过画面宽度的三分之一，高度不超过画面高度的四分之一，不要挡住人物面部，'
      + '不要贴在人物身上或悬在半空；人物与商品共享同一套光线，受光方向一致。'
    : '商品自然放在台面上，底部与台面有窄而自然的接触暗部，不要大片暗块；'
      + '受光面朝向光源变亮并带环境色温，背光面自然变暗有层次；台面上有商品极淡的倒影；'
      + '商品边缘有轻微景深过渡，不要硬边、描边或贴图感。'

  const finalPrompt = '把画面中的这只商品放进下面这个场景里，'
    + '严格保持商品本身的形状、比例、材质和颜色不变，不要替换成别的商品：'
    + scene + '。' + placement + extra
    + '画面中不要出现任何文字、数字、字母、标签、水印或角标。真实摄影，光影统一。'

  const out = await mgImageFuse({ imageUrl, prompt: finalPrompt.slice(0, 1100), size: [height, width] })
  const fusedUrl = out?.images?.[0]
  if (!fusedUrl || !existing(fusedUrl)) throw new Error('商品场景图生成结果无效')
  const info = await probeImage(localMediaPath(fusedUrl))
  if (info.width !== width || info.height !== height) throw new Error('商品场景图尺寸无效')
  try { fs.copyFileSync(localMediaPath(fusedUrl), cacheFile) } catch {}
  return { url: fusedUrl, rebuilt: true, role, provider: out.provider }
}
