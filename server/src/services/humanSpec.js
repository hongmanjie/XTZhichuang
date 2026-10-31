export const HUMAN_MAX_TEXT_LENGTH = 200
export const HUMAN_CHARS_PER_RESERVED_SEGMENT = 35
export const HUMAN_720_CHARS_PER_RESERVED_SEGMENT = 18
export const HUMAN_POINTS_PER_SEGMENT = 70
export const HUMAN_MAX_SEGMENT_FRAMES = 226
export const HUMAN_720_MAX_SEGMENT_FRAMES = 124
export const HUMAN_FPS = 24

export function humanReservedSegments(text, resolution = '540P') {
  const count = String(text || '').replace(/\s+/g, '').length
  const perSegment = resolution === '720P' ? HUMAN_720_CHARS_PER_RESERVED_SEGMENT : HUMAN_CHARS_PER_RESERVED_SEGMENT
  return Math.max(1, Math.ceil(count / perSegment))
}

export function humanHasUnsafeLegacy720Plan(resolution, segments) {
  if (resolution !== '720P' || !Array.isArray(segments)) return false
  return segments.some((row) => row.status === 'pending' && !row.provider_task_id && Number(row.duration) > HUMAN_720_MAX_SEGMENT_FRAMES / HUMAN_FPS)
}

export function humanPlanFromSpeech(duration, reservedSegments, resolution = '540P') {
  const seconds = Number(duration)
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(reservedSegments) || reservedSegments < 1) throw new Error('配音时长无效')
  const total = Math.max(124, Math.ceil((seconds + 0.5) * HUMAN_FPS))
  // 720P at longer frame counts exhausted GPU memory in a real H3 run.
  // Keep each 720P generation at the model's verified 124-frame minimum.
  const maxFrames = resolution === '720P' ? HUMAN_720_MAX_SEGMENT_FRAMES : HUMAN_MAX_SEGMENT_FRAMES
  const count = Math.ceil(total / maxFrames)
  if (count > reservedSegments) throw new Error(`配音约 ${seconds.toFixed(1)} 秒，超过当前文案的预留视频时长，请缩短文案后重试`)
  const base = Math.floor(total / count)
  const extra = total % count
  return Array.from({ length: count }, (_, index) => (base + Number(index < extra)) / HUMAN_FPS)
}
