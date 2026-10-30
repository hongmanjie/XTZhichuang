// API测试脚本
const BASE = 'http://localhost:3001/api'

async function test() {
  // 1. 登录
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '18008643374', password: process.env.TEST_PWD }),
  })
  const loginData = await loginRes.json()
  console.log('1. 登录:', loginData.code === 0 ? '✓ 成功' : '✗ 失败 ' + loginData.message)
  const token = loginData.data?.token
  if (!token) return
  const auth = { Authorization: `Bearer ${token}` }

  // 2. 用户信息
  const infoRes = await (await fetch(`${BASE}/user/info`, { headers: auth })).json()
  console.log('2. 用户信息:', infoRes.code === 0 ? `✓ ${infoRes.data.name} | 点数:${infoRes.data.ai_points}` : '✗')

  // 3. 素材列表
  const matRes = await (await fetch(`${BASE}/material/list?pageNum=1&pageSize=5`, { headers: auth })).json()
  console.log('3. 素材列表:', matRes.code === 0 ? `✓ 共${matRes.data.total}条` : '✗')

  // 4. 素材搜索
  const searchRes = await (await fetch(`${BASE}/material/list?keyword=口红`, { headers: auth })).json()
  console.log('4. 素材搜索(口红):', searchRes.code === 0 ? `✓ 命中${searchRes.data.total}条` : '✗')

  // 5. 爆款视频
  const hotRes = await (await fetch(`${BASE}/hot/list?pageSize=5`, { headers: auth })).json()
  console.log('5. 爆款视频:', hotRes.code === 0 ? `✓ 共${hotRes.data.total}条` : '✗')

  // 6. 脚本列表
  const scriptRes = await (await fetch(`${BASE}/script/list?pageSize=5`, { headers: auth })).json()
  console.log('6. 脚本列表:', scriptRes.code === 0 ? `✓ 共${scriptRes.data.total}条` : '✗')

  // 7. 智能剪辑项目
  const mixRes = await (await fetch(`${BASE}/ai-mix/list`, { headers: auth })).json()
  console.log('7. 智能剪辑项目:', mixRes.code === 0 ? `✓ 共${mixRes.data.total}个` : '✗')

  // 8. 广告数据
  const adRes = await (await fetch(`${BASE}/ad/launch/data/overview`, { headers: auth })).json()
  console.log('8. 投放数据总览:', adRes.code === 0 ? `✓ 总消耗:¥${adRes.data.total.cost?.toFixed(0)}` : '✗')

  // 9. 团队列表
  const teamRes = await (await fetch(`${BASE}/team/member/list`, { headers: auth })).json()
  console.log('9. 团队成员:', teamRes.code === 0 ? `✓ 共${teamRes.data.total}人` : '✗')

  // 10. 角色列表
  const roleRes = await (await fetch(`${BASE}/role/list`, { headers: auth })).json()
  console.log('10. 角色列表:', roleRes.code === 0 ? `✓ ${roleRes.data.length}个角色` : '✗')

  // 11. 创建AI任务（视频解析）
  const taskRes = await (await fetch(`${BASE}/create/analysis`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareUrl: 'https://v.douyin.com/abc123' }),
  })).json()
  console.log('11. 创建AI解析任务:', taskRes.code === 0 ? `✓ ${taskRes.data.task_no} (${taskRes.data.status})` : '✗ ' + taskRes.message)

  // 12. 任务列表
  const taskListRes = await (await fetch(`${BASE}/task/list`, { headers: auth })).json()
  console.log('12. AI任务列表:', taskListRes.code === 0 ? `✓ 共${taskListRes.data.total}个` : '✗')

  // 13. 充值套餐
  const pkgRes = await (await fetch(`${BASE}/charge/packages`, { headers: auth })).json()
  console.log('13. 充值套餐:', pkgRes.code === 0 ? `✓ ${pkgRes.data.length}个套餐` : '✗')

  // 14. Agent技能
  const skillRes = await (await fetch(`${BASE}/skills`, { headers: auth })).json()
  console.log('14. Agent技能:', skillRes.code === 0 ? `✓ ${skillRes.data.length}个技能` : '✗')

  // 15. 消费记录
  const consRes = await (await fetch(`${BASE}/setting/consumption/list`, { headers: auth })).json()
  console.log('15. 消费记录:', consRes.code === 0 ? `✓ 共${consRes.data.total}条` : '✗')

  console.log('\n=== 测试完成 ===')
}

test().catch(console.error)
