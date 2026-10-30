// 生成 AI梦工厂「案例展示」海报素材：12 张 360×640 电商大促风格 SVG
// 运行: node tools/gen-factory-cases.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'images', 'factory', 'cases')
mkdirSync(OUT, { recursive: true })

let seq = 0
const uid = (p) => `${p}_${++seq}`

const txt = (x, y, s, size, fill, weight = 900, spacing = 2, anchor = 'middle', opacity = 1) =>
  `<text x="${x}" y="${y}" font-family="PingFang SC,Microsoft YaHei,Source Han Sans SC,sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${s}</text>`

// ---------- 装饰 ----------
function rays(cx, cy, r, color, n = 14, opacity = 0.1) {
  let out = ''
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n
    out += `<line x1="${(cx + Math.cos(a) * r * 0.22).toFixed(1)}" y1="${(cy + Math.sin(a) * r * 0.22).toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${color}" stroke-width="12" opacity="${opacity}"/>`
  }
  return out
}
const dots = (color, opacity = 0.15) => {
  const id = uid('dot')
  return { def: `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="${color}" opacity="${opacity}"/></pattern>`, rect: `<rect width="360" height="640" fill="url(#${id})"/>` }
}
const star = (cx, cy, r, color, opacity = 0.9) =>
  `<path d="M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r}Z" fill="${color}" opacity="${opacity}"/>`
const coin = (cx, cy, r) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F59E0B" stroke="#FDE68A" stroke-width="3"/><text x="${cx}" y="${cy + r * 0.38}" font-size="${r}" font-weight="900" fill="#FDE68A" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">¥</text>`
const petal = (cx, cy, rot, color, s = 1, opacity = 0.85) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${9 * s}" ry="${5 * s}" fill="${color}" opacity="${opacity}" transform="rotate(${rot} ${cx} ${cy})"/>`
const miniPerson = (x, y, s, color) =>
  `<g fill="${color}"><circle cx="${x}" cy="${y - 14 * s}" r="${5 * s}"/><path d="M${x - 7 * s} ${y + 10 * s} L${x - 5 * s} ${y - 6 * s} Q${x} ${y - 10 * s} ${x + 5 * s} ${y - 6 * s} L${x + 7 * s} ${y + 10 * s}Z"/></g>`

