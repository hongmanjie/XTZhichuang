// ============================================================
// Elasticsearch 检索服务
//  - BM25 关键词检索（IK 分词，缺失时降级 standard）
//  - 语义向量检索（ModelGate qwen3-vl-embedding → dense_vector kNN）
//  - 混合召回（BM25 + kNN should 融合）+ Rerank 精排（ModelGate 优先）
//  - ES 不可用时由调用方降级 SQLite
// ============================================================
import { Client } from '@elastic/elasticsearch'
import { realEnabled, EMBED_DIMS, embedTexts, embedQuery, rerankDocs } from './aiProviders.js'

const ES_NODE = process.env.ES_NODE || 'http://localhost:9200'

export const esClient = new Client({ node: ES_NODE })

export const INDICES = {
  materials: process.env.ES_INDEX_MATERIALS || 'yimetai_materials',
  scripts: process.env.ES_INDEX_SCRIPTS || 'yimetai_scripts',
  hot: process.env.ES_INDEX_HOT || 'yimetai_hot_videos',
}

const EMBED_FIELD = 'embedding'

// 索引 mappings（含语义向量字段）
const MAPPINGS = {
  materials: {
    properties: {
      id: { type: 'integer' },
      name: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart', fields: { keyword: { type: 'keyword' } } },
      type: { type: 'keyword' },
      category: { type: 'keyword' },
      tags: { type: 'keyword' },
      desc: { type: 'text', analyzer: 'ik_max_word' },
      url: { type: 'keyword', index: false },
      cover: { type: 'keyword', index: false },
      size: { type: 'integer' },
      duration: { type: 'float' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      source: { type: 'keyword' },
      owner_id: { type: 'integer' },
      created_at: { type: 'date', format: 'yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis' },
      [EMBED_FIELD]: { type: 'dense_vector', dims: EMBED_DIMS, index: true, similarity: 'cosine' },
    },
  },
  scripts: {
    properties: {
      id: { type: 'integer' },
      title: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart', fields: { keyword: { type: 'keyword' } } },
      content: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart' },
      product_name: { type: 'text', analyzer: 'ik_max_word' },
      category: { type: 'keyword' },
      status: { type: 'keyword' },
      owner_id: { type: 'integer' },
      owner_name: { type: 'keyword' },
      created_at: { type: 'date', format: 'yyyy-MM-dd HH:mm:ss||yyyy-MM-dd||epoch_millis' },
      [EMBED_FIELD]: { type: 'dense_vector', dims: EMBED_DIMS, index: true, similarity: 'cosine' },
    },
  },
  hot: {
    properties: {
      id: { type: 'integer' },
      title: { type: 'text', analyzer: 'ik_max_word', search_analyzer: 'ik_smart' },
      platform: { type: 'keyword' },
      author: { type: 'keyword' },
      category: { type: 'keyword' },
      likes: { type: 'integer' },
      comments: { type: 'integer' },
      shares: { type: 'integer' },
      published_at: { type: 'keyword' },
      [EMBED_FIELD]: { type: 'dense_vector', dims: EMBED_DIMS, index: true, similarity: 'cosine' },
    },
  },
}

let esAvailable = null

export async function initES() {
  try {
    const health = await esClient.cluster.health({}, { requestTimeout: 3000 })
    esAvailable = true
    console.log(`[ES] 集群状态: ${health.status}`)
    for (const [name, indexName] of Object.entries(INDICES)) {
      // 兼容 8.x（返回 boolean）与 7.x（返回 { statusCode/body }）客户端
      const existsResp = await esClient.indices.exists({ index: indexName })
      const exists = existsResp === true || existsResp?.statusCode === 200 || existsResp?.body === true
      if (!exists) {
        try {
          await esClient.indices.create({
            index: indexName,
            body: {
              mappings: MAPPINGS[name],
              settings: { number_of_shards: 1, number_of_replicas: 0 },
            },
          })
          console.log(`[ES] 创建索引: ${indexName}`)
        } catch (e) {
          if (e.meta?.body?.error?.type !== 'resource_already_exists_exception') {
            // IK分词器可能未安装，降级为standard（保留向量字段）
            await esClient.indices.create({
              index: indexName,
              body: {
                mappings: stripAnalyzers(MAPPINGS[name]),
                settings: { number_of_shards: 1, number_of_replicas: 0, analysis: { analyzer: { default: { type: 'standard' } } } },
              },
            })
            console.log(`[ES] 创建索引(标准分词): ${indexName}`)
          }
        }
      } else {
        // 维度变更检测：不符时保留旧索引并降级，需人工创建新索引并重建数据
        try {
          const mapping = await esClient.indices.getFieldMapping({
            index: indexName,
            fields: [EMBED_FIELD],
          })
          // 兼容 8.x（直接返回 body）与 7.x 客户端
          const body = mapping?.body || mapping
          const fields = Object.values(body || {})[0]?.mappings?.[EMBED_FIELD]?.mapping?.[EMBED_FIELD]
          const curDims = fields?.dims
          if (curDims && curDims !== EMBED_DIMS) {
            console.error(`[ES] 索引 ${indexName} 向量维度 ${curDims} 与 ${EMBED_DIMS} 不一致，已保留原索引并降级；请使用独立索引重建数据`)
            esAvailable = false
            return false
          }
        } catch (e) {
          // 字段映射查询失败（如旧索引无该字段）不阻断
          if (!/index_not_found|crop_single_document/.test(String(e.message))) {
            console.warn(`[ES] 维度检测跳过: ${e.message.slice(0, 120)}`)
          }
        }
        // 兼容旧索引：补写 dense_vector 映射
        try {
          await esClient.indices.putMapping({
            index: indexName,
            properties: { [EMBED_FIELD]: MAPPINGS[name].properties[EMBED_FIELD] },
          })
        } catch {}
      }
    }
    return true
  } catch (e) {
    esAvailable = false
    console.warn(`[ES] 连接失败，搜索功能将降级为SQLite查询: ${e.message}`)
    return false
  }
}

function stripAnalyzers(mappings) {
  const walk = (obj) => {
    for (const k of Object.keys(obj)) {
      if (k === 'analyzer' || k === 'search_analyzer') delete obj[k]
      else if (typeof obj[k] === 'object') walk(obj[k])
    }
  }
  const clone = JSON.parse(JSON.stringify(mappings))
  walk(clone)
  return clone
}

export function isESAvailable() {
  return esAvailable === true
}

// 构建用于向量化的文本
function buildEmbedText(index, doc) {
  const parts = []
  if (index === 'materials') parts.push(doc.name, doc.desc, Array.isArray(doc.tags) ? doc.tags.join(' ') : doc.tags, doc.category)
  else if (index === 'scripts') parts.push(doc.title, doc.product_name, doc.content)
  else if (index === 'hot') parts.push(doc.title, doc.author, doc.category, doc.platform)
  return parts.filter(Boolean).join(' ').slice(0, 4000)
}

// 为文档计算向量（失败不阻断索引写入）
async function withEmbedding(index, doc) {
  if (!realEnabled()) return doc
  try {
    const text = buildEmbedText(index, doc)
    if (!text.trim()) return doc
    const [vec] = await embedTexts([text])
    return { ...doc, [EMBED_FIELD]: vec }
  } catch (e) {
    console.warn(`[ES] 向量化失败(仅关键词可检索): ${e.message}`)
    return doc
  }
}

// 索引文档
export async function indexDoc(index, doc) {
  if (!isESAvailable()) return
  try {
    const enriched = await withEmbedding(index, doc)
    await esClient.index({ index: INDICES[index], id: String(doc.id), document: enriched, refresh: true })
  } catch (e) {
    console.warn(`[ES] 索引失败: ${e.message}`)
  }
}

// 删除文档
export async function deleteDoc(index, id) {
  if (!isESAvailable()) return
  try {
    await esClient.delete({ index: INDICES[index], id: String(id), refresh: true })
  } catch {}
}

// 混合搜索：BM25 + kNN 语义召回，可选 Rerank 精排
export async function searchDocs(index, { keyword, filters = [], from = 0, size = 20, sort }) {
  const knnK = Math.min(60, from + size)
  const should = []
  if (keyword) {
    should.push({
      multi_match: {
        query: keyword,
        fields: ['name^3', 'title^3', 'content', 'desc', 'author', 'product_name', 'tags', 'category'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    })
  }

  // 语义向量召回
  let queryVector = null
  if (keyword && realEnabled()) {
    try {
      queryVector = await embedQuery(keyword)
    } catch (e) {
      console.warn(`[ES] 查询向量化失败，退化为纯关键词: ${e.message}`)
    }
  }
  if (queryVector) {
    should.push({
      knn: { field: EMBED_FIELD, query_vector: queryVector, num_candidates: 100, k: knnK },
    })
  }

  const body = {
    from,
    size: queryVector ? Math.max(size, 20) : size, // 混合召回多取一些，便于精排
    query: {
      bool: {
        should: should.length ? should : undefined,
        must: should.length ? undefined : [{ match_all: {} }],
        minimum_should_match: should.length > 1 ? 1 : undefined,
        filter: filters.length ? filters : undefined,
      },
    },
  }
  if (sort) body.sort = sort
  // 8.x 客户端直接返回响应体（含 hits）
  const result = await esClient.search({ index: INDICES[index], ...body })

  let hits = result.hits.hits.map((h) => ({ id: Number(h._id), ...h._source, _es_score: h._score }))
  const total = result.hits.total.value

  // Rerank 精排（对首页结果生效）
  let mode = queryVector ? 'hybrid' : 'keyword'
  if (keyword && realEnabled() && hits.length > 1 && !sort && from === 0) {
    try {
      const docs = hits.slice(0, 50).map((h) =>
        `${h.title || h.name || ''} ${h.desc || h.content || ''}`.replace(/\s+/g, ' ').slice(0, 1500)
      )
      const ranked = await rerankDocs(keyword, docs, Math.min(size, docs.length))
      const scoreMap = new Map(ranked.map((r) => [hits[r.index].id, r.score]))
      hits = [
        ...hits
          .filter((h) => scoreMap.has(h.id))
          .map((h) => ({ ...h, _rerank_score: scoreMap.get(h.id) }))
          .sort((a, b) => b._rerank_score - a._rerank_score),
        ...hits.filter((h) => !scoreMap.has(h.id)),
      ]
      mode = 'hybrid+rerank'
    } catch (e) {
      console.warn(`[ES] Rerank失败，保留混合排序: ${e.message}`)
    }
  }

  return {
    total,
    mode,
    list: hits.map(({ _es_score, _rerank_score, ...rest }) => ({ ...rest, _score: _rerank_score ?? _es_score })),
  }
}

// 重建索引数据（批量向量化）
export async function reindexAll(index, docs) {
  if (!isESAvailable()) return
  const name = INDICES[index]
  try {
    await esClient.deleteByQuery({ index: name, body: { query: { match_all: {} } }, refresh: true })
    if (docs.length) {
      // 批量向量化（每批 16 条，失败的单条跳过）
      if (realEnabled()) {
        const CH = 16
        for (let i = 0; i < docs.length; i += CH) {
          const batch = docs.slice(i, i + CH)
          try {
            const vecs = await embedTexts(batch.map((d) => buildEmbedText(index, d)))
            batch.forEach((d, j) => { d[EMBED_FIELD] = vecs[j] })
          } catch (e) {
            console.warn(`[ES] 批量向量化失败(跳过本批): ${e.message}`)
          }
        }
      }
      const operations = docs.flatMap((doc) => [{ index: { _index: name, _id: String(doc.id) } }, doc])
      const bulkResp = await esClient.bulk({ operations, refresh: true })
      // 8.x 客户端直接返回响应体 { errors, items }
      if (bulkResp?.errors) {
        const bad = (bulkResp.items || []).filter((it) => it.index?.error)
        console.warn(`[ES] bulk写入存在 ${bad.length} 条项级错误: ${JSON.stringify(bad[0]?.index?.error || {}).slice(0, 300)}`)
      }
      const after = await esClient.count({ index: name })
      console.log(`[ES] ${name} 重建完成，实际写入 ${after.count} / ${docs.length} 条`)
    }
  } catch (e) {
    console.warn(`[ES] 重建索引失败: ${e.message}`)
  }
}
