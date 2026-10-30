// ModelGate H3 contract: size is [height, width] and only these frame counts are accepted.
export const H3_FRAME_COUNTS = Object.freeze([124, 141, 158, 175, 192, 209, 226])
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
