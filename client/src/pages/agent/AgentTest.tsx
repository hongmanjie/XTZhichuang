import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Input, Avatar, Empty, Spin, Tag, Tooltip, Popconfirm, message as antdMessage } from 'antd'
import {
  SendOutlined, PlusOutlined, DeleteOutlined, CopyOutlined, UserOutlined,
  RobotOutlined, ExpandOutlined, FileTextOutlined, PictureOutlined,
} from '@ant-design/icons'
import { api } from '../../api/request'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export default function AgentTest() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<any[]>([])
  const [currentId, setCurrentId] = useState<number | null>(conversationId ? +conversationId : null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [skill, setSkill] = useState<string>('script')
  const [changingSkill, setChangingSkill] = useState(false)
  const [skills, setSkills] = useState<any[]>([])
  const [chatModels, setChatModels] = useState<any[]>([])
  const [videoModels, setVideoModels] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const currentIdRef = useRef<number | null>(currentId)
  const skipLoadRef = useRef<number | null>(null)
  const loadSequenceRef = useRef(0)
  currentIdRef.current = currentId

  useEffect(() => {
    fetchConversations()
    api.skills().then(setSkills).catch(() => {})
    api.aiStatus().then((d) => {
      setChatModels(d?.models?.chat || [])
      setVideoModels(d?.models?.video || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (conversationId) {
      const id = +conversationId
      if (id !== currentIdRef.current) { abortRef.current?.abort(); abortRef.current = null; setSending(false) }
      currentIdRef.current = id
      setCurrentId(id)
      if (skipLoadRef.current === id) skipLoadRef.current = null
      else loadMessages(id)
    } else {
      abortRef.current?.abort()
      abortRef.current = null
      setSending(false)
      currentIdRef.current = null
      loadSequenceRef.current++
      setMessages([])
      setCurrentId(null)
    }
  }, [conversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchConversations = async () => {
    try {
      const data = await api.conversations({ pageSize: 50 })
      setConversations(data.list || [])
    } catch {}
  }

  const loadMessages = async (id: number) => {
    const sequence = ++loadSequenceRef.current
    try {
      const data = await api.conversationMessages(id)
      if (sequence !== loadSequenceRef.current) return
      setMessages(data.messages || [])
      if (data.conversation?.skill) setSkill(data.conversation.skill)
    } catch {}
  }

  const changeSkill = async (nextSkill: string) => {
    if (sending || changingSkill || nextSkill === skill) return
    if (!currentId) { setSkill(nextSkill); return }
    const id = currentId
    setChangingSkill(true)
    try {
      await api.setConversationSkill(id, nextSkill)
      if (currentIdRef.current === id) setSkill(nextSkill)
    } catch {} finally { setChangingSkill(false) }
  }

  const createNewConversation = async () => {
    try {
      const data = await api.createConversation({ title: '新会话', skill })
      navigate(`/agent/${data.id}`)
      fetchConversations()
    } catch {}
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return

    let convId = currentId
    if (!convId) {
      try {
        const data = await api.createConversation({ title: text.slice(0, 20), skill })
        convId = data.id
        currentIdRef.current = convId
        setCurrentId(convId)
        skipLoadRef.current = convId
        navigate(`/agent/${convId}`, { replace: true })
        fetchConversations()
      } catch { return }
    }

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    setSending(true)

    // SSE 流式请求
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(
        '/api/conversations/chat/stream',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: convId, message: text }), signal: controller.signal }
      )
      if (!resp.ok || !resp.body) throw new Error('会话请求失败')
      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false
      let reportedError = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')

        let boundary
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const lines = packet.split('\n')
          const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim()
          const dataStr = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
          if (!dataStr) continue

          if (event === 'assistant.preview') {
            const data = JSON.parse(dataStr)
            setMessages((prev) => {
              if (currentIdRef.current !== convId) return prev
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: data.content }
              return next
            })
          } else if (event === 'message.done') {
            const data = JSON.parse(dataStr)
            completed = true
            setMessages((prev) => {
              if (currentIdRef.current !== convId) return prev
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: data.content }
              return next
            })
            fetchConversations()
          } else if (event === 'task.error') {
            const data = JSON.parse(dataStr)
            reportedError = true
            antdMessage.error(data.message || 'AI 生成失败')
            setMessages((prev) => {
              if (currentIdRef.current !== convId) return prev
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: `生成失败：${data.message || '请稍后重试'}` }
              return next
            })
          }
        }
      }
      if (!completed && !reportedError) throw new Error('对话连接中断')
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        antdMessage.error('发送失败，请重试')
      }
      setMessages((prev) => {
        if (currentIdRef.current !== convId) return prev
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content ? `${last.content}\n（${e.name === 'AbortError' ? '已停止接收' : '连接中断'}）` : (e.name === 'AbortError' ? '已停止接收回复' : '生成失败，请稍后重试') }
        return next
      })
    } finally {
      if (abortRef.current === controller) { setSending(false); abortRef.current = null }
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleDelete = async (id: number) => {
    await api.deleteConversation({ id })
    antdMessage.success('已删除')
    if (id === currentId) navigate('/agent')
    fetchConversations()
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    antdMessage.success('已复制')
  }

  return (
    <div className="flex h-[calc(100vh-112px)] gap-4">
      {/* ============ 左侧：会话列表 ============ */}
      <div className="flex w-60 shrink-0 flex-col rounded-2xl bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <Button type="primary" block icon={<PlusOutlined />} onClick={createNewConversation}>
            新建会话
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                c.id === currentId ? 'bg-purple-50 text-primary' : 'text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => navigate(`/agent/${c.id}`)}
            >
              <FileTextOutlined />
              <span className="flex-1 truncate">{c.title}</span>
              <DeleteOutlined
                className="hidden text-gray-300 hover:text-red-500 group-hover:block"
                onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
              />
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="py-8 text-center text-xs text-gray-400">暂无会话</div>
          )}
        </div>
      </div>

      {/* ============ 中间：对话区 ============ */}
      <div className="flex flex-1 flex-col rounded-2xl bg-white shadow-sm">
        {/* 顶部技能选择 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-3">
            <img src="/images/aiAgent/agent-home-hero.png" alt="" className="h-7 w-7" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span className="text-sm font-medium text-gray-700">AI Agent 创作助手</span>
            <Tag color="purple" className="!text-xs">{chatModels[0]?.name || 'AI对话模型'}</Tag>
          </div>
          <div className="flex gap-2">
            {skills.map((s) => (
              <Tag
                key={s.key}
                color={skill === s.key ? 'purple' : 'default'}
                className={sending || changingSkill ? '!cursor-not-allowed opacity-50' : '!cursor-pointer'}
                onClick={() => { void changeSkill(s.key) }}
              >
                {s.name}
              </Tag>
            ))}
          </div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <img src="/images/aiAgent/conversation-placeholder.png" alt="" className="mb-4 h-24 w-24 opacity-60" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <h3 className="mb-2 text-lg font-medium text-gray-700">开始你的创作之旅</h3>
              <p className="mb-6 text-sm text-gray-400">输入产品信息，AI帮你生成脚本、分镜与创意</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <FileTextOutlined />, text: '帮我写一个口红的带货口播脚本' },
                  { icon: <PictureOutlined />, text: '生成一个面膜的分镜脚本' },
                  { icon: <FileTextOutlined />, text: '分析这个爆款视频的创作逻辑' },
                  { icon: <RobotOutlined />, text: '给我一些双11的创意选题' },
                ].map((q, i) => (
                  <div
                    key={i}
                    className="flex w-64 cursor-pointer items-center gap-2 rounded-xl border border-gray-100 px-4 py-3 text-xs text-gray-500 transition-all hover:border-primary hover:text-primary"
                    onClick={() => setInput(q.text)}
                  >
                    {q.icon}
                    <span className="truncate">{q.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <Avatar
                    size={36}
                    icon={m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    className={m.role === 'user' ? '!bg-gray-400' : '!bg-primary'}
                  />
                  <div className={`max-w-[70%] ${m.role === 'user' ? 'text-right' : ''}`}>
                    <div
                      className={`inline-block rounded-2xl px-4 py-3 text-left text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-primary text-white'
                          : 'bg-gray-50 text-gray-700'
                      }`}
                    >
                      {m.content ? (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      ) : (
                        <div className="flex items-center gap-2 text-gray-400">
                          <Spin size="small" />
                          <span className="text-xs">AI正在思考...</span>
                        </div>
                      )}
                    </div>
                    {m.role === 'assistant' && m.content && (
                      <div className="mt-1 flex gap-3">
                        <Tooltip title="复制">
                          <CopyOutlined className="cursor-pointer text-xs text-gray-300 hover:text-primary" onClick={() => handleCopy(m.content)} />
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-end gap-2">
            <Input.TextArea
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入你的创作需求，回车发送，Shift+回车换行"
              autoSize={{ minRows: 1, maxRows: 4 }}
              className="!rounded-xl"
            />
            {sending ? (
              <Button danger onClick={handleStop}>停止</Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!input.trim()}>
                发送
              </Button>
            )}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-gray-300">
            <span>AI生成内容仅供参考</span>
            <ExpandOutlined />
          </div>
        </div>
      </div>

      {/* ============ 右侧：参考与工作区 ============ */}
      <div className="hidden w-56 shrink-0 rounded-2xl bg-white p-4 shadow-sm xl:block">
        <h3 className="mb-3 text-sm font-medium text-gray-700">创作技能</h3>
        <div className="space-y-2">
          {skills.map((s) => (
            <div key={s.key} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <img src={s.icon} alt="" className="h-5 w-5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <span className="text-xs font-medium text-gray-700">{s.name}</span>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
        <h3 className="mb-3 mt-5 text-sm font-medium text-gray-700">视频模型</h3>
        <div className="space-y-2">
          {(videoModels.length ? videoModels.slice(0, 3) : [{ name: 'MiniMax H3 (ModelGate)' }]).map((v, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-gray-50 p-3">
              <img src="/images/aiAgent/video-model.png" alt="" className="h-6 w-6" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <span className="text-[10px] text-gray-500">{v.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
