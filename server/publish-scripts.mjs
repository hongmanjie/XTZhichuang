/**
 * 生产内容发布器：把 ModelGate 批量产出的电商分镜/脚本/文案
 * 写入 scripts 表，使其在 Web「我的脚本」页可见。
 *
 * 用法： node server/publish-scripts.mjs [源文件] [最多条数]
 * 特性：幂等（按 title 唯一标记去重），只发布 ok=true 且评分达标的内容。
 */
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

const SRC = process.argv[2] || path.resolve('..', 'docs/tests/mg-scale1000.jsonl')
const MAX = Number(process.argv[3] || 0)
const MIN_SCORE = Number(process.env.MIN_SCORE || 3)
const TAG = '[MG批量]'

const db = new Database(path.resolve('data/yimetai.db'))
db.pragma('journal_mode = WAL')

const ins = db.prepare(`INSERT INTO scripts
  (title, content, product_name, category, status, word_count, owner_id, owner_name)
  VALUES (?,?,?,?,?,?,?,?)`)
const exists = db.prepare('SELECT COUNT(*) c FROM scripts WHERE title = ?')

const raw = fs.existsSync(SRC) ? fs.readFileSync(SRC, 'utf8') : ''
const rows = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const good = rows.filter((r) => r.ok && (r.score || 0) >= MIN_SCORE && (r.text || '').length > 200)

const targets = MAX > 0 ? good.slice(0, MAX) : good
let inserted = 0, skipped = 0

const TYPE_LABEL = { storyboard: '分镜', script: '脚本', copy: '文案', scene: '场景', vprompt: '视频提示词' }

for (const r of targets) {
  const typeCn = TYPE_LABEL[r.type] || r.type
  const title = `${TAG}${r.product}·${typeCn}·${r.platform}·${r.duration || ''}·#${r.id}`
  if (exists.get(title).c > 0) { skipped++; continue }
  ins.run(title, r.text, r.product, `${typeCn}/${r.cat || ''}`, 'published',
    r.chars || r.text.length, 1, '小兴')
  inserted++
}

const total = db.prepare('SELECT COUNT(*) c FROM scripts').get().c
const tagged = db.prepare("SELECT COUNT(*) c FROM scripts WHERE title LIKE '" + TAG + "%'").get().c

console.log(JSON.stringify({
  源文件: path.basename(SRC),
  总生产: rows.length,
  合格: good.length,
  本次新增: inserted,
  已存在跳过: skipped,
  'Web脚本库总数': total,
  '其中本批次': tagged,
}, null, 2))
