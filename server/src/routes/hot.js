import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { success, fail, page, asyncHandler } from '../utils/response.js'
import { searchDocs, isESAvailable } from '../services/esService.js'

const router = express.Router()

// 平台配置
const PLATFORMS = [
  { key: 'douyin', name: '抖音', icon: '/images/hot/icon_douyin.png' },
  { key: 'kuaishou', name: '快手', icon: '/images/hot/icon_kuaishou.png' },
  { key: 'bilibili', name: 'B站', icon: '/images/hot/icon_bilibili.png' },
]

// ============ 爆款视频列表 ============
router.get('/hot/list', authRequired, asyncHandler(async (req, res) => {
  const { platform, category, keyword, sort = 'likes', pageNum = 1, pageSize = 12 } = req.query
  const from = (+pageNum - 1) * +pageSize

  // 关键词搜索走ES
  if (keyword && isESAvailable()) {
    try {
      const filters = []
      if (platform) filters.push({ term: { platform } })
      if (category) filters.push({ term: { category } })
      const { total, list } = await searchDocs('hot', {
        keyword, filters, from, size: +pageSize,
        sort: [{ [sort === 'likes' ? 'likes' : 'comments']: 'desc' }],
      })
      return res.json(page(list, total, +pageNum, +pageSize))
    } catch (e) {
      console.warn('[ES] hot搜索降级:', e.message)
    }
  }

  const conds = []
  const args = []
  if (platform) { conds.push('platform = ?'); args.push(platform) }
  if (category) { conds.push('category = ?'); args.push(category) }
  if (keyword) { conds.push('title LIKE ?'); args.push(`%${keyword}%`) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const orderMap = { likes: 'likes DESC', comments: 'comments DESC', shares: 'shares DESC', newest: 'id DESC' }
  const total = db.prepare(`SELECT COUNT(*) c FROM hot_videos ${where}`).get(...args).c
  const list = db.prepare(`SELECT * FROM hot_videos ${where} ORDER BY ${orderMap[sort] || 'likes DESC'} LIMIT ? OFFSET ?`)
    .all(...args, +pageSize, from)
  res.json(page(list, total, +pageNum, +pageSize))
}))

// 爆款视频详情
router.get('/hot/detail', authRequired, (req, res) => {
  const v = db.prepare('SELECT * FROM hot_videos WHERE id = ?').get(req.query.id)
  if (!v) return res.json(fail('视频不存在', 404))
  res.json(success(v))
})

// 分类列表
router.get('/hot/categories', authRequired, (req, res) => {
  const list = db.prepare('SELECT category, COUNT(*) as count FROM hot_videos GROUP BY category ORDER BY count DESC').all()
  res.json(success(list))
})

// 平台列表
router.get('/hot/platforms', authRequired, (req, res) => {
  res.json(success(PLATFORMS))
})

// ============ 视频解析 ============
// 解析分享链接（mock）
router.post('/viral/replica/parseShareUrl', authRequired, asyncHandler(async (req, res) => {
  const { url } = req.body
  if (!url) return res.json(fail('请输入视频链接', 400))

  // mock解析：从URL提取视频ID特征，返回模拟解析结果
  const hash = url.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const videos = db.prepare('SELECT * FROM hot_videos ORDER BY RANDOM() LIMIT 1').get()
  res.json(success({
    url,
    title: videos?.title || '热门带货视频',
    cover: videos?.cover || '',
    author: videos?.author || '热门创作者',
    platform: /douyin/.test(url) ? 'douyin' : /kuaishou/.test(url) ? 'kuaishou' : /bilibili/.test(url) ? 'bilibili' : 'douyin',
    duration: videos?.duration || '00:45',
    likes: (hash % 90 + 10) * 1000,
    parseTime: new Date().toISOString(),
  }))
}))

// 解析分析点数配置
router.get('/viral-replica/v2/config/analysis-point', authRequired, (req, res) => {
  res.json(success({ point: 50, desc: '视频解析分析' }))
})

router.get('/viral-replica/v2/config/scene-image-point', authRequired, (req, res) => {
  res.json(success({ point: 20, desc: '场景图生成' }))
})

router.get('/viral-replica/v2/config/video-models', authRequired, (req, res) => {
  // 仅保留 ModelGate 自建算力模型（免费）；第三方商业模型已全部移除
  res.json(success([
    { key: 'minimax', name: 'MiniMax H3 (ModelGate)', desc: '音视频生成' },
  ]))
})

// 场景生成
router.get('/viral-replica/v2/scene-generations', authRequired, (req, res) => {
  res.json(page([], 0))
})

// 爆款复刻任务列表
router.get('/viral-replica/v2/tasks', authRequired, (req, res) => {
  res.json(page([], 0))
})

// 分享链接解析（旧版）
router.post('/viral/replica/analysis/point', authRequired, (req, res) => {
  res.json(success({ point: 50 }))
})

export default router
