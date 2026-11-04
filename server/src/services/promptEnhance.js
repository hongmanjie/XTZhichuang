import { chat } from './aiProviders.js'

// 官方与社区验证过的镜头语言词表。LLM 只允许从这些里选，避免它自由发挥。
const CAMERA_MOVES = 'Static Shot, Push In, Pull Out, Pan Left/Right, Truck Left/Right, Tilt Up/Down, Tracking Shot, Handheld, Turntable, Arc Shot'
const LENSES = '26mm wide (selfie/vlog), 35mm (street), 50mm (portrait), 85mm macro (product detail), 100mm macro (texture)'

const SYSTEM = `你是短视频提示词工程师，把中文需求改写成英文的单镜头视觉描述，供 MiniMax-H3 生成画面。

硬规则：
1. 保留用户描述的全部主体、动作和场景信息，不得增删卖点。
2. 必须明确给出：镜头运动、焦段、光线方向与质感、景深。镜头运动只能从这些里选：${CAMERA_MOVES}。焦段只能从这些里选：${LENSES}。
3. 写成一段连续的英文，不要分点、不要小标题、不要引号。
4. 不要使用 cinematic、beautiful、stunning、epic 这类空泛形容词，改成具体的视觉事实。
5. 不要写"no text"之外的否定句，不要罗列不要什么。
6. 不要出现品牌名、价格、功效宣称。
7. 只有一个镜头，不要写 [Shot 2] 或时间戳。
8. 长度控制在 60–110 个英文单词。
9. 只输出这段英文描述本身，不要任何解释。`

const KIND_HINT = {
  product: '这是商品展示镜头。强调材质、纹理、结构细节和高光走向，主体占据画面主要位置，背景干净。',
  human: '这是人物出镜镜头。人物半身或中景，面部占画面高度四分之一到三分之一，皮肤保留真实纹理和毛孔，不要磨皮，光线有方向感而不是平光。',
  scene: '这是场景/氛围空镜。强调空间纵深、环境细节和自然光变化，不要出现人物面部特写。',
  general: '这是通用镜头。按用户描述的主体选择合适的景别和机位。',
}

export async function enhanceVisualPrompt(userPrompt, { kind = 'general', ratio = '9:16', seconds = 5 } = {}) {
  const text = String(userPrompt || '').trim()
  if (!text) return text
  // 已经是英文长描述时不再改写，避免二次失真
  const ascii = (text.match(/[a-zA-Z]/g) || []).length
  if (ascii > text.length * 0.6 && text.split(/\s+/).length > 40) return text
  const frame = ratio === '9:16' ? 'vertical 9:16' : ratio === '16:9' ? 'horizontal 16:9' : 'square 1:1'
  try {
    const answer = await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${KIND_HINT[kind] || KIND_HINT.general}\n画幅：${frame}，时长约 ${seconds} 秒。\n用户需求：${text}` },
    ], { temperature: 0.35, max_tokens: 420 })
    const cleaned = String(answer || '')
      .replace(/```[a-z]*|```/g, '')
      .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    // 明显不合法（太短、包含中文、含时间戳）就退回原描述
    if (cleaned.length < 40 || /[\u4e00-\u9fa5]/.test(cleaned) || /\[Shot\s*2\]/i.test(cleaned)) return text
    return cleaned.slice(0, 900)
  } catch {
    return text
  }
}

export function inferPromptKind(prompt = '') {
  const s = String(prompt)
  if (/主播|人物|口播|她说|讲述|出镜/.test(s)) return 'human'
  if (/商品|产品|杯|瓶|包|鞋|口红|精华|细节|材质|转台/.test(s)) return 'product'
  if (/街|景|空镜|氛围|城市|山|海|雨|夜|店内|咖啡厅/.test(s)) return 'scene'
  return 'general'
}
