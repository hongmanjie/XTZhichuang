// ============ H3 官方提示词技能（内置版，107 适配） ============
// 来源：MiniMax-AI/MiniMax-H3 官方 skills/h3-prompt-writing（SKILL.md + base-en.txt）。
// 纯规则模块：不发起网络请求。107 的 buildMiniMaxPrompt 使用官方文本三段式，
// 首行对齐指令也按文本格式拼在 integrated_multimodal_description 之前。

const CATEGORY_KEYWORDS = {
  beauty: ['口红', '唇膏', '唇釉', '粉底', '面霜', '乳液', '精华', '护肤', '化妆', '眼影', '香水', '美妆', '腮红', '眉笔', 'makeup', 'lipstick', 'foundation', 'skincare', 'cosmetic', 'perfume', 'serum'],
  food: ['咖啡', '奶茶', '面包', '蛋糕', '零食', '火锅', '烹饪', '美食', '饮料', '果汁', '巧克力', '甜品', '烧烤', 'food', 'coffee', 'milk tea', 'snack', 'juice', 'chocolate', 'dessert', 'cooking', 'beverage'],
  fashion: ['服装', '衬衫', 'T恤', '裙子', '连衣裙', '鞋', '球鞋', '包包', '穿搭', '时装', '面料', '外套', 'clothing', 'dress', 'shirt', 'shoes', 'sneaker', 'bag', 'fashion', 'outfit', 'jacket'],
  home: ['家居', '沙发', '桌', '椅', '床品', '收纳', '厨具', '灯具', '家电', '冰箱', '洗衣机', '空气炸锅', '毛巾', 'home', 'furniture', 'sofa', 'lamp', 'appliance', 'kitchenware', 'storage'],
  digital: ['手机', '电脑', '笔记本', '耳机', '相机', '音箱', '手表', '充电', '蓝牙', '智能', '无人机', '平板', 'phone', 'laptop', 'earphone', 'headphone', 'camera', 'watch', 'smart', 'gadget', 'charger', 'drone'],
}

export function detectCategory(text) {
  const source = String(text || '').toLowerCase()
  let best = 'general'
  let bestHits = 0
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = words.reduce((count, word) => count + (source.includes(word.toLowerCase()) ? 1 : 0), 0)
    if (hits > bestHits) { best = category; bestHits = hits }
  }
  return best
}

// 广告分镜模板（首批三套；弱输入时作结构参考，强输入以用户描述为准）
export const AD_TEMPLATES = {
  beauty: {
    key: 'beauty', name: '美妆快切', category: 'beauty',
    shots: [
      { seconds: 2.5, goal: '静物开场：产品在场景中，一道光扫过表面' },
      { seconds: 2, goal: '质地微距：膏体/液体/瓶身细节特写，动作轻但可见' },
      { seconds: 3, goal: '使用或收尾：上脸/上手或产品归位，回到英雄构图' },
    ],
    pacing: '每镜 2-3 秒快切，第一镜不出现人脸，最后一镜稳定收尾',
    avoid: '画面文字、Logo 变形、产品形状改变、多余道具、镜头内出现两支产品',
  },
  food: {
    key: 'food', name: '食品食欲', category: 'food',
    shots: [
      { seconds: 2, goal: '食欲开场：热气/冷凝水/油脂光泽的微距' },
      { seconds: 3, goal: '动作镜头：倾倒/夹取/咬下，材质与声音同步' },
      { seconds: 3, goal: '包装或用餐收尾：产品与场景同框，构图稳定' },
    ],
    pacing: '每镜 2-3 秒，动作要在一镜内完成，强调可听见的质感',
    avoid: '液体物理失真、食物形态崩坏、多余手部、画面文字',
  },
  home: {
    key: 'home', name: '家居场景', category: 'home',
    shots: [
      { seconds: 3, goal: '场景建立：家居环境全景，产品置于真实使用位置' },
      { seconds: 3, goal: '使用细节：手部操作/功能演示，特写可见' },
      { seconds: 2, goal: '氛围收尾：回归全景，光线自然，构图稳定' },
    ],
    pacing: '每镜 2-3 秒，运镜平稳，避免快切',
    avoid: '比例失真、产品变形、穿模、画面文字、多余家具',
  },
}

