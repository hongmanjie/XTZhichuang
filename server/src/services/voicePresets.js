// 系统内置音色：直接使用 TTS 服务里已注册的发音人，用户无需上传参考音频。
// 对外用负数 id 暴露，避免与 voice_profiles 表的自增主键冲突。
// gender 与 isDefault 依据参考音频实测基频与业务约定确定，默认女声用治愈博主、
// 男声用活力讲师；改动顺序不会影响已保存的任务，因为 id 仍按本数组下标计算。
export const VOICE_PRESETS = Object.freeze([
  { providerName: 'chinese_zhiyu_bozhu', label: '治愈博主', gender: 'female', scene: '种草口播', isDefault: true },
  { providerName: 'chinese_rexin_nvhai', label: '热心女孩', gender: 'female', scene: '亲切推荐' },
  { providerName: 'chinese_wennuan_guimi', label: '温暖闺蜜', gender: 'female', scene: '日常分享' },
  { providerName: 'chinese_huoli_jiangshi', label: '活力讲师', gender: 'male', scene: '带货讲解', isDefault: true },
  { providerName: 'chinese_wenrun_nansheng', label: '温润男声', gender: 'male', scene: '舒缓叙述' },
  { providerName: 'chinese_shulang_nansheng', label: '舒朗男声', gender: 'male', scene: '清爽口播' },
  { providerName: 'chinese_chenwen_gaoguan', label: '沉稳高管', gender: 'male', scene: '品牌介绍' },
  { providerName: 'chinese_nanfang_xiaoge', label: '南方小哥', gender: 'male', scene: '生活化推荐' },
])

export function presetVoiceId(index) {
  return -(Number(index) + 1)
}

export function presetByVoiceId(voiceId) {
  const id = Number(voiceId)
  if (!Number.isSafeInteger(id) || id >= 0) return null
  return VOICE_PRESETS[-id - 1] || null
}

// 默认音色：女声治愈博主、男声活力讲师。找不到时退回第一个可用的同性别音色。
export function defaultPresetVoice(gender = 'female') {
  const index = VOICE_PRESETS.findIndex((preset) => preset.isDefault && preset.gender === gender)
  return index >= 0 ? VOICE_PRESETS[index] : VOICE_PRESETS.find((preset) => preset.gender === gender) || null
}

// 列表顺序：两个默认音色置顶，其余按女声、男声分组，方便页面直接分组渲染。
export function listPresetVoices() {
  const items = VOICE_PRESETS.map((preset, index) => ({
    id: presetVoiceId(index),
    name: `内置 · ${preset.label}`,
    label: preset.label,
    gender: preset.gender,
    scene: preset.scene,
    isDefault: Boolean(preset.isDefault),
    system: true,
  }))
  const rank = (item) => (item.isDefault ? 0 : 1) * 2 + (item.gender === 'female' ? 0 : 1)
  return items.sort((a, b) => rank(a) - rank(b))
}
