import fs from 'fs'
import { localMediaPath } from './mediaTools.js'

export function embeddingProvider() {
  return (process.env.EMBEDDING_PROVIDER || 'modelgate').trim().toLowerCase()
}

export function supportsImageEmbeddings() {
  return embeddingProvider() === 'direct'
}

function directEndpoint() {
  const raw = process.env.EMBEDDING_DIRECT_BASE_URL || ''
  if (!raw) throw new Error('原版多模态向量服务地址尚未配置')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('原版多模态向量服务地址无效')
  }
  const base = raw.replace(/\/+$/, '')
  return base.endsWith('/v1') ? base + '/embeddings' : base + '/v1/embeddings'
}

async function requestEmbeddings(body, expected) {
  const timeout = Math.min(120000, Math.max(5000, Number(process.env.EMBEDDING_TIMEOUT_MS) || 60000))
  let response
  try {
    response = await fetch(directEndpoint(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? '多模态向量服务超时' : '多模态向量服务无法连接')
  }
  let data
  try { data = await response.json() } catch { throw new Error('多模态向量服务返回了无效数据') }
  if (!response.ok) throw new Error('多模态向量服务返回 HTTP ' + response.status)
  const entries = Array.isArray(data.data) ? [...data.data].sort((a, b) => (a.index || 0) - (b.index || 0)) : []
  const dims = Number(process.env.EMBED_DIMS || 2048)
  if (entries.length !== expected || entries.some((item) => !Array.isArray(item.embedding) || item.embedding.length !== dims || item.embedding.some((x) => !Number.isFinite(x)))) {
    throw new Error('多模态向量结果数量或维度不正确')
  }
  return entries.map((item) => item.embedding)
}

export async function directEmbedTexts(texts) {
  const list = Array.isArray(texts) ? texts : [texts]
  if (!list.length || list.length > 64 || list.some((text) => typeof text !== 'string' || !text.trim() || text.length > 4000)) {
    throw new Error('向量化文本须为 1–64 条非空文本，每条不超过 4000 字')
  }
  return requestEmbeddings({ model: process.env.EMBEDDING_DIRECT_MODEL || 'qwen3-vl-embedding-2b', input: list, encoding_format: 'float' }, list.length)
}

export async function directEmbedImage(url) {
  const imagePath = localMediaPath(url)
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('图片素材不存在')
  const size = fs.statSync(imagePath).size
  if (!size || size > 10 * 1024 * 1024) throw new Error('图片向量化仅支持 10 MB 内的图片')
  const data = fs.readFileSync(imagePath)
  let mime = ''
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) mime = 'image/jpeg'
  else if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png'
  else if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp'
  if (!mime) throw new Error('图片向量化仅支持 JPEG、PNG 或 WebP')
  const messages = [
    { role: 'system', content: 'Represent the user input for retrieval.' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + data.toString('base64') } }] },
  ]
  const [vector] = await requestEmbeddings({ model: process.env.EMBEDDING_DIRECT_MODEL || 'qwen3-vl-embedding-2b', messages, encoding_format: 'float' }, 1)
  return vector
}