export function templateForCategory(category) {
  return Object.values(AD_TEMPLATES).find((tpl) => tpl.category === category) || null
}

// 官方首行对齐指令（base-en.txt §2.1）：i2av/fl2av/l2av 的 prompt 首行必须是它。
// 返回带空行的前缀；t2av 返回空串。
function lastShotIndex(prompt) {
  let last = 1
  for (const match of String(prompt || '').matchAll(/\[Shot (\d+)\]/g)) {
    const index = Number(match[1])
    if (Number.isInteger(index) && index > last) last = index
  }
  return last
}

export function h3AlignmentInstruction(task, prompt, numFrames = 124) {
  const sec = (Number(numFrames) / 24).toFixed(2)
  if (task === 'i2av') {
    return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n'
  }
  if (task === 'fl2av') {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${lastShotIndex(prompt)}) aligns with the ${sec}-second mark of the target video.\n\n`
  }
  if (task === 'l2av') {
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${lastShotIndex(prompt)}]) aligns with the ${sec}-second mark of the target video.\n\n`
  }
  return ''
}

const H3_STYLE_RULES = `You are an expert prompt writer for the MiniMax H3 audio-video model. Rewrite the user's idea into an H3 structured prompt. Follow these official rules exactly:

STRUCTURE
- integrated_multimodal_description: the visual timeline. Start [Shot 1] with overall style (e.g. "Live-action, cinematic") and the opening composition; do NOT put a timestamp on Shot 1. Every later shot starts with a strictly increasing cut time inside the video duration, e.g. "[Shot 2] At 00:03.500, the camera cuts to ...". Cut verbs: "the camera cuts to / the shot cuts to / the shot transitions to". If only distance or a slight angle changes, prefer camera motion (e.g. "The camera pushes in with small amplitude at slow speed") instead of a cut.
- overall_soundscape: 1-4 English sentences, one paragraph: ambient sound, physical action sounds, non-verbal human sounds across the whole video. Never repeat dialogue or music here.
- non_diegetic_music: 1-3 English sentences: instrumentation, tempo, rhythm, dynamic changes. No abstract mood words like "beautiful" or "cinematic".

KEYFRAME MODES
- With only a first frame: Picture 1 is the actual first frame and belongs to [Shot 1]. Anchor style, subjects, composition, clothing, key objects and spatial layout of the image first, then develop forward: first-frame anchor -> action onset -> continuous development -> result or reaction. Keep identity and layout consistent.
- With both first and last frames: describe ONE continuous single shot that travels from the first-frame state to the last-frame state: first-frame state -> observable intermediate changes -> progressively narrowing differences -> last-frame landing. Explicitly settle into the exact pose, spacing and composition of the last frame at the end. Multi-shot only if the user explicitly demands it.
- With only a last frame: infer a plausible preceding state, then converge onto the last frame in the final shot.

GENERAL RULES
- Total described timeline MUST match the requested duration. Place cut times accordingly.
- Write in English; keep any dialogue as <d>[Chinese] 原文</d> (original language), and keep visible scene text verbatim in double quotes.
- Concrete visual and audio details only; never use vague words like "cinematic" or "beautiful" alone.
- No on-screen subtitles, captions, watermarks or logos unless the user explicitly writes them.
- E-commerce realism: real photography texture, physically plausible product handling, product appearance must stay consistent in every shot.

INPUT QUALITY ROUTING (decide yourself)
- quality "detailed": the user's idea already specifies subjects, actions, shot changes and pacing. Then PRESERVE the user's structure and intent as-is: translate/polish into the official format, fix cut times to the duration, and only supply missing soundscape/music. Do not invent new shots.
- quality "vague": the idea is a single sentence or lacks shot/action design. Then build the shot structure yourself using typical e-commerce pacing for the detected category (beauty: 3 quick shots of 2-3 seconds each; food: appetite close-ups; fashion: try-on rhythm; home: usage scene; digital: feature close-ups), keeping the user's product and scene intent as the core.

CATEGORY: choose one of beauty / food / fashion / home / digital / general by the product in the idea.

Respond with ONLY a JSON object, no markdown fence, no extra text:
{"quality":"vague|detailed","category":"beauty|food|fashion|home|digital|general","integrated_multimodal_description":"...","overall_soundscape":"...","non_diegetic_music":"..."}`

