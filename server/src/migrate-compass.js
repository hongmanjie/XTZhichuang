/**
 * 一次性迁移：重建数据罗盘视频数据（去重 + 中文平台 + 分类封面 + AI分析）
 * 运行：node src/migrate-compass.js
 */
import db from './db.js'
import { seedCompass } from './compass-data.js'

const mainUserId = db.prepare("SELECT id FROM users WHERE account = '18008643374'").get()?.id || 1
const n = seedCompass(db, mainUserId)
const sample = db.prepare('SELECT id, title, platform, category, cover FROM compass_videos LIMIT 3').all()
console.log(`✓ 罗盘数据重建完成，共 ${n} 条（已去重，封面已生成）`)
console.log(sample)
process.exit(0)
