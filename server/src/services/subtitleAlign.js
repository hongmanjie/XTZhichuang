// 用 ASR 的真实停顿把文案切成字幕行。
// 之前按字数把总时长平均切开，语速一变化字幕就跟不上人声；
// 这里用识别出的每个句子起止作为锚点，再把文案按字符位置映射回时间轴。

function clausesOf(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600)
  if (!clean) return []
  const pieces = clean.split(/(?<=[，。！？；、…：,.!?;:])/).map((clause) => clause.trim()).filter(Boolean)
  const merged = []
  for (const piece of pieces) {
    const joinPrev = merged.length && (piece.length < 3 || /^[的了吗呢吧啊呀哦嘛]/.test(piece))
    if (joinPrev) merged[merged.length - 1] += piece
    else merged.push(piece)
  }
  const out = []
  // Bound line length while keeping numbers and their units together where
  // possible, e.g. never split 三百五十毫升 after its first character.
  for (const piece of merged) {
    const chars = Array.from(piece)
    const protectedRanges = []
    // Keep common words intact when wrapping a subtitle; ICU is built into
    // Node and is used only to choose line boundaries, never to rewrite text.
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
      for (const word of segmenter.segment(piece)) {
        const length = Array.from(word.segment).length
        if (!word.isWordLike || length < 2 || length > 10) continue
        const start = Array.from(piece.slice(0, word.index)).length
        protectedRanges.push([start, start + length])
      }
    }
    const number = /[零〇一二两三四五六七八九十百千万亿点0-9]+(?:[.．][0-9]+)?(?:毫升|毫米|厘米|公斤|毫克|分钟|小时|元|克|升|秒|天|年|月|日|件|支|瓶|只|%|％)?/gu
    for (const match of piece.matchAll(number)) {
      const start = Array.from(piece.slice(0, match.index)).length
      protectedRanges.push([start, start + Array.from(match[0]).length])
    }
    let offset = 0
    while (offset < chars.length) {
      const remaining = chars.length - offset
      if (remaining <= 10) { out.push(chars.slice(offset).join('')); break }
      const target = Math.ceil(remaining / Math.ceil(remaining / 10))
      const options = []
      for (let size = 1; size <= Math.min(10, remaining - 1); size++) {
        const cut = offset + size
        if (protectedRanges.some(([start, end]) => start < cut && cut < end)) continue
        const tailPenalty = remaining - size < 3 ? 5 : 0
        const headPenalty = /^[的了吗呢吧啊呀哦嘛]$/u.test(chars[cut] || '') ? 4 : 0
        const hangingPenalty = /^[的和及与]$/u.test(chars[cut - 1] || '') ? 2 : 0
        options.push({ size, score: Math.abs(size - target) + tailPenalty + headPenalty + hangingPenalty })
      }
      options.sort((a, b) => a.score - b.score || b.size - a.size)
      const size = options[0]?.size || 10
      out.push(chars.slice(offset, offset + size).join(''))
      offset += size
    }
  }
  return out.map((piece) => piece.replace(/[，、]$/, '')).filter(Boolean)
}

function spokenLength(text) {
  return Array.from(String(text || '').replace(/[\s\p{P}\p{S}]/gu, '')).length
}

function proportional(clauses, duration) {
  const total = clauses.reduce((sum, clause) => sum + spokenLength(clause), 0)
  let cursor = 0
  return clauses.map((clause, index) => {
    const share = total ? (spokenLength(clause) / total) * duration : duration / clauses.length
    const raw = index === clauses.length - 1 ? duration : Math.min(duration, cursor + share)
    // 每条至少 0.3 秒，并且游标要用修正后的结束时间推进，否则下一条起点会早于上一条终点
    const end = Math.min(duration, Math.max(raw, cursor + 0.3))
    const segment = { text: clause, start: Number(cursor.toFixed(3)), end: Number(end.toFixed(3)) }
    cursor = end
    return segment
  })
}

