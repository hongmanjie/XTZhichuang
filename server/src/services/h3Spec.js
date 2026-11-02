// ModelGate H3 contract: size is [height, width] and only these frame counts are accepted.
// 官方约束：17n+5，对齐后须在 124–362 之间。
// 双卡实测上限：540P 311 帧通过、345 帧 OOM；720P 175 帧通过、192 帧 OOM。
export const H3_FRAME_COUNTS = Object.freeze([
  124, 141, 158, 175, 192, 209, 226, 243, 260, 277, 294, 311, 328, 345, 362,
])
// 各清晰度允许提交的最大帧数，超过会在提交前被拦下，避免白跑几分钟后 OOM。
export const H3_MAX_FRAMES_BY_SIZE = Object.freeze({ large: 175, small: 311 })
export const H3_FPS = 24

export function h3FramesForDuration(seconds) {
  const duration = Number(seconds)
  if (!Number.isFinite(duration) || duration <= 0 || duration > H3_FRAME_COUNTS.at(-1) / H3_FPS) {
    throw new Error('单段视频时长超出当前模型支持范围')
  }
  return H3_FRAME_COUNTS.find((frames) => frames / H3_FPS >= duration) || H3_FRAME_COUNTS.at(-1)
}

export function validateH3Frames(frames) {
  const value = Number(frames)
  if (!H3_FRAME_COUNTS.includes(value)) throw new Error('视频帧数不符合当前模型约束')
  return value
}

// 每段实际要请求的帧数。只按秒数向上取整会让每段都多出 0.1–0.4 秒，
// 累到 8 段能多出两三秒；这里按“剩余目标均分”分配，让总长贴近用户选的时长。
export function planSegmentFrames(durations, resolution = '540P') {
  const list = Array.isArray(durations) ? durations.map(Number).filter((v) => Number.isFinite(v) && v > 0) : []
  if (!list.length) throw new Error('分段时长不能为空')
  const cap = h3FramesForDuration(resolution === '720P' ? 7 : 11)
  const target = Math.round(list.reduce((sum, v) => sum + v, 0) * H3_FPS)
  const frames = []
  let used = 0
  for (let i = 0; i < list.length; i += 1) {
    const remainTarget = Math.max(1, target - used)
    const remainCount = list.length - i
    const shareSeconds = remainTarget / remainCount / H3_FPS
    const picked = Math.min(cap, h3FramesForDuration(shareSeconds))
    frames.push(picked)
    used += picked
  }
  return frames
}

export function h3Size(ratio, quality = '720P') {
  const sizes = {
    '540P': { '9:16': [960, 544], '16:9': [544, 960], '1:1': [544, 544] },
    '720P': { '9:16': [1280, 736], '16:9': [736, 1280], '1:1': [736, 736] },
  }
  const result = sizes[quality]?.[ratio]
  if (!result) throw new Error('不支持的画幅或清晰度')
  return [...result]
}

export function validateH3Size(size) {
  if (!Array.isArray(size) || size.length !== 2 || size.some((v) => !Number.isInteger(v) || v < 256 || v > 2048 || v % 32 !== 0)) {
    throw new Error('视频宽高必须在 256–2048 之间，且为 32 的倍数')
  }
  return [...size]
}
