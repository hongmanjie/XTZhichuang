// ============================================================
// 团队数据域：解决素材/脚本/作品等资源的可见性与管理权限
// 可见范围（团队域）：自己 + 自己创建的成员 + 上级 + 同组成员
// 管理权限（改/删）：本人 或 本人创建的成员（主管可管理下属资源）
// ============================================================
import db from '../db.js'

// 返回当前用户可见的 owner_id 集合
export function teamUserIds(userId) {
  const me = db.prepare('SELECT id, created_by FROM users WHERE id = ?').get(userId)
  if (!me) return [userId]
  const bossId = me.created_by ?? -1
  const rows = db.prepare(
    'SELECT id FROM users WHERE id = ? OR created_by = ? OR id = ? OR (created_by IS NOT NULL AND created_by = ?)',
  ).all(userId, userId, bossId, bossId)
  return rows.map((r) => r.id)
}

// 生成 SQL 片段：column IN (?,?,...) 及对应参数
export function teamCond(userId, column = 'owner_id') {
  const ids = teamUserIds(userId)
  return { clause: `${column} IN (${ids.map(() => '?').join(',')})`, args: ids }
}

// 是否可管理（修改/删除）某资源：本人资源，或资源归属自己创建的成员
export function canManage(userId, ownerId) {
  if (ownerId == null) return false
  if (Number(ownerId) === Number(userId)) return true
  const owner = db.prepare('SELECT created_by FROM users WHERE id = ?').get(ownerId)
  return owner?.created_by != null && Number(owner.created_by) === Number(userId)
}

// 从一批行中筛出可管理的 id；返回 { allowed, denied }
export function splitManageable(userId, rows) {
  const allowed = []
  const denied = []
  for (const r of rows) (canManage(userId, r.owner_id) ? allowed : denied).push(r.id)
  return { allowed, denied }
}
