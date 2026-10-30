/**
 * 数据罗盘共享数据集 + SVG封面生成器
 * 供 migrate-compass.js（增量迁移）与 seed.js（全量初始化）共同使用
 * 封面为按分类视觉体系生成的品牌SVG（暗夜紫 + 分类主题色）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 分类视觉体系：渐变色 + 强调色 + 装饰图形
export const CATEGORY_THEMES = {
  电商带货: { g1: '#2A1A08', g2: '#120D20', accent: '#EABB5C', accent2: '#F97316', label: 'SHOPPING' },
  知识口播: { g1: '#0D1B3A', g2: '#0A0714', accent: '#60A5FA', accent2: '#22D3EE', label: 'TALK' },
  餐饮美食: { g1: '#3A0D14', g2: '#120D20', accent: '#FB7185', accent2: '#F59E0B', label: 'FOOD' },
  美妆护肤: { g1: '#3A0D2E', g2: '#120D20', accent: '#F472B6', accent2: '#D946EF', label: 'BEAUTY' },
  家居日用: { g1: '#0D2A24', g2: '#0A0714', accent: '#34D399', accent2: '#22D3EE', label: 'HOME' },
}

// 分类装饰图形（320x180 画布右侧区域）
const MOTIFS = {
  电商带货: (a, b) => `
  <g transform="translate(228,44) rotate(8)" opacity="0.9">
    <path d="M8 22h64l-6 52a8 8 0 01-8 8H22a8 8 0 01-8-8z" fill="none" stroke="${a}" stroke-width="3"/>
    <path d="M26 22v-6a14 14 0 0128 0v6" fill="none" stroke="${a}" stroke-width="3"/>
    <circle cx="30" cy="40" r="3" fill="${b}"/><circle cx="50" cy="40" r="3" fill="${b}"/>
    <path d="M30 56q10 8 20 0" fill="none" stroke="${b}" stroke-width="3" stroke-linecap="round"/>
  </g>
  <g transform="translate(196,118) rotate(-12)">
    <rect width="52" height="26" rx="6" fill="${b}"/>
    <text x="26" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#0A0714" font-family="sans-serif">¥ 抢</text>
  </g>`,
  知识口播: (a, b) => `
  <g transform="translate(236,40)">
    <rect x="20" y="0" width="28" height="56" rx="14" fill="none" stroke="${a}" stroke-width="3"/>
    <path d="M8 46a26 26 0 0052 0M34 72v14M22 88h24" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
    <rect x="27" y="12" width="14" height="30" rx="7" fill="${b}"/>
  </g>
  <g stroke="${b}" stroke-width="3" stroke-linecap="round" opacity="0.85">
    <path d="M196 96v16M208 88v32M220 90v28M286 92v24M298 98v12M310 96v16"/>
  </g>`,
  餐饮美食: (a, b) => `
  <g transform="translate(222,52)">
    <path d="M0 40h96a48 48 0 01-96 0z" fill="none" stroke="${a}" stroke-width="3"/>
    <path d="M14 34h68" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
    <path d="M30 22q4-8 0-14M36 36q4-8 0-16M52 36q4-8 0-16M68 34q4-8 0-14" fill="none" stroke="${b}" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>
    <path d="M88 10l14-8M92 22l16-4" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
  </g>`,
  美妆护肤: (a, b) => `
  <g transform="translate(240,42) rotate(-10)">
    <rect x="12" y="34" width="26" height="44" rx="6" fill="none" stroke="${a}" stroke-width="3"/>
    <path d="M16 34l4-22q7-10 14 0l4 10z" fill="${b}"/>
    <rect x="8" y="78" width="34" height="10" rx="4" fill="${a}"/>
  </g>
  <g fill="${b}" opacity="0.9">
    <path d="M206 118q8-12 0-20-8 8 0 20z" transform="scale(1.4) translate(-60,-20)"/>
    <circle cx="216" cy="128" r="4"/><circle cx="300" cy="52" r="3"/>
  </g>`,
  家居日用: (a, b) => `
  <g transform="translate(228,46)">
    <path d="M6 40L46 6l40 34" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
    <path d="M16 36v44h60V36" fill="none" stroke="${a}" stroke-width="3"/>
    <rect x="38" y="52" width="16" height="28" rx="3" fill="${b}"/>
    <circle cx="30" cy="52" r="5" fill="none" stroke="${b}" stroke-width="2.5"/>
  </g>`,
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 标题换行：每行最多9个汉字，最多2行 */
function wrapTitle(title) {
  const lines = []
  let rest = title
  while (rest.length > 9 && lines.length < 1) {
    lines.push(rest.slice(0, 9))
    rest = rest.slice(9)
  }
  lines.push(rest.length > 10 ? rest.slice(0, 9) + '…' : rest)
  return lines
}

