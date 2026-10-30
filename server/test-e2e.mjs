// 端到端集成测试：模拟完整用户流程
const BASE = 'http://localhost:3001/api'
const CLIENT = 'http://localhost:5173'

async function test() {
  const results = []

  // ============ 1. 前端服务 ============
  const clientRes = await fetch(CLIENT)
  const clientHtml = await clientRes.text()
  results.push(['前端服务(localhost:5173)', clientRes.ok && clientHtml.includes('root') ? '✓' : '✗'])

  // ============ 2. 登录 ============
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'demo-admin', password: process.env.TEST_PWD }),
  })
  const loginData = await loginRes.json()
  results.push(['登录API', loginData.code === 0 ? '✓' : '✗'])
  const token = loginData.data?.token
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // ============ 3. 完整AI创作流程 ============
  // 3.1 创建爆款复刻任务
  const taskRes = await (await fetch(`${BASE}/create/replica`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ shareUrl: 'https://v.douyin.com/test123', count: 1 }),
  })).json()
  results.push(['创建爆款复刻任务', taskRes.code === 0 ? '✓' : '✗'])
  const taskId = taskRes.data?.id

  // 3.2 轮询任务直到完成
  let finalTask = null
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const t = await (await fetch(`${BASE}/task/detail?id=${taskId}`, { headers: auth })).json()
    finalTask = t.data
    if (t.data?.status === 'success' || t.data?.status === 'failed') break
  }
  results.push(['AI任务完成(含进度轮询)', finalTask?.status === 'success' ? `✓ (${finalTask.progress}%)` : `状态:${finalTask?.status}`])

  // 3.3 验证点数扣除
  const userRes = await (await fetch(`${BASE}/user/info`, { headers: auth })).json()
  results.push(['点数扣除验证', userRes.data.ai_points < 50000 ? `✓ 剩余${userRes.data.ai_points}` : '✗'])

  // 3.4 验证作品生成
  const workRes = await (await fetch(`${BASE}/work/list?pageSize=5`, { headers: auth })).json()
  results.push(['作品自动入库', workRes.data.total > 0 ? `✓ ${workRes.data.total}个作品` : '✗'])

  // ============ 4. Agent SSE流式对话 ============
  const convRes = await (await fetch(`${BASE}/conversations`, { method: 'POST', headers: auth, body: JSON.stringify({}) })).json()
  const convId = convRes.data.id
  const sseRes = await fetch(`${BASE}/conversations/chat?conversationId=${convId}&message=${encodeURIComponent('帮我写一个面膜的口播脚本')}`, { headers: auth })
  const reader = sseRes.body.getReader()
  const decoder = new TextDecoder()
  let sseContent = ''
  let eventCount = 0
  const timeout = setTimeout(() => { try { reader.cancel() } catch {} }, 30000)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      eventCount += (text.match(/event:/g) || []).length
      const match = text.match(/data: (.+)/g)
      if (match) {
        for (const m of match) {
          try {
            const d = JSON.parse(m.slice(6))
            if (d.content) sseContent = d.content
          } catch {}
        }
      }
    }
  } catch {}
  clearTimeout(timeout)
  results.push(['Agent SSE流式对话', eventCount > 5 && sseContent.length > 50 ? `✓ ${eventCount}个事件/${sseContent.length}字` : '✗'])

  // ============ 5. 充值流程 ============
  const pkgRes = await (await fetch(`${BASE}/charge/packages`, { headers: auth })).json()
  const orderRes = await (await fetch(`${BASE}/charge/create`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ packageId: pkgRes.data[0].id }),
  })).json()
  const payRes = await (await fetch(`${BASE}/charge/pay`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ orderNo: orderRes.data.orderNo }),
  })).json()
  const userRes2 = await (await fetch(`${BASE}/user/info`, { headers: auth })).json()
  results.push(['充值流程', payRes.code === 0 && userRes2.data.ai_points > 49900 ? `✓ 到账后${userRes2.data.ai_points}点` : '✗'])

  // ============ 6. 智能剪辑导出 ============
  const mixRes = await (await fetch(`${BASE}/ai-mix/list`, { headers: auth })).json()
  if (mixRes.data.list[0]) {
    const exportRes = await (await fetch(`${BASE}/ai-mix/export`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ id: mixRes.data.list[0].id }),
    })).json()
    results.push(['智能剪辑导出', exportRes.code === 0 && exportRes.data.url ? '✓' : '✗'])
  } else {
    results.push(['智能剪辑导出', '无项目(跳过)'])
  }

  // ============ 7. ES搜索 ============
  const esRes = await (await fetch(`${BASE}/material/list?keyword=口红`, { headers: auth })).json()
  results.push(['ES全文检索', esRes.data.total > 0 ? `✓ ${esRes.data.total}条` : '✗'])

  // ============ 8. 团队/设置API ============
  const teamRes = await (await fetch(`${BASE}/team/member/list`, { headers: auth })).json()
  results.push(['团队成员列表', teamRes.code === 0 ? `✓ ${teamRes.data.total}人` : '✗'])
  const logRes = await (await fetch(`${BASE}/setting/log/list`, { headers: auth })).json()
  results.push(['操作日志', logRes.code === 0 ? `✓ ${logRes.data.total}条` : '✗'])

  // 输出结果
  console.log('\n========== 端到端集成测试 ==========')
  results.forEach(([name, status]) => console.log(`${status.padEnd(20)} ${name}`))
  const pass = results.filter(([, s]) => s.startsWith('✓')).length
  console.log(`\n通过率: ${pass}/${results.length}`)
  console.log('==================================')
}

test().catch(console.error)
