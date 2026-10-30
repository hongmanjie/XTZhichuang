import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { realEnabled, chatStream, MODEL_CATALOG } from '../services/aiProviders.js'

const router = express.Router()

// ============ 技能列表 ============
const SKILLS = [
  {
    key: 'script',
    name: '脚本创作',
    icon: '/images/aiAgent/skill-category-script.png',
    desc: '输入产品信息，AI生成带货口播脚本',
    options: ['口播脚本', '测评脚本', '剧情脚本'],
  },
  {
    key: 'product',
    name: '产品分析',
    icon: '/images/aiAgent/skill-category-product.png',
    desc: '分析产品卖点，输出营销建议',
    options: ['卖点提炼', '人群画像', '定价建议'],
  },
  {
    key: 'video',
    name: '视频脚本',
    icon: '/images/aiAgent/video-model.png',
    desc: '生成分镜脚本，包含镜头与话术',
    options: ['分镜脚本', '翻拍脚本', '混剪脚本'],
  },
]

router.get('/skills', authRequired, (req, res) => {
  res.json(success(SKILLS))
})

router.get('/skills/options', authRequired, (req, res) => {
  res.json(success({
    models: MODEL_CATALOG.chat,
    tones: ['专业严谨', '活泼亲切', '幽默风趣', '激情促销'],
  }))
})

// ============ 会话管理 ============
router.get('/conversations', authRequired, (req, res) => {
  const { pageNum = 1, pageSize = 30 } = req.query
  const total = db.prepare('SELECT COUNT(*) c FROM conversations WHERE owner_id = ?').get(req.user.id).c
  const list = db.prepare(`
    SELECT c.*, (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message
    FROM conversations c WHERE c.owner_id = ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, +pageSize, (+pageNum - 1) * +pageSize)
  res.json(page(list, total, +pageNum, +pageSize))
})

router.post('/conversations', authRequired, (req, res) => {
  if (req.body.skill && !SKILLS.some((item) => item.key === req.body.skill)) return res.json(fail('请选择有效的创作技能', 400))
  const info = db.prepare('INSERT INTO conversations (title, skill, owner_id) VALUES (?, ?, ?)')
    .run(req.body.title || '新会话', req.body.skill || null, req.user.id)
  res.json(success({ id: info.lastInsertRowid }))
})

router.get('/conversations/:id/messages', authRequired, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id)
  if (!conv) return res.json(fail('会话不存在', 404))
  const list = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id)
  list.forEach((m) => { if (m.attachments) m.attachments = JSON.parse(m.attachments) })
  res.json(success({ conversation: conv, messages: list }))
})

router.post('/conversations/:id/skill', authRequired, (req, res) => {
  const { skill } = req.body
  if (!SKILLS.some((item) => item.key === skill)) return res.json(fail('请选择有效的创作技能', 400))
  const updated = db.prepare("UPDATE conversations SET skill = ?, updated_at = datetime('now','localtime') WHERE id = ? AND owner_id = ?").run(skill, req.params.id, req.user.id)
  if (!updated.changes) return res.json(fail('会话不存在', 404))
  res.json(success({ skill }))
})

router.post('/conversations/delete', authRequired, (req, res) => {
  db.transaction(() => {
    const owned = db.prepare('SELECT id FROM conversations WHERE id = ? AND owner_id = ?').get(req.body.id, req.user.id)
    if (!owned) return
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.body.id)
    db.prepare('DELETE FROM conversations WHERE id = ? AND owner_id = ?').run(req.body.id, req.user.id)
  }).immediate()
  res.json(success(null, '删除成功'))
})

// ============ SSE 流式对话 ============
// 协议：event: assistant.preview / task.progress / message.done
// The legacy GET route remains for existing clients; new clients send text in a POST body.
function streamConversation(req, res) {
  const { conversationId, message } = req.method === 'POST' ? req.body : req.query
  if (!Number.isSafeInteger(Number(conversationId)) || Number(conversationId) <= 0 || typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return res.status(400).json({ code: 400, message: '参数缺失' })
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND owner_id = ?').get(conversationId, req.user.id)
  if (!conv) return res.status(404).json({ code: 404, message: '会话不存在' })

  // 保存用户消息
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, 'user', message)
  db.prepare("UPDATE conversations SET updated_at = datetime('now','localtime') WHERE id = ?").run(conversationId)

  // 首条消息时更新标题
  const msgCount = db.prepare('SELECT COUNT(*) c FROM messages WHERE conversation_id = ?').get(conversationId).c
  if (msgCount <= 1) {
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(message.slice(0, 20), conversationId)
  }

  // SSE 响应
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let closed = false
  const controller = new AbortController()
  res.on('close', () => { closed = true; controller.abort() })

  const seqRef = { n: 1 }
  const send = (event, data) => {
    if (closed) return false
    try {
      res.write(`id: ${seqRef.n++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      return true
    } catch {
      closed = true
      return false
    }
  }

  const persistReply = (reply) => {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'assistant', reply)
  }

  const finish = (reply, engine = 'real') => {
    persistReply(reply)
    send('task.progress', { stage: 'done', progress: 100, desc: '生成完成' })
    send('message.done', { content: reply, role: 'assistant', engine })
    res.end()
  }

  send('task.progress', { stage: 'thinking', progress: 10, desc: '正在理解需求...' })

  const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 11')
    .all(conversationId)
    .reverse()
    .slice(0, -1) // 排除刚插入的这条用户消息

  const streamReal = async () => {
    const messages = [
      { role: 'system', content: buildSystemPrompt(conv.skill) },
      ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: message },
    ]
    let full = ''
    let lastSent = 0
    for await (const chunk of chatStream(messages, { signal: controller.signal })) {
      if (closed) return
      if (!chunk.delta) continue
      full += chunk.delta
      const now = Date.now()
      if (now - lastSent > 80) {
        lastSent = now
        send('assistant.preview', { content: full, done: false })
      }
    }
    if (!full.trim()) throw new Error('LLM 返回空内容')
    finish(full, 'real')
  }

  if (realEnabled()) {
    streamReal().catch((err) => {
      console.warn(`[Agent对话] 真实LLM失败: ${err.message}`)
      if (!closed) {
        send('task.error', { message: 'AI 生成失败，请稍后重试' })
        res.end()
      }
    })
  } else {
    send('task.error', { message: 'AI 引擎未启用' })
    res.end()
  }
}
router.get('/conversations/chat', authRequired, streamConversation)
router.post('/conversations/chat/stream', authRequired, streamConversation)