/** 生成单张视频封面SVG */
export function renderCover({ title, author, category, playText }) {
  const t = CATEGORY_THEMES[category] || CATEGORY_THEMES.电商带货
  const lines = wrapTitle(title)
  const titleSvg = lines.map((l, i) =>
    `<text x="24" y="${lines.length > 1 ? 96 + i * 30 : 108}" font-size="21" font-weight="bold" fill="#F3F0FF" font-family="Microsoft YaHei, PingFang SC, sans-serif">${esc(l)}</text>`
  ).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.g1}"/><stop offset="1" stop-color="${t.g2}"/>
    </linearGradient>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M20 0H0V20" fill="none" stroke="#2A2140" stroke-width="0.5" opacity="0.45"/>
    </pattern>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <rect width="320" height="180" fill="url(#grid)"/>
  <circle cx="270" cy="90" r="80" fill="${t.accent}" opacity="0.08"/>
  ${MOTIFS[category] ? MOTIFS[category](t.accent, t.accent2) : ''}
  <rect x="24" y="24" width="${t.label.length * 8 + 16}" height="18" rx="9" fill="${t.accent}" opacity="0.18"/>
  <text x="32" y="37" font-size="10" letter-spacing="2" fill="${t.accent}" font-family="sans-serif">${t.label}</text>
  ${titleSvg}
  <text x="24" y="146" font-size="12" fill="#9D8FD0" font-family="Microsoft YaHei, PingFang SC, sans-serif">@${esc(author)} · ${esc(playText)}次播放</text>
  <rect x="24" y="156" width="60" height="3" rx="1.5" fill="${t.accent}"/>
