// 新模块 API 全面测试
const BASE = 'http://127.0.0.1:3001'
let token = ''
let passed = 0
let failed = 0

async function req(method, path, body) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return r.json()
}

async function test(name, fn) {
  try {
    const ok = await fn()
    if (ok) {
      passed++
      console.log(`✓ ${name}`)
    } else {
      failed++
      console.log(`✗ ${name}`)
    }
  } catch (e) {
    failed++
    console.log(`✗ ${name} -> ${e.message}`)
  }
}

async function main() {
  // 登录
  const login = await req('POST', '/login', { account: 'demo-admin', password: process.env.TEST_PWD })
  if (login.code !== 0) {
    console.error('登录失败:', login.message)
    process.exit(1)
  }
  token = login.data.token
  console.log('=== 登录成功，开始测试新模块 ===\n')

  // ===== 工作台/看板 =====
  await test('工作台初始化', async () => (await req('GET', '/workbench/data/init/new')).code === 0)
  await test('看板-数据简报', async () => (await req('GET', '/data/board/config/briefing')).code === 0)
  await test('看板-消耗趋势', async () => {
    const d = await req('GET', '/data/board/config/trend')
    return d.code === 0 && d.data.list.length === 14
  })
  await test('看板-核心指标', async () => (await req('GET', '/data/board/config/core')).code === 0)
  await test('看板-创作排行', async () => (await req('GET', '/data/board/config/ranking')).code === 0)
  await test('看板-目标完成度', async () => (await req('GET', '/data/board/config/target')).code === 0)
  await test('看板-优秀作品', async () => (await req('GET', '/data/board/config/excellent/works')).code === 0)
  await test('看板-快捷功能', async () => (await req('GET', '/data/board/config/function')).code === 0)
  await test('新用户任务列表', async () => {
    const d = await req('GET', '/new/user/reward/task/list')
    return d.code === 0 && d.data.list.length === 5
  })
  await test('新用户引导状态', async () => (await req('GET', '/new/user/reward/is/show/guide')).code === 0)
  await test('行为上报', async () => (await req('POST', '/behavior/report', { action: 'test', target: 'api-test' })).code === 0)

  // ===== 消息中心 =====
  await test('消息列表', async () => {
    const d = await req('GET', '/message/center/list/info')
    return d.code === 0 && d.data.list.length > 0
  })
  await test('未读消息数', async () => {
    const d = await req('GET', '/message/center/unread/message')
    return d.code === 0 && typeof d.data.unread === 'number'
  })
  await test('消息详情+已读', async () => {
    const list = await req('GET', '/message/center/list/info')
    const id = list.data.list[0].id
    const d = await req('GET', `/message/center/query/body?id=${id}`)
    return d.code === 0 && d.data.isRead === true
  })
  await test('批量已读', async () => {
    const list = await req('GET', '/message/center/list/info')
    const ids = list.data.list.slice(0, 2).map((m) => m.id)
    return (await req('POST', '/message/center/message/batch', { ids })).code === 0
  })

  // ===== 任务中心 =====
  await test('任务中心未读数', async () => (await req('GET', '/task/center/unread/count')).code === 0)
  await test('任务中心列表', async () => (await req('GET', '/task/center/upload/page')).code === 0)

  // ===== 精彩片段 =====
  await test('精彩片段初始化', async () => (await req('GET', '/highlight/editing/init')).code === 0)
  await test('精彩片段概览', async () => (await req('GET', '/highlight/editing/task/overview')).code === 0)
  await test('创建剪辑任务', async () => {
    const d = await req('POST', '/highlight/editing/task/create', { name: '测试直播剪辑', sourceType: 'live' })
    return d.code === 0 && d.data.id > 0
  })
  await test('剪辑任务列表', async () => (await req('GET', '/highlight/editing/task/list')).code === 0)

  // ===== 三秒完播 =====
  await test('三秒完播分类', async () => {
    const d = await req('GET', '/three/second/category/list')
    return d.code === 0 && d.data.list.length > 0
  })
  await test('三秒完播案例', async () => (await req('GET', '/three/second/demo/list')).code === 0)
  await test('三秒完播创作', async () => {
    const d = await req('POST', '/three/second/make/video', { name: '测试三秒完播', category: 'ecommerce', hookType: 'pain' })
    return d.code === 0 && d.data.id > 0
  })

  // ===== 高清视频 =====
  await test('高清修复配置', async () => (await req('GET', '/super/resolution/init/info/new')).code === 0)
  await test('创建修复任务', async () => {
    const d = await req('POST', '/super/resolution/create/new', { name: '测试修复', sourceUrl: 'https://example.com/v.mp4', mode: 'standard' })
    return d.code === 0
  })
  await test('修复任务列表', async () => (await req('GET', '/super/resolution/task/list')).code === 0)

  // ===== 视频解析 =====
  await test('提交解析任务', async () => {
    const d = await req('POST', '/video/scene/analysis/submit', { videoUrl: 'https://example.com/v.mp4', name: '测试解析' })
    return d.code === 0 && d.data.id > 0
  })
  await test('解析任务列表', async () => (await req('GET', '/video/scene/analysis/list')).code === 0)

  // ===== 消除笔 =====
  await test('消除笔提交', async () => {
    const d = await req('POST', '/tools/erase/submit', { imageUrl: 'https://example.com/i.png', maskPoints: [{ x: 1, y: 2 }] })
    return d.code === 0
  })
  await test('消除笔记录', async () => (await req('GET', '/tools/erase/task/list')).code === 0)

  // ===== 音乐库 =====
  await test('音乐分类', async () => {
    const d = await req('GET', '/music/category/list')
    return d.code === 0 && d.data.list.length > 0
  })
  await test('音乐列表', async () => {
    const d = await req('GET', '/music/list/info')
    return d.code === 0 && d.data.list.length >= 10
  })
  await test('按分类查音乐', async () => (await req('GET', '/music/list/by/category?category=trend')).code === 0)

  // ===== 数据罗盘 =====
  await test('罗盘配置', async () => (await req('GET', '/data/compass/video/init/config')).code === 0)
  await test('罗盘视频列表', async () => {
    const d = await req('GET', '/data/compass/video/list/info')
    return d.code === 0 && d.data.total >= 6
  })
  await test('罗盘链接解析', async () => (await req('POST', '/data/compass/video/query/url', { url: 'https://v.douyin.com/xxx' })).code === 0)

  // ===== 会员/脚本海/项目 =====
  await test('会员套餐', async () => {
    const d = await req('GET', '/member/order/page/init')
    return d.code === 0 && d.data.packages.length === 3
  })
  await test('创建会员订单', async () => (await req('POST', '/member/order/create/order', { packageId: 2, packageName: '创业会员', amount: 79 })).code === 0)
  await test('脚本海列表', async () => {
    const d = await req('GET', '/script/sea/info/list')
    return d.code === 0 && d.data.total >= 6
  })
  await test('脚本海详情', async () => {
    const list = await req('GET', '/script/sea/info/list')
    return (await req('GET', `/script/sea/detail/info?id=${list.data.list[0].id}`)).code === 0
  })
  await test('我的项目', async () => {
    const d = await req('GET', '/my/project/script/init')
    return d.code === 0 && d.data.list.length >= 3
  })

  // ===== 合作伙伴 =====
  await test('提现初始化', async () => {
    const d = await req('GET', '/withdraw/init')
    return d.code === 0 && typeof d.data.balance === 'number'
  })
  await test('邀请列表', async () => (await req('GET', '/withdraw/page/init')).code === 0)
  await test('提现记录', async () => (await req('GET', '/withdraw/withdrawal/log')).code === 0)
  await test('提现申请', async () => (await req('POST', '/withdraw/submit', { amount: 200, account: 'test@test.com' })).code === 0)

  // ===== 数字人形象/商拍模板 =====
  await test('数字人形象库', async () => {
    const d = await req('GET', '/ip/avatar/filter/List')
    return d.code === 0 && d.data.list.length >= 4
  })
  await test('商拍模板列表', async () => {
    const d = await req('GET', '/ai/commerce/photo/template/list/v2')
    return d.code === 0 && d.data.total >= 6
  })
  await test('商拍方向列表', async () => (await req('GET', '/ai/commerce/photo/template/generate/direction/list')).code === 0)

  // ===== AI脚本分镜 =====
  await test('脚本分镜列表', async () => {
    const scripts = await req('GET', '/script/list')
    const d = await req('GET', `/ai/script/subitem/list?scriptId=${scripts.data.list[0].id}`)
    return d.code === 0
  })
  await test('AI生成分镜', async () => {
    const scripts = await req('GET', '/script/list')
    const d = await req('POST', '/ai/script/intelligent/generation', { scriptId: scripts.data.list[0].id, productName: '口红' })
    return d.code === 0 && d.data.count === 5
  })
  await test('分镜生成后列表', async () => {
    const scripts = await req('GET', '/script/list')
    const d = await req('GET', `/ai/script/subitem/list?scriptId=${scripts.data.list[0].id}`)
    return d.code === 0 && d.data.list.length === 5
  })
  await test('AI口播文案生成', async () => {
    const d = await req('POST', '/ai/script/dictate/script/generation', { productName: '口红' })
    return d.code === 0 && d.data.content.length > 50
  })

  // ===== 反馈 =====
  await test('反馈提交', async () => (await req('POST', '/video/montage/feedback/submit', { type: '功能建议', content: '测试反馈内容' })).code === 0)

  console.log(`\n========== 测试结果: ${passed} 通过, ${failed} 失败 ==========`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('测试执行异常:', e)
  process.exit(1)
})
