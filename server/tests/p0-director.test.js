import test from 'node:test'
import assert from 'node:assert/strict'

const skill = await import('../src/services/h3PromptSkill.js')

test('official alignment line is prepended only for keyframe modes', () => {
  assert.equal(skill.h3AlignmentInstruction('t2av', '[Shot 1] x', 124), '')
  const i2av = skill.h3AlignmentInstruction('i2av', '[Shot 1] x', 124)
  assert.match(i2av, /^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.\n\n$/)
  const fl2av = skill.h3AlignmentInstruction('fl2av', '[Shot 1] open [Shot 3] close', 192)
  assert.match(fl2av, /Picture 2 \(from Shot 3\) aligns with the 8\.00-second mark/)
  const l2av = skill.h3AlignmentInstruction('l2av', '[Shot 2] land', 124)
  assert.match(l2av, /<Picture 1> \(from \[Shot 2\]\) aligns with the 5\.17-second mark/)
})

test('ad templates cover beauty/food/home and inject as reference structure', () => {
  assert.equal(skill.AD_TEMPLATES.beauty.shots.length, 3)
  assert.equal(skill.templateForCategory('beauty').name, '美妆快切')
  assert.equal(skill.templateForCategory('food').name, '食品食欲')
  assert.equal(skill.templateForCategory('home').name, '家居场景')
  assert.equal(skill.templateForCategory('general'), null)
  const messages = skill.buildSkillMessages({ input: '口红展示', durationSec: 8, direction: 'beauty' })
  assert.match(messages[1].content, /Reference ad structure/)
  assert.match(messages[1].content, /静物开场/)
})

test('skill output parsing is strict', () => {
  const fenced = '```json\n{"quality":"detailed","category":"beauty","integrated_multimodal_description":"[Shot 1] ...","overall_soundscape":"...","non_diegetic_music":"..."}\n```'
  assert.equal(skill.parseSkillOutput(fenced).quality, 'detailed')
  assert.equal(skill.parseSkillOutput('{"visual_style":"x","shots":[]}'), null)
  assert.equal(skill.parseSkillOutput('真实模型回答'), null)
  assert.equal(skill.parseHumanOutput('太短'), null)
  assert.equal(skill.parseHumanOutput('{"a":1}'), null)
  assert.ok(skill.parseHumanOutput('主播眼神看向镜头，讲解到卖点时有轻微点头和手势配合。'))
})

test('category detection is bilingual', () => {
  assert.equal(skill.detectCategory('一支口红在石材台面上展示'), 'beauty')
  assert.equal(skill.detectCategory('a cup of coffee poured over ice'), 'food')
  assert.equal(skill.detectCategory('hello world'), 'general')
})
