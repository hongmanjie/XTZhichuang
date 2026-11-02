import test from 'node:test'
import assert from 'node:assert/strict'
import { humanTaskView } from '../src/utils/humanTask.ts'

test('an unavailable subtitle check is visible and offers follow-up', () => {
  const view = humanTaskView({ status: 'success', result: { subtitle: { enabled: false, reason: 'unavailable' }, speechCheck: { status: 'matched' } } })
  assert.equal(view.status, 'warn')
  assert.equal(view.notes[0].action, 'subtitle')
  assert.ok(view.notes[0].text.includes('\u6ca1\u6709\u52a0\u5b57\u5e55'))
  assert.ok(!view.notes.some((note) => note.tone === 'ok'))
})

test('an explicitly disabled subtitle is not reported as a failure', () => {
  const view = humanTaskView({ status: 'success', params: { subtitle: { enabled: false } }, result: { subtitle: { enabled: false }, speechCheck: { status: 'matched' } } })
  assert.equal(view.status, 'ok')
  assert.ok(!view.notes.some((note) => note.action === 'subtitle'))
})

test('missing burned subtitles and changed product details are explained', () => {
  const view = humanTaskView({ status: 'success', result: { subtitle: { enabled: false, reason: 'burn_failed' }, productReference: { usedImage: true } } })
  assert.equal(view.status, 'warn')
  assert.ok(view.notes.some((note) => note.action === 'subtitle'))
  assert.ok(view.notes.some((note) => note.text.includes('\u5546\u54c1\u7ec6\u8282')))
})

test('a long speech reservation failure offers the original text for shortening', () => {
  const view = humanTaskView({ status: 'failed', error: '\u914d\u97f3\u7ea6 60 \u79d2\uff0c\u8d85\u8fc7\u5f53\u524d\u6587\u6848\u7684\u9884\u7559\u89c6\u9891\u65f6\u957f' })
  assert.ok(view.notes.some((note) => note.action === 'shorten'))
})
