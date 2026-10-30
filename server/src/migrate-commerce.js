/**
 * 一次性迁移：商用化套餐体系 + 用户会员字段
 * 只刷新 point_packages 表与 users 会员字段，不清空业务数据
 * 运行：node src/migrate-commerce.js
 */
import db from './db.js'

const packages = [
  // ---- 个人版会员 ----
  { name: '个人版-月会员', type: 'member_personal', period: '1月', points: 0, price: 98, original: 140, tag: '', sort: 1,
    bonus: 180, unit: 'AI点单价：0.55元', expect: '预计导出视频：60条', discount: '限时7折',
    benefits: JSON.stringify(['存储空间：10GB', '爆款速递', '字幕去除', 'AI素材场：XingTu-2.0 Pro 低至7折', 'AI素材场：XingTu-2.5 低至5折', '批量智能混剪', '智能脚本', '脚本公海', '画质增强']) },
  { name: '个人版-年度会员', type: 'member_personal', period: '1年', points: 0, price: 875, original: 1250, tag: '最受欢迎', sort: 2,
    bonus: 2160, unit: 'AI点单价：0.4元', expect: '预计导出视频：720条', discount: '限时7折',
    benefits: JSON.stringify(['存储空间：150GB', 'AI素材场：XingTu-2.0 Pro 低至7折', 'AI素材场：XingTu-2.5 低至5折', 'AI梦工厂 会员享9折', '批量智能混剪', '爆款速递', '字幕去除', '高光智剪', 'IP形象库', '视频解析', '爆款创作', '爆款复刻Agent']) },
  // ---- 企业版会员 ----
  { name: '企业版-月会员', type: 'member_enterprise', period: '1月', points: 0, price: 498, original: 998, tag: '', sort: 3,
    bonus: 1000, unit: 'AI点单价：0.42元', expect: '预计导出视频：500条', discount: '低至5折',
    benefits: JSON.stringify(['存储空间：500GB', '企业人数：10席', '团队协作空间', 'AI素材场：XingTu-2.5 低至4.5折', '专属客服通道', '批量智能混剪', '全部个人版权益']) },
  { name: '企业版-年度会员', type: 'member_enterprise', period: '1年', points: 0, price: 4980, original: 9980, tag: '团队首选', sort: 4,
    bonus: 15000, unit: 'AI点单价：0.32元', expect: '预计导出视频：6000条', discount: '低至5折',
    benefits: JSON.stringify(['存储空间：2TB', '企业人数：50席', '专属客户成功经理', 'API 开放平台接入', 'AI素材场：XingTu-2.5 低至4折', '全部个人版权益', '私有化素材隔离']) },
  // ---- AI点充值 ----
  { name: '体验包', type: 'points', points: 1000, price: 9.9, original: 19.9, tag: '新用户专享', sort: 10, bonus: 0, unit: 'AI点单价：0.0099元' },
  { name: '基础包', type: 'points', points: 5000, price: 39.9, original: 59.9, tag: '', sort: 11, bonus: 0, unit: 'AI点单价：0.008元' },
  { name: '热门包', type: 'points', points: 12000, price: 89.9, original: 129.9, tag: '最受欢迎', sort: 12, bonus: 0, unit: 'AI点单价：0.0075元' },
  { name: '专业包', type: 'points', points: 30000, price: 199.9, original: 299.9, tag: '超值优惠', sort: 13, bonus: 0, unit: 'AI点单价：0.0067元' },
  { name: '企业包', type: 'points', points: 100000, price: 599.9, original: 999.9, tag: '团队首选', sort: 14, bonus: 0, unit: 'AI点单价：0.006元' },
  // ---- 拓展包 ----
  { name: '存储拓展包 100GB', type: 'extension', points: 0, price: 68, original: 98, tag: '', sort: 20, bonus: 0, unit: '有效期：1年' },
  { name: '团队席位包 +5席', type: 'extension', points: 0, price: 128, original: 188, tag: '', sort: 21, bonus: 0, unit: '有效期：1年' },
  { name: '数字人克隆音色', type: 'extension', points: 2000, price: 198, original: 398, tag: '新功能', sort: 22, bonus: 0, unit: '含音色训练1次' },
]

const migrate = db.transaction(() => {
  // 1. 刷新套餐表
  db.prepare('DELETE FROM point_packages').run()
  const insertPkg = db.prepare(`INSERT INTO point_packages (name, type, period, points, bonus_points, price, original_price, tag, discount_tag, unit_price, expect_videos, benefits, sort)
    VALUES (@name, @type, @period, @points, @bonus, @price, @original, @tag, @discount, @unit, @expect, @benefits, @sort)`)
  packages.forEach((p) => {
    insertPkg.run({
      name: p.name, type: p.type, period: p.period || null, points: p.points, bonus: p.bonus || 0,
      price: p.price, original: p.original, tag: p.tag || null, discount: p.discount || null,
      unit: p.unit || null, expect: p.expect || null, benefits: p.benefits || null, sort: p.sort,
    })
  })

  // 2. 主账号补体验会员（vip_level 缺省或有效期为空时补齐）
  db.prepare(`UPDATE users SET vip_level = 'trial' WHERE account = 'demo-admin' AND (vip_level IS NULL OR vip_level = '')`).run()
  db.prepare(`UPDATE users SET vip_expire_at = datetime('now', 'localtime', '+7 day')
    WHERE account = 'demo-admin' AND vip_level = 'trial' AND (vip_expire_at IS NULL OR vip_expire_at = '')`).run()
})

migrate()
const count = db.prepare('SELECT COUNT(*) c FROM point_packages').get().c
const vip = db.prepare("SELECT account, vip_level, vip_expire_at FROM users WHERE account = 'demo-admin'").get()
console.log(`✓ 套餐迁移完成，共 ${count} 个套餐`)
console.log('✓ 主账号会员状态：', vip)
process.exit(0)