// asrSegments: [{ text, start, end }]，单位可能是毫秒，按总时长判断后统一成秒
export function timedSubtitleSegments(script, asrSegments, totalDuration) {
  const clauses = clausesOf(script)
  const duration = Number(totalDuration)
  if (!clauses.length || !Number.isFinite(duration) || duration <= 0) return []
  const raw = (Array.isArray(asrSegments) ? asrSegments : [])
    .map((segment) => ({ text: String(segment?.text || ''), start: Number(segment?.start), end: Number(segment?.end) }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
  if (!raw.length) return proportional(clauses, duration)

  const scale = Math.max(...raw.map((segment) => segment.end)) > duration * 1.5 ? 0.001 : 1
  const anchors = raw
    .map((segment) => ({ starts: segment.start * scale, ends: Math.min(duration, segment.end * scale), chars: spokenLength(segment.text) }))
    .filter((segment) => segment.chars > 0)
    .sort((a, b) => a.starts - b.starts)
  if (!anchors.length) return proportional(clauses, duration)

  const asrChars = anchors.reduce((sum, anchor) => sum + anchor.chars, 0)
  const scriptChars = clauses.reduce((sum, clause) => sum + spokenLength(clause), 0)
  const ratio = scriptChars ? asrChars / scriptChars : 1

  const timeAt = (position) => {
    let acc = 0
    for (const anchor of anchors) {
      if (position <= acc + anchor.chars) {
        const offset = anchor.chars ? (position - acc) / anchor.chars : 0
        return anchor.starts + Math.min(1, Math.max(0, offset)) * (anchor.ends - anchor.starts)
      }
      acc += anchor.chars
    }
    return anchors[anchors.length - 1].ends
  }

  let cursorChars = 0
  let cursorTime = 0
  const segments = clauses.map((clause) => {
    const length = spokenLength(clause) * ratio
    const start = Math.min(duration, Math.max(cursorTime, timeAt(cursorChars)))
    const end = Math.min(duration, Math.max(start + 0.3, timeAt(cursorChars + length)))
    cursorChars += length
    cursorTime = end
    return { text: clause, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) }
  })

  // 识别结果可能整段偏短或偏长，最后一段贴齐总时长，避免字幕提前消失
  const last = segments[segments.length - 1]
  if (last && last.end < duration - 0.15) last.end = Number(duration.toFixed(3))
  return segments.filter((segment) => segment.end > segment.start)
}

// Align the user's actual script to recognized character timestamps. A mismatch
// falls back to the previous segment estimate instead of claiming precision.
export function wordTimedSubtitleSegments(script, tokens, totalDuration) {
  const clauses = clausesOf(script)
  const duration = Number(totalDuration)
  if (!clauses.length || !Array.isArray(tokens) || !tokens.length || !Number.isFinite(duration) || duration <= 0) return null
  const clean = (value) => Array.from(String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''))
  const expected = []
  for (let index = 0; index < clauses.length; index++) {
    for (const ch of clean(clauses[index])) expected.push({ ch, clause: index })
  }
  const spoken = []
  let previous = 0
  for (const token of tokens.slice(0, 1200)) {
    const start = Number(token?.start), end = Number(token?.end)
    const chars = clean(token?.text)
    if (!chars.length || !Number.isFinite(start) || !Number.isFinite(end) || start < previous - 0.05 || end <= start || end > duration + 0.25) return null
    previous = end
    chars.forEach((ch, index) => spoken.push({ ch, start: start + (end - start) * index / chars.length, end: start + (end - start) * (index + 1) / chars.length }))
  }
  const n = expected.length, m = spoken.length
  if (!n || !m || n > 600 || m > 1200) return null
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + Number(expected[i - 1].ch !== spoken[j - 1].ch))
  }
  const similarity = 1 - dp[n][m] / Math.max(n, m)
  if (similarity < 0.78) return null
  const match = new Array(n).fill(null)
  let i = n, j = m
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + Number(expected[i - 1].ch !== spoken[j - 1].ch)) {
      match[i - 1] = j - 1; i--; j--
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) i--
    else if (j) j--
    else return null
  }
  const segments = []
  let previousEnd = 0
  for (let c = 0; c < clauses.length; c++) {
    const indexes = expected.map((item, index) => item.clause === c ? index : -1).filter((index) => index >= 0)
    const matched = indexes.map((index) => match[index]).filter((index) => index !== null)
    if (!matched.length || matched.length < indexes.length * 0.5) return null
    const start = Math.max(previousEnd, spoken[matched[0]].start - 0.06, 0)
    const end = Math.min(duration, Math.max(start + 0.08, spoken[matched.at(-1)].end + 0.08))
    if (end <= start) return null
    segments.push({ text: clauses[c], start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) })
    previousEnd = end
  }
  return { segments, similarity: Math.round(similarity * 1000) / 1000 }
}