// ---------- 产品 ----------
function bottle(cx, base, w, h, c1, c2, label = '臻选', cap = '#26232e') {
  const g = uid('pb')
  const bw = w, bh = h * 0.82, bx = cx - bw / 2, by = base - bh
  const cw = w * 0.4, ch = h * 0.16
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c2}"/><stop offset="0.45" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${bw * 0.62}" ry="10" fill="#000" opacity="0.22"/>
  <rect x="${cx - cw / 2}" y="${by - ch}" width="${cw}" height="${ch}" rx="6" fill="${cap}"/>
  <rect x="${cx - cw * 0.36}" y="${by - ch - 8}" width="${cw * 0.72}" height="10" rx="4" fill="${cap}" opacity="0.85"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bw * 0.2}" fill="url(#${g})"/>
  <rect x="${bx + bw * 0.12}" y="${by + 10}" width="${bw * 0.14}" height="${bh * 0.8}" rx="${bw * 0.07}" fill="#fff" opacity="0.35"/>
  <rect x="${cx - bw * 0.32}" y="${by + bh * 0.34}" width="${bw * 0.64}" height="${bh * 0.34}" rx="8" fill="#fff" opacity="0.94"/>
  ${txt(cx, by + bh * 0.5, label, 17, '#333', 900, 3)}
  ${txt(cx, by + bh * 0.62, 'PREMIUM', 7.5, '#999', 700, 2)}`
}
function can(cx, base, w, h, c1, c2, label = '清爽') {
  const g = uid('pc')
  const bw = w, bh = h, bx = cx - bw / 2, by = base - bh
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c2}"/><stop offset="0.45" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${bw * 0.62}" ry="10" fill="#000" opacity="0.22"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="url(#${g})"/>
  <ellipse cx="${cx}" cy="${by}" rx="${bw / 2}" ry="${bw * 0.12}" fill="#d9dde3"/>
  <ellipse cx="${cx}" cy="${by}" rx="${bw * 0.34}" ry="${bw * 0.08}" fill="#aab"/>
  <ellipse cx="${cx}" cy="${base}" rx="${bw / 2}" ry="${bw * 0.12}" fill="${c2}"/>
  <rect x="${bx + bw * 0.14}" y="${by + 12}" width="${bw * 0.13}" height="${bh * 0.84}" rx="${bw * 0.06}" fill="#fff" opacity="0.4"/>
  ${txt(cx, by + bh * 0.52, label, 20, '#fff', 900, 4)}`
}
function giftBox(cx, base, w, c1, c2, ribbon = '#FDE68A') {
  const g = uid('pg')
  const bw = w, bh = w * 0.62, bx = cx - bw / 2, by = base - bh
  const lh = w * 0.16
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${bw * 0.62}" ry="10" fill="#000" opacity="0.22"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="url(#${g})"/>
  <rect x="${bx - 8}" y="${by - lh}" width="${bw + 16}" height="${lh}" rx="7" fill="${c2}"/>
  <rect x="${cx - 11}" y="${by - lh}" width="22" height="${bh + lh}" fill="${ribbon}"/>
  <ellipse cx="${cx - 16}" cy="${by - lh - 8}" rx="17" ry="10" fill="${ribbon}" transform="rotate(-24 ${cx - 16} ${by - lh - 8})"/>
  <ellipse cx="${cx + 16}" cy="${by - lh - 8}" rx="17" ry="10" fill="${ribbon}" transform="rotate(24 ${cx + 16} ${by - lh - 8})"/>
  <circle cx="${cx}" cy="${by - lh - 6}" r="7" fill="${ribbon}"/>`
}
function perfume(cx, base, w, h, c1, c2) {
  const g = uid('pp')
  const bw = w, bh = h * 0.72, bx = cx - bw / 2, by = base - bh
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${bw * 0.62}" ry="10" fill="#000" opacity="0.25"/>
  <rect x="${cx - 10}" y="${by - 26}" width="20" height="26" rx="4" fill="#C9A24B"/>
  <rect x="${cx - 24}" y="${by - 44}" width="48" height="20" rx="8" fill="#E8C877"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="16" fill="url(#${g})" opacity="0.92"/>
  <rect x="${bx + 10}" y="${by + 10}" width="${bw * 0.16}" height="${bh * 0.78}" rx="8" fill="#fff" opacity="0.4"/>
  <circle cx="${cx}" cy="${by + bh * 0.55}" r="${bw * 0.26}" fill="#fff" opacity="0.9"/>
  ${txt(cx, by + bh * 0.59, 'PARFUM', 11, '#8B5CF6', 800, 2)}`
}
function plush(cx, base, r, c1, c2) {
  const g = uid('pl')
  return `<defs><radialGradient id="${g}" cx="0.4" cy="0.35" r="0.9"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${r * 1.05}" ry="10" fill="#000" opacity="0.12"/>
  <circle cx="${cx - r * 0.55}" cy="${base - r * 1.28}" r="${r * 0.32}" fill="url(#${g})"/>
  <circle cx="${cx + r * 0.55}" cy="${base - r * 1.28}" r="${r * 0.32}" fill="url(#${g})"/>
  <circle cx="${cx}" cy="${base - r * 0.72}" r="${r}" fill="url(#${g})"/>
  <circle cx="${cx - r * 0.3}" cy="${base - r * 0.82}" r="${r * 0.07}" fill="#3b2f2f"/>
  <circle cx="${cx + r * 0.3}" cy="${base - r * 0.82}" r="${r * 0.07}" fill="#3b2f2f"/>
  <path d="M${cx - r * 0.12} ${base - r * 0.6} Q${cx} ${base - r * 0.5} ${cx + r * 0.12} ${base - r * 0.6}" stroke="#3b2f2f" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="${cx - r * 0.52}" cy="${base - r * 0.6}" rx="${r * 0.14}" ry="${r * 0.09}" fill="#FB7185" opacity="0.55"/>
  <ellipse cx="${cx + r * 0.52}" cy="${base - r * 0.6}" rx="${r * 0.14}" ry="${r * 0.09}" fill="#FB7185" opacity="0.55"/>`
}
function fruitSlice(cx, cy, r, c1, c2) {
  let segs = ''
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8
    segs += `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * r * 0.82}" y2="${cy + Math.sin(a) * r * 0.82}" stroke="${c2}" stroke-width="3" opacity="0.85"/>`
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c2}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.86}" fill="${c1}"/>${segs}<circle cx="${cx}" cy="${cy}" r="${r * 0.1}" fill="${c2}"/>`
}
function cake(cx, base, w, c1, c2, cream = '#FFF7ED') {
  const bw = w, l1h = 46, l2h = 40
  const y1 = base - l1h, y2 = y1 - l2h - 8
  const drip = (y, w2) => [-0.38, -0.12, 0.16, 0.4].map((k) => `<circle cx="${cx + k * w2}" cy="${y}" r="7" fill="${cream}"/>`).join('')
  return `<ellipse cx="${cx}" cy="${base + 6}" rx="${bw * 0.66}" ry="11" fill="#D9B98A"/>
  <ellipse cx="${cx}" cy="${base}" rx="${bw * 0.6}" ry="9" fill="#F5E7C6"/>
  <rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${l1h}" rx="9" fill="${c1}"/>
  <rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="14" rx="7" fill="${cream}"/>${drip(y1 + 14, bw)}
  <rect x="${cx - bw * 0.38}" y="${y2}" width="${bw * 0.76}" height="${l2h}" rx="9" fill="${c2}"/>
  <rect x="${cx - bw * 0.38}" y="${y2}" width="${bw * 0.76}" height="12" rx="6" fill="${cream}"/>
  <circle cx="${cx}" cy="${y2 - 12}" r="10" fill="#E11D48"/><path d="M${cx} ${y2 - 20} q10 -12 18 -14" stroke="#16A34A" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
}
function skyline(base, color) {
  const hs = [70, 110, 88, 130, 96, 120, 78, 104]
  let x = -6, out = ''
  hs.forEach((h, i) => {
    const w = 34 + (i % 3) * 10
    out += `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" fill="${color}"/>`
    for (let wy = base - h + 10; wy < base - 8; wy += 16)
      for (let wx = x + 6; wx < x + w - 6; wx += 12) out += `<rect x="${wx}" y="${wy}" width="5" height="7" fill="#FDE68A" opacity="${(i + wy) % 3 ? 0.75 : 0.2}"/>`
    x += w + 8
  })
  return out
}
function dress(cx, base, s, c1, c2) {
  const g = uid('pd')
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 6}" rx="${90 * s}" ry="9" fill="#000" opacity="0.25"/>
  <path d="M${cx} ${base - 210 * s} q0 -16 14 -16" stroke="#C9A24B" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M${cx - 52 * s} ${base - 176 * s} L${cx} ${base - 196 * s} L${cx + 52 * s} ${base - 176 * s}" stroke="#C9A24B" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M${cx - 30 * s} ${base - 170 * s} Q${cx - 44 * s} ${base - 120 * s} ${cx - 62 * s} ${base - 40 * s} Q${cx} ${base - 14 * s} ${cx + 62 * s} ${base - 40 * s} Q${cx + 44 * s} ${base - 120 * s} ${cx + 30 * s} ${base - 170 * s} L${cx + 12 * s} ${base - 178 * s} Q${cx} ${base - 166 * s} ${cx - 12 * s} ${base - 178 * s}Z" fill="url(#${g})"/>
  <path d="M${cx - 40 * s} ${base - 120 * s} Q${cx} ${base - 100 * s} ${cx + 40 * s} ${base - 120 * s}" stroke="#fff" stroke-width="2.5" opacity="0.35" fill="none"/>`
}
function jar(cx, base, w, c1, c2, label = '面霜') {
  const g = uid('pj')
  const bw = w, bh = w * 0.62, bx = cx - bw / 2, by = base - bh
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c2}"/><stop offset="0.5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <ellipse cx="${cx}" cy="${base + 8}" rx="${bw * 0.6}" ry="10" fill="#000" opacity="0.22"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bw * 0.18}" fill="url(#${g})"/>
  <rect x="${bx - 4}" y="${by - 16}" width="${bw + 8}" height="22" rx="10" fill="#E8C877"/>
  <rect x="${bx + bw * 0.12}" y="${by + 8}" width="${bw * 0.12}" height="${bh * 0.72}" rx="6" fill="#fff" opacity="0.4"/>
  ${txt(cx, by + bh * 0.58, label, 16, '#6D28D9', 900, 3)}`
}

