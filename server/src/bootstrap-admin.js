// One-time initialization for an empty deployment; never modifies an existing user database.
import bcrypt from 'bcryptjs'
import db from './db.js'

const account = String(process.env.BOOTSTRAP_ADMIN_ACCOUNT || '').trim()
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || ''
if (!account || account.length > 64 || password.length < 12) {
  console.error('Set BOOTSTRAP_ADMIN_ACCOUNT and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.')
  process.exitCode = 1
} else if (db.prepare('SELECT COUNT(*) n FROM users').get().n !== 0) {
  console.error('Database already has users; refusing to initialize or replace accounts.')
  process.exitCode = 1
} else {
  const passwordHash = await bcrypt.hash(password, 12)
  db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n !== 0) throw new Error('Database is no longer empty')
    db.prepare("INSERT OR IGNORE INTO roles (id, name, code, permissions, is_default) VALUES (1, '管理员', 'admin', '[]', 1)").run()
    db.prepare('INSERT INTO users (account, password, name, role_id, ai_points) VALUES (?, ?, ?, 1, 0)').run(account, passwordHash, '管理员')
  }).immediate()
  console.log('Initial administrator created. No sample data was added.')
}
db.close()
