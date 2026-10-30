import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { mgEnabled, chat as unifiedChat } from '../services/aiProviders.js'
import { teamUserIds, canManage } from '../utils/teamScope.js'

const router = express.Router()
function scriptAllowed(scriptId, userId, write = false) {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId)
  if (!script) return null
  return (write ? canManage(userId, script.owner_id) : teamUserIds(userId).includes(script.owner_id)) ? script : null
}

// ============ AI脚本分镜 ============
router.get('/ai/script/subitem/list', authRequired, (req, res) => {
  const { scriptId } = req.query
  if (!scriptAllowed(scriptId, req.user.id)) return res.json(fail('脚本不存在或无权访问', 404))
  const list = db.prepare('SELECT * FROM script_subitems WHERE script_id = ? ORDER BY sort, id').all(scriptId)
  res.json(success({ list }))
})

router.post('/ai/script/subitem/edit', authRequired, (req, res) => {
  const { id, sceneDesc, line, duration, remark } = req.body
  if (!id) return res.json(fail('参数缺失', 400))
  const item = db.prepare('SELECT script_id FROM script_subitems WHERE id = ?').get(id)
  if (!item || !scriptAllowed(item.script_id, req.user.id, true)) return res.json(fail('分镜不存在或无权修改', 404))
  db.prepare('UPDATE script_subitems SET scene_desc = ?, line = ?, duration = ?, remark = ? WHERE id = ?')
    .run(sceneDesc, line, duration, remark, id)
  res.json(success(null, '保存成功'))
})

// 拆分镜头：把一句台词拆成多个分镜
router.post('/ai/script/subitem/split/edit', authRequired, (req, res) => {
  const { id, lines } = req.body
  const src = db.prepare('SELECT * FROM script_subitems WHERE id = ?').get(id)
  if (!src || !scriptAllowed(src.script_id, req.user.id, true)) return res.json(fail('分镜不存在或无权修改', 404))
  const parts = Array.isArray(lines) && lines.length ? lines : (src.line || '').split(/[。！？!?]/).filter(Boolean)
  if (parts.length <= 1) return res.json(fail('至少需要两句才能拆分', 400))
  db.transaction(() => {
    db.prepare('DELETE FROM script_subitems WHERE id = ?').run(id)
    const stmt = db.prepare('INSERT INTO script_subitems (script_id, scene_no, scene_desc, line, duration, remark, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    parts.forEach((line, i) => stmt.run(src.script_id, src.scene_no + i, src.scene_desc, line.trim(), src.duration / parts.length, '', src.sort + i))
  }).immediate()
  res.json(success(null, `已拆分为 ${parts.length} 个分镜`))
})

// 调整结构：批量更新排序与时长
router.post('/ai/script/subitem/structure/edit', authRequired, (req, res) => {
  const { scriptId, items } = req.body
  if (!Array.isArray(items)) return res.json(fail('参数缺失', 400))
  if (!scriptAllowed(scriptId, req.user.id, true)) return res.json(fail('脚本不存在或无权修改', 404))
  const stmt = db.prepare('UPDATE script_subitems SET sort = ?, duration = ?, scene_no = ? WHERE id = ? AND script_id = ?')
  items.forEach((it, i) => stmt.run(i, it.duration || 3, i + 1, it.id, scriptId))
  res.json(success(null, '结构已更新'))
})

// AI 智能生成分镜 —— ModelGate 优先
router.post('/ai/script/intelligent/generation', authRequired, asyncHandler(async (req, res) => {
  const { scriptId, productName, requirement } = req.body
  const script = scriptAllowed(scriptId, req.user.id, true)
  if (!script) return res.json(fail('脚本不存在或无权修改', 404))
  if (!mgEnabled()) return res.json(fail('AI 引擎未启用', 503))

  let scenes
  if (mgEnabled()) {
    try {
      const sys = '你是短视频分镜脚本专家。只输出 JSON 数组，不要多余文字。每个元素字段：scene_desc（画面描述）、line（台词/口播）、duration（秒，3-8）。'
      const user = `产品：${productName || '未指定产品'}\n要求：${requirement || script.content || '带货短视频，突出卖点'}\n请生成 5 个分镜，结构：黄金3秒钩子 → 卖点讲解 → 场景演示 → 效果对比 → 促销转化。`
      const text = await unifiedChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], { temperature: 0.7, max_tokens: 1200 })
      const clean = text.replace(/```json|```/g, '').trim()
      const m = clean.match(/\[[\s\S]*\]/)
      scenes = JSON.parse(m ? m[0] : clean)
      if (!Array.isArray(scenes) || !scenes.length || scenes.length > 30 || scenes.some((s) => !s || typeof s !== 'object' || (!s.scene_desc && !s.desc))) throw new Error('AI 返回格式异常')
    } catch (e) {
      return res.json(fail(`分镜生成失败：${e.message}`, 503))
    }
  }
  db.transaction(() => {
    const count = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM script_subitems WHERE script_id = ?').get(scriptId).n
    const stmt = db.prepare('INSERT INTO script_subitems (script_id, scene_no, scene_desc, line, duration, sort) VALUES (?, ?, ?, ?, ?, ?)')
    scenes.forEach((s, i) => stmt.run(scriptId, count + i + 1, String(s.scene_desc || s.desc).slice(0, 2000), String(s.line || s.text || '').slice(0, 2000), Math.min(60, Math.max(1, Number(s.duration) || 5)), count + i))
    db.prepare("INSERT INTO script_generation_records (script_id, owner_id, action, detail) VALUES (?, ?, 'AI智能分镜', ?)").run(scriptId, req.user.id, `新增 ${scenes.length} 个分镜`)
  }).immediate()
  res.json(success({ count: scenes.length }, '已新增 AI 分镜，原有内容已保留'))
}))

