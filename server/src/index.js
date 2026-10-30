import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { initES, isESAvailable } from './services/esService.js'
import { realEnabled, MODEL_CATALOG } from './services/aiProviders.js'
import db from './db.js'
import { backfillVideoCovers } from './services/videoCover.js'
import { recoverAiTasks } from './services/aiEngine.js'
import { authRequired } from './middleware/auth.js'
import { mediaAccess } from './middleware/mediaAccess.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 确保上传目录存在
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const app = express()
// 信任反向代理的 X-Forwarded-Proto,使 req.secure 反映真实协议(媒体 cookie 的 Secure 标记依赖它)
app.set('trust proxy', 1)

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// 子路径部署:剥离 APP_BASE_PATH 前缀(如 /xtzc),使应用可挂在反向代理子路径下;
// 同时保留根路径直连能力(nginx 剥离过前缀的请求到达时已无前缀,此处为空操作)
const BASE_PATH = (process.env.APP_BASE_PATH || '').replace(/\/$/, '')
if (BASE_PATH) {
  app.use((req, res, next) => {
    if (req.url === BASE_PATH) return res.redirect(301, BASE_PATH + '/')
    if (req.url.startsWith(BASE_PATH + '/')) req.url = req.url.slice(BASE_PATH.length) || '/'
    next()
  })
}

// 静态服务：上传的文件（原站素材CDN模拟）
app.use('/uploads', mediaAccess, express.static(UPLOAD_DIR))

// These legacy handlers only returned examples or local status changes. Block them before
// they can debit points or report an external operation as successful.
const unavailableOperations = {
  '/charge/create': '真实支付尚未接入，暂不能创建充值订单',
  '/charge/pay': '真实支付尚未接入，暂不能付款',
  '/member/order/create/order': '真实会员支付尚未接入',
  '/viral/replica/parseShareUrl': '视频平台链接解析尚未接入',
  '/create/analysis': '视频解析需要接入真实视频理解模型，暂不可用',
  '/ai-mix/export': '真实混剪导出尚未接入',
  '/ai-mix/smart-match': '语义素材匹配尚未接入',
  '/highlight/editing/task/create': '真实高光识别与剪辑尚未接入',
  '/highlight/editing/clip/publish': '平台发布接口尚未接入',
  '/highlight/editing/clip/save/material': '高光片段来源尚未核实，暂不能保存',
  '/highlight/editing/live/stop': '直播平台控制接口尚未接入',
  '/highlight/editing/share/parse': '直播链接解析尚未接入',
  '/video/scene/analysis/submit': '真实视频理解模型尚未接入',
  '/video/scene/analysis/retry': '真实视频理解模型尚未接入',
  '/tools/erase/submit': '图片局部修复模型尚未接入',
  '/data/compass/video/query/url': '视频平台数据源尚未接入',
  '/data/compass/video/analysis': '视频平台数据源尚未接入',
  '/ad/launch/video/manager/submit': '广告平台投放接口尚未接入',
  '/ad/launch/video/manager/batch/submit': '广告平台投放接口尚未接入',
}
app.use('/api', (req, res, next) => {
  const notice = req.method === 'POST' && unavailableOperations[req.path]
  if (!notice) return next()
  authRequired(req, res, () => res.json({ code: 503, data: null, message: notice }))
})

// 路由挂载
import authRouter from './routes/auth.js'
import teamRouter from './routes/team.js'
import materialRouter from './routes/material.js'
import hotRouter from './routes/hot.js'
import aimixRouter from './routes/aimix.js'
import agentRouter from './routes/agent.js'
import createRouter from './routes/create.js'
import adsRouter from './routes/ads.js'
import settingRouter from './routes/setting.js'
import chargeRouter from './routes/charge.js'
import workbenchRouter from './routes/workbench.js'
import creativeRouter from './routes/creative.js'
import bizRouter from './routes/biz.js'
import scriptDetailRouter from './routes/scriptDetail.js'
import aitoolsRouter from './routes/aitools.js'
import voiceRouter from './routes/voice.js'
import videoAnalysisRouter from './routes/videoAnalysis.js'

app.use('/api', authRouter)
app.use('/api', teamRouter)
app.use('/api', materialRouter)
app.use('/api', hotRouter)
app.use('/api', aimixRouter)
app.use('/api', agentRouter)
app.use('/api', createRouter)
app.use('/api', adsRouter)
app.use('/api', settingRouter)
app.use('/api', chargeRouter)
app.use('/api', workbenchRouter)
app.use('/api', creativeRouter)
app.use('/api', bizRouter)
app.use('/api', scriptDetailRouter)
app.use('/api', aitoolsRouter)
app.use('/api', voiceRouter)
app.use('/api', videoAnalysisRouter)

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', es: isESAvailable() })
})

// ES状态查询
app.get('/api/es/status', (req, res) => {
  res.json({ code: 0, data: { available: isESAvailable() }, message: 'success' })
})

// AI引擎状态与可用模型清单
app.get('/api/ai/status', (req, res) => {
  res.json({ code: 0, data: { enabled: realEnabled(), models: MODEL_CATALOG }, message: 'success' })
})

// 前端静态资源（生产构建 dist），使 3001 端口即可访问完整应用
const DIST_DIR = path.resolve(__dirname, '../../client/dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  console.log(`[Static] 托管前端目录: ${DIST_DIR}`)
}

// SPA 路由回退：非 API/上传的 GET 请求都返回 index.html
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next()
  }
  const indexFile = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile)
  }
  next()
})

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, data: null, message: '接口不存在' })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Server Error]', err)
  if (err.code === 'INSUFFICIENT_POINTS') return res.json({ code: 400, data: null, message: err.message })
  res.status(500).json({ code: 500, data: null, message: err.message || '服务器内部错误' })
})

const PORT = process.env.PORT || 3001

// 启动：HTTP 服务立即监听，ES 后台初始化（未就绪时搜索自动降级 SQLite，不影响其他接口）
async function bootstrap() {
  for (let i = 1; i <= 20; i++) {
    if (await initES()) return true
    if (i < 20) {
      console.log(`[ES] 第 ${i} 次连接失败，3秒后重试...`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  console.warn('[ES] 重试后仍未连接，以降级模式启动（搜索走SQLite）')
  return false
}

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║     兴图智创 XingTu Studio - AIGC创作平台服务端    ║
╠══════════════════════════════════════════════════╣
║  API地址:    http://localhost:${PORT}${' '.repeat(Math.max(0, 24 - String(PORT).length))}║
║  上传目录:   ${UPLOAD_DIR.slice(0, 30).padEnd(30)}║
╚══════════════════════════════════════════════════╝
  `)

  // Keep queued tasks and resume already-submitted ModelGate jobs without resubmission.
  try {
    recoverAiTasks()
  } catch (e) {
    console.warn('[RECOVER] 失败:', e.message)
  }

  // 存量视频封面补齐（后台执行：历史任务的 cover 是无效假路径，poster 404 黑屏）
  if (process.env.BACKFILL_VIDEO_COVERS === 'true') {
    setTimeout(() => backfillVideoCovers().catch((e) => console.warn(`[封面补齐] 失败: ${e.message}`)), 6000)
  }
})

bootstrap().then((ok) => {
  console.log(`[ES] 初始化完成: ${ok ? '已连接 (elasticsearch:9200)' : '未连接（搜索降级模式）'}`)
})
