// AI素材场计价（create.js 与 Agent 一键生成共用）
export const MF_MODELS = [
  { key: 'MiniMax-H3', name: 'MiniMax-H3', badge: '', price: { '540P': 12, '720P': 16 } },
]

export function mfCost(model, resolution, duration) {
  const modelEntry = MF_MODELS.find((x) => x.key === model) || MF_MODELS[0]
  const base = modelEntry.price[resolution] || modelEntry.price['720P']
  return base * (duration > 8 ? Math.ceil(duration / 8) * 2 : duration / 4)
}