</svg>
`
}

const fmtW = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n))

/** 24条罗盘视频数据：[title, platform, author, play, like, comment, share, duration, category] */
export const COMPASS_VIDEOS = [
  // 电商带货
  ['30天卖出10万单的收纳神器', '抖音', '收纳研究所', 1280000, 96000, 8200, 12000, '00:42', '电商带货'],
  ['源头工厂直供：9.9元包邮好物', '快手', '厂长优选', 860000, 54000, 4300, 6100, '00:38', '电商带货'],
  ['直播间爆款：空气炸锅纸实测', '抖音', '带货一姐', 1540000, 128000, 15600, 18900, '00:55', '电商带货'],
  ['跨境电商选品：宠物智能喂食器', '小红书', '跨境老王', 340000, 28000, 2100, 3400, '01:12', '电商带货'],
  ['国货之光：这支牙膏复购率90%', '抖音', '国货观察员', 720000, 61000, 5800, 9200, '00:47', '电商带货'],
  // 知识口播
  ['3个公式搞定短视频开头钩子', 'B站', '运营老K', 445000, 52000, 6800, 15600, '03:24', '知识口播'],
  ['为什么你的视频没有推荐量', '抖音', '算法解读君', 680000, 47000, 5600, 9800, '02:08', '知识口播'],
  ['新手做账号最容易踩的5个坑', '小红书', '起号教练', 320000, 38000, 4200, 8600, '02:45', '知识口播'],
  ['完播率的底层逻辑一次讲透', 'B站', '数据派阿哲', 268000, 31000, 3900, 7200, '04:16', '知识口播'],
  ['口播视频打光避坑指南', '抖音', '光影实验室', 195000, 18000, 1600, 2800, '01:56', '知识口播'],
  // 餐饮美食
  ['街边小店：一碗让排队的牛肉面', '抖音', '美食侦探', 890000, 76000, 6800, 5400, '00:58', '餐饮美食'],
  ['复刻米其林三星招牌甜品', 'B站', '甜品大师姐', 560000, 68000, 5200, 11800, '05:32', '餐饮美食'],
  ['减脂餐一周不重样挑战', '快手', '健康食谱', 456000, 39800, 3600, 7200, '01:24', '餐饮美食'],
  ['深夜食堂：凌晨两点的关东煮', '抖音', '深夜食堂记', 780000, 92000, 12400, 16800, '01:08', '餐饮美食'],
  ['3块钱食材做出高级感早餐', '小红书', '早餐美学', 380000, 45000, 3900, 8600, '00:52', '餐饮美食'],
  // 美妆护肤
  ['3分钟学会夏日清爽妆容', '抖音', '美妆小课堂', 1256000, 118000, 8600, 15200, '00:48', '美妆护肤'],
  ['黄黑皮必入的显白口红试色', '小红书', '试色狂魔', 620000, 74000, 6800, 12800, '01:36', '美妆护肤'],
  ['油皮早八人的极简护肤流程', '抖音', '成分党CC', 540000, 48000, 4200, 7600, '01:15', '美妆护肤'],
  ['平价替代大牌粉底液测评', 'B站', '测评小鹿', 410000, 36000, 3800, 6400, '06:20', '美妆护肤'],
  // 家居日用
  ['租房改造：500元打造ins风卧室', 'B站', '家居改造家', 945000, 135000, 12800, 22400, '04:48', '家居日用'],
  ['小户型收纳：榨干每1平米', '抖音', '整理师小林', 760000, 82000, 7600, 14200, '01:42', '家居日用'],
  ['提升幸福感的6件厨房好物', '小红书', '生活美学家', 480000, 56000, 4800, 9800, '01:18', '家居日用'],
  ['出租屋灯光改造前后对比', '抖音', '灯光设计师', 620000, 68000, 5900, 11600, '00:56', '家居日用'],
  ['阳台改造：3平米变身小花园', '快手', '园艺日记', 350000, 32000, 2800, 5600, '01:30', '家居日用'],
]

/** 为每条视频生成确定性AI分析结果 */
export function buildAnalysis(v) {
  const [title, platform, author, play, like, comment, share] = v
  const interact = ((like + comment + share) / play * 100)
  return {
    completionRate: Math.min(95, 38 + Math.round(play % 40)),
    interactRate: +interact.toFixed(1),
    likeRate: +(like / play * 100).toFixed(1),
    audience: {
      gender: title.match(/妆|护肤|口红|收纳|家居|早餐|甜品/) ? { 女: 78, 男: 22 } : { 女: 46, 男: 54 },
      age: { '18-23': 32, '24-30': 38, '31-40': 21, '40+': 9 },
      topCities: ['广州', '杭州', '成都'],
    },
    factors: [
      { name: '黄金3秒钩子', score: 85 + (play % 10) },
      { name: '情绪共鸣强度', score: 78 + (like % 15) },
      { name: '信息密度', score: 70 + (comment % 20) },
      { name: '转化引导', score: 65 + (share % 25) },
    ],
    tags: ['高完播', '强互动', platform + '热榜', '可复刻结构'],
    suggestion: '前3秒直接抛出利益点，中段用对比制造情绪峰值，结尾引导评论区互动可进一步提升分发权重。',
  }
}

/** 生成全部封面文件到 client/public/images/compass/，返回 cover 路径数组 */
export function writeCoverFiles() {
  const outDir = path.resolve(__dirname, '../../client/public/images/compass')
  fs.mkdirSync(outDir, { recursive: true })
  return COMPASS_VIDEOS.map((v, i) => {
    const file = `cover_${i + 1}.svg`
    fs.writeFileSync(path.join(outDir, file), renderCover({
      title: v[0], author: v[2], category: v[8], playText: fmtW(v[3]),
    }))
    return `/images/compass/${file}`
  })
}

/** 重建 compass_videos 表（幂等：先清后插） */
export function seedCompass(db, ownerId) {
  const covers = writeCoverFiles()
  db.prepare('DELETE FROM compass_videos').run()
  const ins = db.prepare(`INSERT INTO compass_videos
    (title, platform, author, cover, play_count, like_count, comment_count, share_count, duration, category, analysis_status, analysis, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)`)
  COMPASS_VIDEOS.forEach((v, i) => {
    ins.run(v[0], v[1], v[2], covers[i], v[3], v[4], v[5], v[6], v[7], v[8], JSON.stringify(buildAnalysis(v)), ownerId)
  })
  return COMPASS_VIDEOS.length
}
