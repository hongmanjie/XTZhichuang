// Populate the currently configured index namespace without deleting or overwriting existing documents.
import db from './db.js'
import { esClient, initES, indexDoc, INDICES } from './services/esService.js'

const safeTags = (value) => { try { return JSON.parse(value || '[]') } catch { return [] } }
const sources = {
  materials: db.prepare('SELECT * FROM materials WHERE status = 1 ORDER BY id').all().map((m) => ({
    id: m.id, name: m.name, type: m.type, category: m.category, tags: safeTags(m.tags),
    url: m.url, cover: m.cover, size: m.size, duration: m.duration, width: m.width,
    height: m.height, source: m.source, owner_id: m.owner_id, created_at: m.created_at,
  })),
  scripts: db.prepare('SELECT * FROM scripts ORDER BY id').all().map((s) => ({
    id: s.id, title: s.title, content: s.content, product_name: s.product_name,
    category: s.category, status: s.status, owner_id: s.owner_id, owner_name: s.owner_name, created_at: s.created_at,
  })),
  hot: db.prepare('SELECT * FROM hot_videos ORDER BY id').all().map((h) => ({
    id: h.id, title: h.title, platform: h.platform, author: h.author, category: h.category,
    likes: h.likes, comments: h.comments, shares: h.shares, published_at: h.published_at,
  })),
}

try {
  if (!await initES()) throw new Error('Elasticsearch 不可用或索引维度不匹配；未执行重建')
  let failed = 0
  for (const [kind, docs] of Object.entries(sources)) {
    let done = 0
    for (const doc of docs) {
      if (await indexDoc(kind, doc, { onlyIfMissing: true })) done++
      else failed++
    }
    console.log(kind + ': ' + done + '/' + docs.length + ' -> ' + INDICES[kind])
  }
  if (failed) process.exitCode = 1
} finally {
  await esClient.close()
  db.close()
}
