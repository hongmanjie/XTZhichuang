// Keep natural punctuation boundaries while bounding each TTS request.
export function splitHumanSpeech(input, maxChars = 45) {
  const text = String(input || '')
  if (!text.trim() || !Number.isInteger(maxChars) || maxChars < 8) throw new Error('配音文案无效')
  const clauses = text.match(/[^，。！？；、,.!?;]+[，。！？；、,.!?;]*|[，。！？；、,.!?;]+/gu) || [text]
  const parts = []
  for (const clause of clauses) {
    const chars = Array.from(clause)
    while (chars.length) {
      const previous = parts.at(-1) || ''
      const room = maxChars - Array.from(previous).length
      if (previous && chars.length <= room) {
        parts[parts.length - 1] += chars.splice(0).join('')
      } else {
        parts.push(chars.splice(0, maxChars).join(''))
      }
    }
  }
  if (parts.join('') !== text || parts.some((part) => !part.trim())) throw new Error('无法安全拆分配音文案')
  return parts
}
