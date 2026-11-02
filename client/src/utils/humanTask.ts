export type TaskNote = { tone: 'ok' | 'warn' | 'error'; text: string; action?: 'subtitle' | 'retry' | 'shorten' }

export type TaskView = {
  status: 'idle' | 'run' | 'ok' | 'warn' | 'fail'
  label: string
  notes: TaskNote[]
  detail: string
}

const STAGE_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  success: '已完成',
  failed: '生成失败',
  reconciling: '待核对',
  cancelled: '已取消',
}

function number(text: string, pattern: RegExp) {
  const hit = text.match(pattern)
  return hit ? Number(hit[1]) : null
}

// 把上游和任务里的技术描述收敛成用户能直接照做的短句，
// 原始文本只放在“详情”里，避免整段工程术语糊在页面上。
export function humanTaskView(task: any): TaskView {
  const result = task?.result || {}
  const warnings: string[] = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : []
  const raw = [...warnings, task?.error || ''].filter(Boolean).join('；')
  const notes: TaskNote[] = []
  const seen = new Set<string>()

  const push = (note: TaskNote) => {
    if (seen.has(note.text)) return
    seen.add(note.text)
    notes.push(note)
  }

  const overSpeech = number(raw, /配音约\s*([\d.]+)\s*秒[，,]\s*超过视频/)
  const videoSeconds = number(raw, /超过视频\s*([\d.]+)\s*秒/)
  if (overSpeech && videoSeconds && overSpeech > videoSeconds) {
    const gap = overSpeech - videoSeconds
    push({ tone: 'warn', text: `文案比画面长 ${gap.toFixed(1)} 秒，建议删掉约 ${Math.max(1, Math.ceil(gap * 4.5))} 字再生成`, action: 'shorten' })
  }

  if (/画面可能已有文字|旧字幕|text_detected/.test(raw) || result.qualityCheck?.status === 'text_detected') {
    push({ tone: 'warn', text: '画面里检测到文字，这次没有加字幕', action: 'subtitle' })
  }
  if (result.subtitle?.reason === 'unavailable' || /画面文字检查未完成/.test(raw)) {
    push({ tone: 'warn', text: '画面文字检查未完成，这次没有加字幕', action: 'subtitle' })
  }
  if (result.subtitle?.reason === 'burn_failed' || /字幕叠加未完成|字幕叠加失败|字幕没有加上/.test(raw)) {
    push({ tone: 'warn', text: '字幕没有加上，可以单独处理', action: 'subtitle' })
  }
  if (/超过当前文案的预留视频时长/.test(raw)) push({ tone: 'warn', text: '配音较长，请缩短文案后重新生成', action: 'shorten' })
  if (/720P 旧任务/.test(raw)) push({ tone: 'warn', text: '这是旧任务，请用原文案重新生成', action: 'shorten' })
  if (/口型同步未完成|口型状态待核对|口型同步也未执行|口型同步失败/.test(raw)) push({ tone: 'warn', text: '口型没有同步成功，已保留配音画面' })
  if (result.speechCheck?.status === 'review') push({ tone: 'warn', text: '配音识别结果和文案有出入，建议试听' })
  if (result.productReference?.usedImage) push({ tone: 'warn', text: '商品细节可能变化，建议对照原图检查' })
  if (/upstream_failed|720P/.test(raw) && /失败|failed/.test(raw)) push({ tone: 'warn', text: '这次上游没有生成成功，可以稍后重试' })

  if (task?.status === 'failed' && notes.length === 0) push({ tone: 'error', text: '这次没生成成功，可以重试一次' })
  if (task?.status === 'reconciling') push({ tone: 'warn', text: '上游结果还不确定，确认后可以手动继续' })

  if (task?.status === 'success' && result.speechCheck?.status === 'matched' && notes.length === 0) {
    push({ tone: 'ok', text: '配音已按文案生成' })
  }

  const stage = String(task?.stage || '').trim()
  let label = STAGE_LABEL[task?.status] || '处理中'
  if (task?.status === 'running' && stage) label = stage.replace(/^正在/, '')

  return {
    status: task?.status === 'success' ? (notes.some((n) => n.tone !== 'ok') ? 'warn' : 'ok')
      : task?.status === 'failed' ? 'fail'
        : ['pending', 'running'].includes(task?.status) ? 'run' : 'idle',
    label,
    notes: notes.slice(0, 3),
    detail: raw,
  }
}

export function estimateSpeech(text: string) {
  const chars = String(text || '').replace(/\s+/g, '').length
  return { chars, seconds: chars / 4.5 }
}
