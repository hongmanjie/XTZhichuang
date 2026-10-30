// ES搜索功能测试
const BASE = 'http://localhost:3001/api'

async function test() {
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '18008643374', password: process.env.TEST_PWD }),
  })
  const loginData = await loginRes.json()
  const token = loginData.data?.token
  const auth = { Authorization: `Bearer ${token}` }
  console.log('登录:', loginData.code === 0 ? '✓' : '✗')

  // 1. ES状态
  const esRes = await (await fetch(`${BASE}/es/status`)).json()
  console.log('1. ES状态:', esRes.data.available ? '✓ 已连接' : '✗ 未连接')

  // 2. 素材中文分词搜索
  const r2 = await (await fetch(`${BASE}/material/list?keyword=口红`, { headers: auth })).json()
  console.log('2. 素材搜索"口红":', r2.code === 0 ? `✓ 命中${r2.data.total}条 (ES检索)` : '✗')

  // 3. 素材搜索"面膜"
  const r3 = await (await fetch(`${BASE}/material/list?keyword=面膜`, { headers: auth })).json()
  console.log('3. 素材搜索"面膜":', r3.code === 0 ? `✓ 命中${r3.data.total}条` : '✗')

  // 4. 脚本全文搜索
  const r4 = await (await fetch(`${BASE}/script/list?keyword=口红`, { headers: auth })).json()
  console.log('4. 脚本搜索"口红":', r4.code === 0 ? `✓ 命中${r4.data.total}条` : '✗')

  // 5. 爆款视频搜索
  const r5 = await (await fetch(`${BASE}/hot/list?keyword=面膜`, { headers: auth })).json()
  console.log('5. 爆款搜索"面膜":', r5.code === 0 ? `✓ 命中${r5.data.total}条` : '✗')

  // 6. 爆款视频搜索"护肤"
  const r6 = await (await fetch(`${BASE}/hot/list?keyword=护肤`, { headers: auth })).json()
  console.log('6. 爆款搜索"护肤":', r6.code === 0 ? `✓ 命中${r6.data.total}条` : '✗')

  // 7. 组合筛选：视频类型 + 关键词
  const r7 = await (await fetch(`${BASE}/material/list?keyword=口红&type=video`, { headers: auth })).json()
  console.log('7. 组合筛选(口红+视频):', r7.code === 0 ? `✓ 命中${r7.data.total}条` : '✗')

  // 8. 模糊搜索（错别字容错）
  const r8 = await (await fetch(`${BASE}/material/list?keyword=口红红`, { headers: auth })).json()
  console.log('8. 模糊搜索"口红红":', r8.code === 0 ? `✓ 命中${r8.data.total}条(fuzziness)` : '✗')

  console.log('\n=== ES搜索测试完成 ===')
}

test().catch(console.error)