// 非流式对话（备用）：真实 LLM 优先，失败降级
router.post('/conversations/chat', authRequired, asyncHandler(async (req, res) => {
  const { conversationId, message } = req.body
  if (!conversationId || !message) return res.json(fail('参数缺失', 400))
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND owner_id = ?').get(conversationId, req.user.id)
  if (!conv) return res.json(fail('会话不存在', 404))
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, 'user', message)

  let reply = ''
  let engine = 'real'
  if (realEnabled()) {
    try {
      const history = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 11')
        .all(conversationId).reverse().slice(0, -1)
      const messages = [
        { role: 'system', content: buildSystemPrompt(conv.skill) },
        ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
        { role: 'user', content: message },
      ]
      reply = await chatStreamToString(messages)
      engine = 'real'
    } catch (err) {
      return res.json(fail('AI 生成失败，请稍后重试', 503))
    }
  }
  if (!reply) return res.json(fail('AI 引擎未启用', 503))

  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, 'assistant', reply)
  res.json(success({ content: reply, engine }))
}))

async function chatStreamToString(messages) {
  let full = ''
  for await (const chunk of chatStream(messages)) {
    if (chunk.delta) full += chunk.delta
  }
  if (!full.trim()) throw new Error('LLM 返回空内容')
  return full
}

// 按技能注入系统提示词
function buildSystemPrompt(skill) {
  const base = '你是「兴图智创」电商广告内容创作助手，服务于商家与内容创作者。回答使用简体中文，务实、可执行。只能根据用户明确提供的事实写商品介绍与营销话术。没有明确提供或证据的商品材质、用途、功效、安全性、认证、价格、销量、评价或行业统计，都不能编入卖点、示例宣传语或具体报价；即使标注“待确认”也不能把它们写成事实或推荐用户宣称。不要从颜色、名称等推断食品安全、无菌、无添加、母婴级或其他未提供的属性；缺少必要信息时只提出需要确认的问题。可以提出拍摄画面创意，但要说明是创作建议而非已看到的画面。当前对话只能读取用户输入的文字，不会自动读取图片、视频或链接内容；不得声称已经看到或分析了未提供的画面，可建议用户使用视频解析功能。'
  const skillPrompts = {
    script: `\n当前技能：脚本创作。用户需要带货口播/短视频脚本。输出要求：\n- 若未指定时长，默认产出 30~45 秒口播脚本\n- 按时间轴分段（黄金3秒钩子/痛点引入/产品亮相/卖点展示/信任背书/行动号召），每段标注秒数与话术\n- 话术口语化，每句不超过 20 字，符合抖音带货节奏\n- 结尾主动询问是否需要调整风格、时长或补充卖点`,
    product: `\n当前技能：产品分析。用户需要产品卖点与营销策略分析。输出要求：\n- 先列出用户已提供的事实，只使用这些事实给出卖点和话术；信息不足时不必凑足卖点，应列出待确认问题\n- 目标人群和拍摄思路可作为明确标注的假设，不得当成已验证结论\n- 未提供成本和定价目标时，不给出具体价格、促销力度或所谓行业均价，不编造数据来源`,
    video: `\n当前技能：视频脚本/分镜。用户需要分镜脚本。输出要求：\n- 使用表格输出：时间 | 画面描述 | 话术/字幕 | 景别/运镜\n- 包含 BGM 与节奏建议\n- 分镜密度符合短视频习惯（每 3~6 秒一个镜头）`,
  }
  return base + (skillPrompts[skill] || '\n用户未指定技能时，先简要确认需求，再给出可执行的内容方案。')
}

// ============ 生成记录 ============
router.get('/agent/generations', authRequired, (req, res) => {
  res.json(fail('智能体生成记录尚未接入，请在会话中查看对话记录', 503))
})

router.get('/artifacts', authRequired, (req, res) => {
  res.json(fail('智能体独立产物记录尚未接入', 503))
})

export default router
