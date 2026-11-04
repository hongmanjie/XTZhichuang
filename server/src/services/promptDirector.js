// ============ 提示词导演层（P0，107 适配） ============
// 生成前自动规整：弱输入按官方规范补结构，强输入按用户的来；
// 技能失败时回退 107 既有的 enhanceVisualPrompt（单镜英文改写），再失败用原描述。
import { chat } from './aiProviders.js'
import { enhanceVisualPrompt, inferPromptKind } from './promptEnhance.js'
import {
  buildSkillMessages, parseSkillOutput, buildHumanPerformanceMessages, parseHumanOutput,
  detectCategory, AD_TEMPLATES,
} from './h3PromptSkill.js'

const DIRECTOR_TIMEOUT_MS = 20000

export async function directMaterialPrompt({ prompt, hasFirst = false, hasLast = false, durationSec = 8, ratio = '9:16', direction } = {}) {
  const raw = String(prompt || '').trim()
  const category = detectCategory(raw)
  if (!raw) return { prompt: raw, soundscape: '', music: '', quality: null, category, source: 'raw' }
  try {
    const text = await chat(buildSkillMessages({ input: raw, hasFirst, hasLast, durationSec, direction }), {
      temperature: 0.6, max_tokens: 1400, timeoutMs: DIRECTOR_TIMEOUT_MS,
    })
    const skill = parseSkillOutput(text)
    if (skill) {
      return {
        prompt: skill.integrated_multimodal_description,
        soundscape: skill.overall_soundscape,
        music: skill.non_diegetic_music,
        quality: skill.quality,
        category: skill.category,
        source: 'skill',
      }
    }
  } catch (error) {
    console.warn(`[导演层] 技能链路失败，回退单镜改写: ${error.message}`)
  }
  try {
    const enhanced = await enhanceVisualPrompt(raw, { kind: inferPromptKind(raw), ratio, seconds: durationSec })
    return { prompt: enhanced, soundscape: '', music: '', quality: null, category, source: enhanced === raw ? 'raw' : 'enhance' }
  } catch {
    return { prompt: raw, soundscape: '', music: '', quality: null, category, source: 'raw' }
  }
}

// 只产出表演要求；失败返回空串，调用方保留原 prompt
export async function directHumanPerformance({ text } = {}) {
  try {
    const raw = await chat(buildHumanPerformanceMessages({ text }), {
      temperature: 0.5, max_tokens: 400, timeoutMs: DIRECTOR_TIMEOUT_MS,
    })
    const parsed = parseHumanOutput(raw)
    return parsed ? parsed.description : ''
  } catch (error) {
    console.warn(`[导演层] 数字人表演要求生成失败，保留原 prompt: ${error.message}`)
    return ''
  }
}

export function listTemplates() {
  return Object.values(AD_TEMPLATES).map((tpl) => ({ key: tpl.key, name: tpl.name, category: tpl.category, shots: tpl.shots.length }))
}
