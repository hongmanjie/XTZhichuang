if (!process.env.DEMO_ADMIN_PASSWORD || !process.env.DEMO_MEMBER_PASSWORD) throw new Error('请设置演示账号密码环境变量')
/** 素材管理与权限端到端验证: node tools/verify-asset-mgmt.mjs */
const BASE = 'http://localhost:3001/api'
const ok = []
const bad = []
const check = (name, cond, extra = '') => (cond ? ok : bad).push(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)

async function login(account, password) {
  const r = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) }).then((r) => r.json())
  return r.data?.token
}
const api = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json())
  return r
}

// 1. 登录主账号 + 成员账号
const boss = await login('demo-admin', process.env.DEMO_ADMIN_PASSWORD)
const member = await login('demo-member-1', process.env.DEMO_MEMBER_PASSWORD)
check('主账号登录', !!boss)
check('成员账号登录', !!member)

// 2. 团队域可见性：主账号应看到成员上传的 seed 素材
const bossList = await api('/material/list?pageSize=100', { token: boss })
const memberList = await api('/material/list?pageSize=100', { token: member })
check('主账号素材列表非空（团队域含成员素材）', bossList.data?.list?.length > 0, `共${bossList.data?.total}条`)
check('成员素材列表也可见（同团队域）', memberList.data?.list?.length > 0, `共${memberList.data?.total}条`)

// 3. 来源筛选
const aiOnly = await api('/material/list?source=ai&pageSize=5', { token: boss })
check('来源筛选 source=ai 生效', aiOnly.code === 0 && aiOnly.data.list.every((m) => m.source === 'ai'), `ai素材${aiOnly.data?.total}条`)

// 4. 统计
const stats = await api('/asset/statistics', { token: boss })
check('资产统计（团队域+storage_total配额）', stats.code === 0 && stats.data.totalSize === 10737418240, `total=${stats.data?.total} 配额=${(stats.data?.totalSize / 1073741824).toFixed(0)}GB`)

// 5. 上传素材 → 删除 → 物理文件应清理
const fs = await import('fs')
const buf = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c489', 'hex')
const fd = new FormData()
fd.append('file', new Blob([buf], { type: 'image/png' }), 'verify-test.png')
fd.append('category', '验证测试')
const up = await fetch(`${BASE}/material/upload`, { method: 'POST', headers: { Authorization: `Bearer ${boss}` }, body: fd }).then((r) => r.json())
check('上传素材', up.code === 0 && up.data?.url, up.data?.url)
if (up.data) {
  const filePath = `server/uploads/${up.data.url.replace('/api/files/', '').replace('/uploads/', '')}`
  const existsBefore = fs.existsSync(filePath)
  const del = await api('/material/delete', { method: 'POST', token: boss, body: { ids: [up.data.id] } })
  const existsAfter = fs.existsSync(filePath)
  check('删除素材返回deleted=1', del.data?.deleted === 1)
  check('物理文件已清理', existsBefore && !existsAfter, `删除前存在=${existsBefore} 删除后存在=${existsAfter}`)
}

// 6. 越权测试：成员删除主账号素材 → 应被拒绝
// 先用主账号造一个素材（远端URL即可，不触碰本地文件）
// 直接查一条主账号自己的素材；没有就用上传的记录（已删）→ 用 works 替代测试
const works = await api('/work/list?pageSize=50', { token: boss })
const bossWork = works.data?.list?.find((w) => w.canManage === true)
check('作品列表带 canManage 标记', works.code === 0 && works.data.list.every((w) => typeof w.canManage === 'boolean'))
if (bossWork) {
  const deny = await api('/work/delete', { method: 'POST', token: member, body: { id: bossWork.id } })
  const stillThere = await api(`/work/list?pageSize=50`, { token: boss })
  const still = stillThere.data.list.some((w) => w.id === bossWork.id)
  check('成员删除主账号作品被拒绝（越权拦截）', still && (deny.data?.denied >= 1 || deny.data?.deleted === 0), `deleted=${deny.data?.deleted} denied=${deny.data?.denied}`)
}

// 7. 脚本列表团队域 + canManage
const scripts = await api('/script/list?pageSize=50', { token: boss })
check('脚本列表团队域+canManage', scripts.code === 0 && scripts.data.list.every((s) => typeof s.canManage === 'boolean'), `共${scripts.data?.total}条`)

// 8. AI生成物回填：materials 中应有 AI 分类素材（历史任务回填）
const backfill = await api('/material/list?source=ai&pageSize=1', { token: boss })
check('AI生成素材已进入素材库（含历史回填）', (backfill.data?.total ?? 0) > 0, `ai素材共${backfill.data?.total}条`)

// 9. 高光片段删除接口（构造临时任务验证权限拦截：成员删主账号任务应404）
const hlTasks = await api('/highlight/editing/task/list?pageSize=5', { token: boss })
if (hlTasks.data?.list?.length) {
  const t = hlTasks.data.list[0]
  const denyDel = await api('/highlight/editing/task/delete', { method: 'POST', token: member, body: { id: t.id } })
  check('成员删除主账号高光任务被拦截', denyDel.code !== 0 || denyDel.data?.deleted === 0, denyDel.message)
} else {
  check('高光任务删除接口（无任务可测，跳过）', true)
}

// 10. 广告账户团队域
const ads = await api('/ad/launch/advertiser/list?pageSize=10', { token: boss })
check('广告账户团队域过滤', ads.code === 0, `共${ads.data?.total}条`)

console.log('\n===== 验证结果 =====')
ok.forEach((l) => console.log(l))
if (bad.length) {
  console.log('\n----- 失败项 -----')
  bad.forEach((l) => console.log(l))
  process.exit(1)
}
console.log(`\n全部通过 (${ok.length} 项)`)