export function buildSkillMessages({ input, hasFirst = false, hasLast = false, durationSec = 8, direction } = {}) {
  const mode = hasFirst && hasLast ? 'first+last frame (FL2VA)' : hasFirst ? 'first frame only (I2VA)' : hasLast ? 'last frame only (L2VA)' : 'text only (T2VA)'
  const refNote = hasFirst && hasLast
    ? 'Two keyframes are provided: Picture 1 = first frame, Picture 2 = last frame. Write the single-shot continuous path between them.'
    : hasFirst
      ? 'A first frame is provided: anchor [Shot 1] on it, then develop forward.'
      : hasLast
        ? 'A last frame is provided: converge onto it in the final shot.'
        : 'No keyframes: build the full timeline from text.'
  const template = direction ? AD_TEMPLATES[direction] : templateForCategory(detectCategory(input))
  const templateNote = template
    ? `\nReference ad structure for this category (use it ONLY when the input is vague; adapt shot count to the target duration, never exceed it):\n${template.shots.map((shot, i) => `[Shot ${i + 1}] ~${shot.seconds}s — ${shot.goal}`).join('\n')}\nPacing: ${template.pacing}. Forbidden: ${template.avoid}.`
    : ''
  return [
    { role: 'system', content: H3_STYLE_RULES },
    { role: 'user', content: `Target video duration: ${durationSec} seconds (format cut times and the ending to fit this duration).\nInput mode: ${mode}. ${refNote}${templateNote}\nUser idea: ${String(input || '').trim() || '自由发挥一段有创意的商品短视频'}` },
  ]
}

export function parseSkillOutput(raw) {
  const cleaned = String(raw || '').replace(/```(?:json)?|```/g, '').trim()
  const matched = cleaned.match(/\{[\s\S]*\}/)
  if (!matched) return null
  try {
    const parsed = JSON.parse(matched[0])
    const desc = typeof parsed.integrated_multimodal_description === 'string' ? parsed.integrated_multimodal_description.trim() : ''
    const soundscape = typeof parsed.overall_soundscape === 'string' ? parsed.overall_soundscape.trim() : ''
    const music = typeof parsed.non_diegetic_music === 'string' ? parsed.non_diegetic_music.trim() : ''
    if (!desc || !soundscape || !music) return null
    return {
      quality: parsed.quality === 'detailed' ? 'detailed' : 'vague',
      category: ['beauty', 'food', 'fashion', 'home', 'digital', 'general'].includes(parsed.category) ? parsed.category : 'general',
      integrated_multimodal_description: desc,
      overall_soundscape: soundscape,
      non_diegetic_music: music,
    }
  } catch {
    return null
  }
}

// 数字人表演导演：只产出"表演要求"，由调用方拼到既有 prompt 后面，避免丢失
// 商品/场景/NO_TEXT 等既有约束（107 的 buildHumanScenePrompt 已包含这些）。
const HUMAN_PERFORMANCE_RULES = `你是数字人口播视频的表演导演。根据口播文案，只输出一段"表演要求"，不要解释、不要列表、不要引号。要求：
- 描述表情变化、眼神、手势幅度与节奏、说话语速与停顿，必须贴合文案情绪：促销话术更有力和上扬，知识讲解更平稳克制，种草分享更亲近自然。
- 只写表演层面的指令，不要重复场景、外形或商品描述，不要编造功效、价格、销量或认证。
- 不要出现画面文字、字幕、水印。
- 80-160 字中文。`

export function buildHumanPerformanceMessages({ text } = {}) {
  return [
    { role: 'system', content: HUMAN_PERFORMANCE_RULES },
    { role: 'user', content: `口播文案：${String(text || '').slice(0, 300)}` },
  ]
}

export function parseHumanOutput(raw) {
  const text = String(raw || '').replace(/^["'“]|["'”]$/g, '').trim()
  if (!text || text.length < 20) return null
  if (/^[{[]/.test(text)) return null
  if (!/[\u4e00-\u9fa5]/.test(text)) return null
  return { description: text.slice(0, 300) }
}