// AI 润色优化 —— ModelGate 优先
router.post('/ai/script/polish', authRequired, asyncHandler(async (req, res) => {
  const { content, requirement } = req.body
  if (!content?.trim()) return res.json(fail('请提供需要润色的脚本内容', 400))
  if (!requirement?.trim()) return res.json(fail('请输入润色要求', 400))

  if (mgEnabled()) {
    try {
      const sys = '你是短视频带货脚本润色专家。根据用户的润色要求改写脚本，只输出润色后的完整脚本，不要任何解释。保持口语化、有感染力，强化开头钩子与转化号召。'
      const user = `原始脚本：\n${content}\n\n润色要求：${requirement}`
      const text = await unifiedChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], { temperature: 0.7, max_tokens: 1000 })
      return res.json(success({ content: text.trim(), engine: 'real' }, 'AI润色完成'))
    } catch (e) {
      return res.json(fail(`AI 润色失败：${e.message}`, 503))
    }
  }

  res.json(fail('AI 引擎未启用', 503))
}))

// 生成记录
router.get('/ai/script/generation/record', authRequired, (req, res) => {
  const { scriptId } = req.query
  if (!scriptAllowed(scriptId, req.user.id)) return res.json(fail('脚本不存在或无权访问', 404))
  const list = db.prepare('SELECT id, action, detail, created_at FROM script_generation_records WHERE script_id = ? ORDER BY id DESC').all(scriptId)
  res.json(success({ list }))
})

// 口播文案生成（dictate）—— ModelGate 优先
router.post('/ai/script/dictate/script/generation', authRequired, asyncHandler(async (req, res) => {
  const { productName, requirement } = req.body
  const pn = productName || '这款产品'
  const reqText = requirement || '突出卖点，口语化，适合带货'

  if (mgEnabled()) {
    try {
      const sys = '你是短视频带货口播脚本专家。只输出脚本内容，不要任何多余解释。结构：【黄金3秒】【痛点】【卖点】【场景】【转化】。'
      const user = `产品：${pn}\n要求：${reqText}\n请生成一条30-45秒的带货口播脚本，语言口语化，有感染力。`
      const text = await unifiedChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], { temperature: 0.7, max_tokens: 800 })
      return res.json(success({ content: text.trim() }, '生成成功'))
    } catch (e) {
      return res.json(fail(`口播脚本生成失败：${e.message}`, 503))
    }
  }

  res.json(fail('AI 引擎未启用', 503))
}))

export default router