// ---------- 海报骨架 ----------
function poster(cfg) {
  const gBg = uid('bg'), gGlow = uid('gl'), gCta = uid('cta')
  const [b1, b2, b3] = cfg.bg
  const titleFill = cfg.dark ? '#FFF7ED' : cfg.ink
  const subFill = cfg.dark ? 'rgba(255,255,255,.72)' : cfg.inkSub
  const d = dots(cfg.dark ? '#fff' : cfg.ink, cfg.dark ? 0.1 : 0.14)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640" viewBox="0 0 360 640">
<defs>
  <linearGradient id="${gBg}" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="${b1}"/><stop offset="0.55" stop-color="${b2}"/><stop offset="1" stop-color="${b3}"/></linearGradient>
  <radialGradient id="${gGlow}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${cfg.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${cfg.glow}" stop-opacity="0"/></radialGradient>
  <linearGradient id="${gCta}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${cfg.cta[0]}"/><stop offset="1" stop-color="${cfg.cta[1]}"/></linearGradient>
  ${d.def}
</defs>
<rect width="360" height="640" fill="url(#${gBg})"/>
${d.rect}
${cfg.rays ? rays(180, 300, 340, cfg.rays, 14, cfg.dark ? 0.1 : 0.14) : ''}
<circle cx="180" cy="430" r="190" fill="url(#${gGlow})"/>
${cfg.decoTop || ''}
<rect x="110" y="52" width="140" height="30" rx="15" fill="${cfg.dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.5)'}" stroke="${cfg.dark ? 'rgba(255,255,255,.35)' : cfg.ink}" stroke-opacity="0.5"/>
${txt(180, 73, cfg.badge, 14, cfg.dark ? '#FDE68A' : cfg.ink, 800, 4)}
${cfg.dark ? `<text x="182" y="162" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="46" font-weight="900" letter-spacing="4" fill="#000" opacity="0.25" text-anchor="middle">${cfg.title[0]}</text>` : ''}
${txt(180, 160, cfg.title[0], 46, titleFill, 900, 4)}
${txt(180, 216, cfg.title[1], 46, cfg.dark ? '#FDE68A' : cfg.ink, 900, 4)}
${txt(180, 252, cfg.sub, 15, subFill, 600, 3)}
${cfg.product}
${cfg.decoBottom || ''}
<rect x="30" y="556" width="300" height="56" rx="28" fill="${cfg.dark ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.65)'}"/>
${txt(64, 592, '到手价', 13, cfg.dark ? 'rgba(255,255,255,.7)' : cfg.inkSub, 600, 1, 'start')}
<text x="118" y="596" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="30" font-weight="900" fill="${cfg.priceColor}">¥${cfg.price}</text>
<rect x="196" y="564" width="126" height="40" rx="20" fill="url(#${gCta})"/>
${txt(259, 590, cfg.ctaText || '立即抢购', 16, '#fff', 800, 2)}
</svg>`
}

// ---------- 12 个案例 ----------
const cases = [
  // 01 节日气氛 · 双11红金大促
  poster({
    dark: true, bg: ['#7F1D1D', '#C2410C', '#B45309'], glow: '#FBBF24', rays: '#FDE68A',
    badge: '双11狂欢', title: ['双11大促', '狂欢开启'], sub: '全场低至 5 折起', price: '99', priceColor: '#FDE68A', cta: ['#EF4444', '#F97316'],
    decoTop: coin(56, 120, 18) + coin(310, 96, 14) + star(300, 180, 12, '#FDE68A') + star(52, 220, 9, '#FDE68A', 0.7),
    product: giftBox(180, 480, 150, '#EF4444', '#B91C1C') + bottle(278, 492, 64, 120, '#FDE68A', '#D4A017', '精华'),
    decoBottom: coin(48, 520, 15) + star(318, 430, 10, '#fff', 0.8),
  }),
  // 02 节日气氛 · 年终盛典
  poster({
    dark: true, bg: ['#881337', '#E11D48', '#FB7185'], glow: '#FDA4AF', rays: '#fff',
    badge: '年终盛典', title: ['年终盛典', '预售开启'], sub: '定金膨胀 10 倍抵', price: '129', priceColor: '#FDE68A', cta: ['#F59E0B', '#EF4444'],
    decoTop: star(60, 130, 12, '#FDE68A') + star(308, 110, 9, '#fff', 0.8) + coin(312, 200, 15),
    product: bottle(180, 486, 104, 170, '#FDA4AF', '#E11D48', '礼盒', '#7F1D1D') + giftBox(286, 494, 84, '#FDE68A', '#D4A017', '#B91C1C'),
    decoBottom: petal(70, 500, -20, '#FBCFE8') + petal(306, 460, 30, '#FBCFE8'),
  }),
  // 03 通用场景 · 蓝紫影棚
  poster({
    dark: true, bg: ['#1E1B4B', '#5B21B6', '#7C3AED'], glow: '#C4B5FD',
    badge: '新品首发', title: ['焕新上市', '品质之选'], sub: '影棚级质感 一拍即合', price: '199', priceColor: '#FDE68A', cta: ['#8B5CF6', '#D946EF'], ctaText: '立即拥有',
    decoTop: star(58, 120, 10, '#C4B5FD') + star(306, 150, 12, '#E9D5FF', 0.7),
    product: perfume(180, 490, 120, 190, '#C4B5FD', '#7C3AED'),
    decoBottom: star(70, 500, 8, '#E9D5FF') + star(300, 520, 9, '#C4B5FD', 0.8),
  }),
  // 04 通用场景 · 深蓝金光
  poster({
    dark: true, bg: ['#0F172A', '#1E3A8A', '#1D4ED8'], glow: '#60A5FA',
    badge: '匠心臻品', title: ['匠心臻品', '冰爽一夏'], sub: '0 糖 0 脂 · 畅饮无负担', price: '59', priceColor: '#FDE68A', cta: ['#3B82F6', '#06B6D4'], ctaText: '马上囤货',
    decoTop: star(64, 118, 10, '#93C5FD') + star(300, 130, 8, '#FDE68A', 0.85),
    product: can(152, 494, 96, 176, '#60A5FA', '#1D4ED8', '气泡水') + can(238, 500, 74, 138, '#93C5FD', '#3B82F6', '轻盈'),
    decoBottom: star(66, 500, 8, '#93C5FD') + star(310, 470, 9, '#fff', 0.7),
  }),
  // 05 毛绒质感
  poster({
    dark: false, ink: '#9D174D', inkSub: '#BE5B8C', bg: ['#FDF2F8', '#FBCFE8', '#F9A8D4'], glow: '#fff',
    badge: '治愈好物', title: ['软萌来袭', '温暖整个冬天'], sub: '云朵般触感 · 抱回本店爆款', price: '79', priceColor: '#E11D48', cta: ['#EC4899', '#F472B6'], ctaText: '抱回家',
    decoTop: petal(58, 120, -24, '#F472B6') + petal(304, 110, 30, '#F9A8D4') + star(310, 190, 9, '#EC4899', 0.6),
    product: plush(180, 500, 92, '#FCE7F3', '#F472B6'),
    decoBottom: petal(72, 470, 40, '#F472B6') + petal(296, 520, -30, '#FBCFE8'),
  }),
  // 06 微缩小人
  poster({
    dark: false, ink: '#065F46', inkSub: '#3E8E75', bg: ['#ECFDF5', '#A7F3D0', '#6EE7B7'], glow: '#fff',
    badge: '微观创意', title: ['微观世界', '大有乾坤'], sub: '小人物视角 · 产品放大 100 倍', price: '89', priceColor: '#059669', cta: ['#10B981', '#34D399'], ctaText: '探秘好物',
    decoTop: star(60, 116, 9, '#059669', 0.5) + star(304, 140, 10, '#10B981', 0.45),
    product: bottle(196, 496, 120, 190, '#D1FAE5', '#34D399', '植萃', '#065F46')
      + miniPerson(88, 500, 1.6, '#065F46') + miniPerson(122, 504, 1.3, '#047857') + miniPerson(288, 502, 1.5, '#065F46')
      + `<rect x="72" y="470" width="34" height="6" rx="3" fill="#065F46" opacity="0.5"/>`,
    decoBottom: star(66, 512, 8, '#059669', 0.5),
  }),
  // 07 切开产品
  poster({
    dark: false, ink: '#9A3412', inkSub: '#C2623B', bg: ['#FFF7ED', '#FDBA74', '#FB923C'], glow: '#fff',
    badge: '鲜切现萃', title: ['鲜切果萃', '一口爆汁'], sub: '整颗鲜橙冷压 · 0 添加', price: '39', priceColor: '#EA580C', cta: ['#F97316', '#FB923C'], ctaText: '尝鲜果',
    decoTop: petal(58, 116, -20, '#FED7AA') + petal(306, 120, 36, '#FFEDD5'),
    product: fruitSlice(150, 430, 92, '#FDBA74', '#EA580C') + fruitSlice(266, 492, 46, '#FED7AA', '#F97316') + can(282, 420, 56, 104, '#FDBA74', '#EA580C', '橙汁'),
    decoBottom: petal(80, 510, 20, '#FB923C') + star(312, 470, 8, '#EA580C', 0.5),
  }),
  // 08 樱花系列
  poster({
    dark: false, ink: '#BE185D', inkSub: '#D6649A', bg: ['#FDF2F8', '#FBCFE8', '#F472B6'], glow: '#fff',
    badge: '樱花限定', title: ['樱花限定', '浪漫上市'], sub: '春日特调香氛 · 限量发售', price: '159', priceColor: '#DB2777', cta: ['#EC4899', '#DB2777'], ctaText: '限定入手',
    decoTop: petal(56, 110, -28, '#F472B6') + petal(90, 150, 20, '#F9A8D4') + petal(306, 116, 30, '#F472B6') + petal(282, 170, -16, '#FBCFE8'),
    product: bottle(180, 492, 100, 168, '#FBCFE8', '#EC4899', '樱花', '#831843'),
    decoBottom: petal(66, 500, -30, '#EC4899') + petal(300, 500, 24, '#F472B6') + petal(320, 440, 40, '#FBCFE8'),
  }),
  // 09 产品蛋糕
  poster({
    dark: false, ink: '#92400E', inkSub: '#B5793B', bg: ['#FFFBEB', '#FDE68A', '#FCD34D'], glow: '#fff',
    badge: '甜品工坊', title: ['甜蜜暴击', '限定蛋糕'], sub: '动物奶油 · 现烤现发', price: '69', priceColor: '#B45309', cta: ['#F59E0B', '#FBBF24'], ctaText: '来一块',
    decoTop: star(60, 120, 9, '#D97706', 0.55) + star(304, 140, 10, '#F59E0B', 0.5),
    product: cake(180, 500, 170, '#F59E0B', '#FBBF24'),
    decoBottom: star(70, 506, 8, '#D97706', 0.5) + star(300, 480, 8, '#B45309', 0.45),
  }),
  // 10 地标建筑
  poster({
    dark: true, bg: ['#0B1026', '#1D2B64', '#2B3A67'], glow: '#60A5FA',
    badge: '城市联名', title: ['城市之光', '地标联名'], sub: '把城市天际线装进产品里', price: '219', priceColor: '#FDE68A', cta: ['#3B82F6', '#8B5CF6'], ctaText: '收藏城市',
    decoTop: `<circle cx="296" cy="120" r="34" fill="#FDE68A" opacity="0.9"/><circle cx="284" cy="112" r="30" fill="#0B1026" opacity="0.9"/>` + star(70, 110, 8, '#93C5FD') + star(120, 76, 6, '#fff', 0.8),
    product: skyline(520, '#111736') + bottle(180, 500, 88, 150, '#93C5FD', '#1D4ED8', '天际'),
    decoBottom: star(60, 470, 8, '#FDE68A', 0.7),
  }),
  // 11 服饰
  poster({
    dark: true, bg: ['#2E1065', '#6D28D9', '#A855F7'], glow: '#D8B4FE',
    badge: '潮流新季', title: ['潮流新季', '焕新衣橱'], sub: '设计师联名 · 穿出高级感', price: '299', priceColor: '#FDE68A', cta: ['#8B5CF6', '#EC4899'], ctaText: '逛新款',
    decoTop: star(62, 118, 10, '#E9D5FF') + star(304, 130, 9, '#F0ABFC', 0.8),
    product: dress(180, 500, 0.9, '#E9D5FF', '#A855F7'),
    decoBottom: star(66, 496, 8, '#F0ABFC', 0.8) + star(306, 470, 9, '#E9D5FF', 0.7),
  }),
  // 12 节日气氛 · 好礼就位
  poster({
    dark: true, bg: ['#450A0A', '#B91C1C', '#DC2626'], glow: '#F87171', rays: '#FCA5A5',
    badge: '双11预售', title: ['好礼就位', '优惠拉满'], sub: '预售付定 · 尾款立减 50', price: '109', priceColor: '#FDE68A', cta: ['#F59E0B', '#EF4444'], ctaText: '付定金',
    decoTop: coin(58, 118, 16) + star(304, 120, 10, '#FDE68A') + star(300, 200, 8, '#FCA5A5', 0.8),
    product: jar(150, 490, 110, '#FCA5A5', '#DC2626', '修护霜') + giftBox(268, 496, 92, '#FDE68A', '#D4A017', '#B91C1C'),
    decoBottom: coin(48, 510, 13) + petal(312, 460, 24, '#FECACA'),
  }),
]

cases.forEach((svg, i) => {
  const file = join(OUT, `case_${String(i + 1).padStart(2, '0')}.svg`)
  writeFileSync(file, svg)
  console.log('✓', file.split(/[\\/]/).pop(), (svg.length / 1024).toFixed(1) + 'KB')
})
console.log(`\n共生成 ${cases.length} 张案例海报 → ${OUT}`)
