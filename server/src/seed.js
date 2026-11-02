import bcrypt from 'bcryptjs'
import db from './db.js'
import { initES, reindexAll, indexDoc } from './services/esService.js'
import crypto from 'crypto'

// ============ 种子数据：初始化演示环境 ============
// This script deletes existing business records. Never run it against a live database.
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DESTRUCTIVE_DEMO_SEED !== 'yes') {
  console.error('演示数据初始化会删除现有业务数据。仅可在隔离的非生产数据库中显式设置 ALLOW_DESTRUCTIVE_DEMO_SEED=yes 后运行。')
  process.exit(1)
}

if (!process.env.DEMO_ADMIN_PASSWORD || !process.env.DEMO_MEMBER_PASSWORD) {
  throw new Error('初始化演示数据前请设置 DEMO_ADMIN_PASSWORD 和 DEMO_MEMBER_PASSWORD')
}

const CDN = 'https://mcnvideo.yimetai.com/yyai'
const DEMO_VIDEOS = [
  `${CDN}/1784719717214.mp4`, `${CDN}/1784719807773.mp4`, `${CDN}/1784773791617.mp4`,
  `${CDN}/1784795966803.mp4`, `${CDN}/1784797155604.mp4`, `${CDN}/1784797221104.mp4`,
  `${CDN}/1784800899460.mp4`, `${CDN}/1784801023593.mp4`, `${CDN}/1784806949865.mp4`,
  `${CDN}/1784807300042.mp4`, `${CDN}/1784807676918.mp4`, `${CDN}/1784807915511.mp4`,
  `${CDN}/1784808154220.mp4`, `${CDN}/1784809842534.mp4`, `${CDN}/1784810230344.mp4`,
  `${CDN}/1784810292103.mp4`, `${CDN}/1784810725163.mp4`, `${CDN}/1784810879362.mp4`,
  `${CDN}/1784893143107.mp4`, `${CDN}/1784893205085.mp4`, `${CDN}/1784893724724.mp4`,
]

function rand(n) { return crypto.randomInt(0, n) }

async function seed() {
  console.log('开始初始化种子数据...')

  // 清理旧数据（同时重置自增序列，保证角色/用户ID稳定）
  db.exec(`
    DELETE FROM users; DELETE FROM departments; DELETE FROM brands; DELETE FROM roles;
    DELETE FROM materials; DELETE FROM material_folders; DELETE FROM scripts; DELETE FROM works;
    DELETE FROM mix_projects; DELETE FROM ai_tasks; DELETE FROM conversations; DELETE FROM messages;
    DELETE FROM hot_videos; DELETE FROM advertisers; DELETE FROM ad_groups; DELETE FROM ad_data;
    DELETE FROM point_packages; DELETE FROM charge_orders; DELETE FROM consumption_logs;
    DELETE FROM operation_logs; DELETE FROM version_notices; DELETE FROM activity_popup;
    DELETE FROM sqlite_sequence;
  `)

  // ============ 1. 部门 ============
  const depts = ['电商运营部', '内容创作部', '广告投放部', '品牌公关部']
  const deptIds = depts.map((name) => {
    const info = db.prepare('INSERT INTO departments (name, sort) VALUES (?, ?)').run(name, depts.indexOf(name))
    return info.lastInsertRowid
  })
  console.log(`✓ 部门 ${depts.length} 个`)

  // ============ 2. 角色 ============
  const roles = [
    { name: '超级管理员', code: 'super_admin', desc: '拥有全部权限', perms: ['all'] },
    { name: '管理员', code: 'admin', desc: '团队管理权限', perms: ['dashboard', 'agent', 'asset-library', 'hot', 'ai-mix', 'create', 'material_data', 'team'] },
    { name: '创作者', code: 'creator', desc: '内容创作权限', perms: ['dashboard', 'agent', 'asset-library', 'hot', 'ai-mix', 'create'] },
    { name: '投放专员', code: 'advertiser', desc: '广告投放权限', perms: ['dashboard', 'asset-library', 'material_data'] },
  ]
  const roleIds = roles.map((r) => {
    const info = db.prepare('INSERT INTO roles (name, code, description, permissions) VALUES (?, ?, ?, ?)')
      .run(r.name, r.code, r.desc, JSON.stringify(r.perms))
    return info.lastInsertRowid
  })
  console.log(`✓ 角色 ${roles.length} 个`)

  // ============ 3. 用户 ============
  // 主账号（复刻目标账号）
  const mainPassword = await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD, 10)
  const mainUser = db.prepare(`
    INSERT INTO users (account, password, name, phone, role_id, department_id, ai_points, invite_code, vip_level, vip_expire_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'trial', datetime('now', 'localtime', '+7 day'))
  `).run('demo-admin', mainPassword, '小兴', 'demo-admin', roleIds[0], deptIds[0], 50000, 'YY8888')
  const mainUserId = mainUser.lastInsertRowid

  // 团队成员
  const members = [
    { name: '示例成员1', account: 'demo-member-1', dept: 1, role: roleIds[1], points: 12000 },
    { name: '示例成员2', account: 'demo-member-2', dept: 1, role: roleIds[2], points: 8600 },
    { name: '示例成员3', account: 'demo-member-3', dept: 2, role: roleIds[2], points: 7300 },
    { name: '示例成员4', account: 'demo-member-4', dept: 2, role: roleIds[2], points: 5400 },
    { name: '示例成员5', account: 'demo-member-5', dept: 2, role: roleIds[3], points: 3200 },
    { name: '示例成员6', account: 'demo-member-6', dept: 3, role: roleIds[2], points: 4100 },
  ]
  const memberPassword = await bcrypt.hash(process.env.DEMO_MEMBER_PASSWORD, 10)
  const memberIds = members.map((m) => {
    const info = db.prepare(`
      INSERT INTO users (account, password, name, phone, role_id, department_id, ai_points, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(m.account, memberPassword, m.name, m.account, m.role, m.dept, m.points, mainUserId)
    return info.lastInsertRowid
  })
  console.log(`✓ 用户 ${1 + members.length} 个`)

  // ============ 4. 品牌客户 ============
  const brands = [
    { name: '花西子Florasis', industry: '美妆护肤', logo: '/images/brand_huaxizi.png' },
    { name: '完美日记', industry: '美妆护肤', logo: '/images/brand_perfectdiary.png' },
    { name: '三顿半', industry: '食品饮料', logo: '/images/brand_saturnbird.png' },
    { name: '花知晓', industry: '美妆护肤', logo: '/images/brand_flowerknows.png' },
    { name: '认养一头牛', industry: '食品饮料', logo: '/images/brand_yangqi.png' },
  ]
  const brandIds = brands.map((b) => {
    const info = db.prepare('INSERT INTO brands (name, industry, logo, owner_id, department_id) VALUES (?, ?, ?, ?, ?)')
      .run(b.name, b.industry, b.logo, mainUserId, deptIds[0])
    return info.lastInsertRowid
  })
  console.log(`✓ 品牌 ${brands.length} 个`)

  // ============ 5. 素材（资产库） ============
  const categories = ['口红', '面膜', '护肤套装', '咖啡', '礼盒', '产品图', '场景图', '口播视频']
  const materialNames = [
    ['正红色口红特写', '丝绒质地试色', '雾面唇釉展示', '口红礼盒开箱'],
    ['补水面膜敷用', '清洁面膜对比', '面膜成分特写', '面膜套装全家福'],
    ['水乳套装摆拍', '精华滴管特写', '面霜质地展示', '护肤步骤图解'],
    ['冷萃咖啡冲泡', '精品咖啡豆特写', '拿铁拉花过程', '咖啡礼盒展示'],
    ['年货礼盒开箱', '中秋礼盒展示', '双11限定礼盒', '生日礼盒推荐'],
    ['白底主图-口红', '白底主图-面霜', '场景图-梳妆台', '场景图-咖啡桌'],
    ['口播-产品介绍', '口播-促销宣讲', '口播-使用教程', '口播-用户互动'],
    ['抖音竖版-15s', '快手竖版-20s', 'B站横版-45s', '信息流-30s'],
  ]
  const materials = []
  let mid = 0
  for (let t = 0; t < 4; t++) {
    for (let i = 0; i < 8; i++) {
      mid++
      const isVideo = t === 3
      const name = materialNames[t][i % materialNames[t].length]
      materials.push({
        id: mid,
        name,
        type: isVideo ? 'video' : 'image',
        url: isVideo ? DEMO_VIDEOS[mid % DEMO_VIDEOS.length] : `${CDN}/1784795966803.jpg`,
        cover: isVideo ? DEMO_VIDEOS[(mid + 3) % DEMO_VIDEOS.length] : `${CDN}/1784795966803.jpg`,
        size: isVideo ? 5 * 1024 * 1024 + rand(10 * 1024 * 1024) : 500 * 1024 + rand(2 * 1024 * 1024),
        duration: isVideo ? 15 + rand(30) : 0,
        width: 1080, height: isVideo ? 1920 : 1080,
        category: categories[t * 2 + (i % 2)],
        tags: JSON.stringify(['带货', isVideo ? '视频' : '图片', categories[t * 2 + (i % 2)]]),
        owner_id: memberIds[rand(members.length)],
        source: i < 6 ? 'upload' : 'ai',
        created_at: new Date(Date.now() - rand(30) * 86400000).toISOString().slice(0, 19).replace('T', ' '),
      })
    }
  }
  const matStmt = db.prepare(`
    INSERT INTO materials (name, type, url, cover, size, duration, width, height, category, tags, owner_id, source, created_at)
    VALUES (@name, @type, @url, @cover, @size, @duration, @width, @height, @category, @tags, @owner_id, @source, @created_at)
  `)
  materials.forEach((m) => matStmt.run(m))
  console.log(`✓ 素材 ${materials.length} 个`)

  // ============ 6. 脚本 ============
  const scriptData = [
    { title: '双11口红促销口播脚本', product: '丝绒雾面口红', cat: '口播脚本', words: 320 },
    { title: '补水面膜测评视频脚本', product: '玻尿酸补水面膜', cat: '测评脚本', words: 450 },
    { title: '护肤套装种草分镜脚本', product: '烟酰胺水乳套装', cat: '分镜脚本', words: 580 },
    { title: '冷萃咖啡抖音带货脚本', product: '三顿半冷萃咖啡', cat: '口播脚本', words: 280 },
    { title: '年货节礼盒预热脚本', product: '新春限定礼盒', cat: '剧情脚本', words: 390 },
    { title: '新品首发倒计时脚本', product: '花知晓天使唇釉', cat: '口播脚本', words: 210 },
    { title: '用户证言合集脚本', product: '完美日记眼影盘', cat: '证言脚本', words: 340 },
    { title: '直播间引流短视频脚本', product: '认养一头牛酸奶', cat: '引流脚本', words: 180 },
  ]
  const scriptContents = [
    '姐妹们！双11最后一天！这支口红我囤了整整一打！丝绒质地不拔干，显白到发光！点击下方链接，领券立减50！',
    '熬夜党的救星来了！这款面膜我连续敷了28天，毛孔肉眼可见变细腻！成分党看过来：5重玻尿酸+积雪草，敏感肌也能放心用！',
    '一套搞定全套护肤！水-乳-精华三步走，28天见证肌肤焕变！现在下单送定制礼盒，数量有限先到先得！',
    '打工人续命神器！3秒一杯精品冷萃，阿拉比卡豆低温萃取，酸度柔和回甘明显！今天下单买二送一！',
    '年货节提前购！这套礼盒送长辈送客户都有面子！红金配色喜庆大气，内含6款明星单品，错过再等一年！',
    '新品首发倒计时3天！天使唇釉全新色号#03蔷薇蜜茶，黄皮天菜！评论区抽3位免费送！',
    '她们都变了！100位真实用户28天实测，91%表示肌肤含水量提升，87%表示细纹淡化！数据不会说谎！',
    '家人们！今晚8点直播间超级秒杀！这款酸奶买整箱送周边，前100名再减20！点击头像进直播间！',
  ]
  const scriptIds = scriptData.map((s, i) => {
    const info = db.prepare(`
      INSERT INTO scripts (title, content, product_name, brand_id, category, status, word_count, owner_id, owner_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.title, scriptContents[i], s.product, brandIds[i % brandIds.length], s.cat,
      i % 3 === 0 ? 'draft' : 'published', s.words,
      memberIds[rand(members.length)], members[rand(members.length)].name
    )
    return info.lastInsertRowid
  })
  console.log(`✓ 脚本 ${scriptIds.length} 个`)

  // ============ 7. 爆款视频 ============
  const hotTitles = [
    '这支口红真的绝了！黄皮亲妈显白到发光', '90%的人洗脸方式都错了！你中招了吗',
    '一套水乳搞定全年护肤！贫民窟女孩福音', '3秒get一杯精品咖啡！打工人续命神器',
    '年货节必囤！这个礼盒送人太有面子了', '面膜敷错等于白敷！正确用法快收藏',
    '男生也说好看的口红色号！约会必备', '直播间秒杀的酸奶也太划算了！整箱囤',
    '28天实测！这款精华让我重回18岁', '双11避坑指南！这5样千万别买',
    '懒人护肤法！3步搞定水光肌', '咖啡控必看！在家也能喝到星巴克同款',
    '秋冬显白口红试色！第3支美哭了', '敏感肌护肤清单！成分党强烈推荐',
    '打工人早餐新选择！3分钟搞定营养餐', '这款眼影盘美到失语！新手也能画出高级感',
    '不输大牌的国货之光！价格只有三分之一', '面膜成分大起底！这些成分才值得买',
    '年货节最值得买的5件好物清单', '直男送礼指南！这份清单抄作业就行',
  ]
  const hotAuthors = ['美妆蛋蛋', '护肤小百科', '省钱小能手', '咖啡猫Cat', '年货推荐官', '成分党Lina', '直男阿杰', '牛奶爱好者', '抗老研究所', '避坑指南姐']
  const hotCats = ['美妆', '护肤', '食品', '穿搭', '生活', '剧情']
  const platforms = ['douyin', 'douyin', 'douyin', 'kuaishou', 'bilibili']
  // 封面复用 AI商拍示例图（真实可用的本地资源）
  const hotCovers = [
    '/images/aiShoot/samples/product-main-02.png', '/images/aiShoot/samples/product-main-01.png',
    '/images/aiShoot/samples/product-photography-01.png', '/images/aiShoot/samples/product-wear-01.png',
    '/images/aiShoot/samples/product-detail-01.png', '/images/aiShoot/samples/product-wear-02.png',
  ]
  const hotIds = hotTitles.map((title, i) => {
    const platform = platforms[i % platforms.length]
    const info = db.prepare(`
      INSERT INTO hot_videos (title, cover, video_url, platform, author, likes, comments, shares, category, duration, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      hotCovers[i % hotCovers.length],
      DEMO_VIDEOS[i % DEMO_VIDEOS.length],
      platform,
      hotAuthors[i % hotAuthors.length],
      10000 + rand(900000),
      500 + rand(20000),
      100 + rand(10000),
      hotCats[i % hotCats.length],
      `00:${String(15 + rand(45)).padStart(2, '0')}`,
      new Date(Date.now() - rand(7) * 86400000).toISOString().slice(0, 10)
    )
    return info.lastInsertRowid
  })
  console.log(`✓ 爆款视频 ${hotIds.length} 个`)

  // ============ 8. 广告账户与数据 ============
  const advertisers = [
    { name: '花西子旗舰店-千川', platform: 'qianchuan', aid: 'QIANCHUAN_10086' },
    { name: '完美日记-腾讯广告', platform: 'gdt', aid: 'GDT_20240' },
    { name: '三顿半-磁力金牛', platform: 'kuaishou', aid: 'KS_77821' },
    { name: '花知晓-聚量引擎', platform: 'juliang', aid: 'JL_55621' },
  ]
  const advIds = advertisers.map((a) => {
    const info = db.prepare('INSERT INTO advertisers (name, platform, advertiser_id, balance, owner_id) VALUES (?, ?, ?, ?, ?)')
      .run(a.name, a.platform, a.aid, 5000 + rand(50000), mainUserId)
    return info.lastInsertRowid
  })

  // 广告组
  const adGroups = [
    '爆款复刻-口红色号推广', '面膜种草-夜间流量', '护肤套装-宝妈人群', '咖啡复购-办公室场景',
    '礼盒预售-企业采购', '眼影盘教程-新手向', '酸奶试饮-家庭装', '精华抗老-30+人群',
  ]
  const groupIds = adGroups.map((name, i) => {
    const info = db.prepare('INSERT INTO ad_groups (name, advertiser_id, status, budget, cost, impression, click, conversion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        name, advIds[i % advIds.length], i % 5 === 0 ? 'paused' : 'running',
        1000 + rand(9000), 500 + rand(8000),
        50000 + rand(500000), 1000 + rand(30000), 50 + rand(2000)
      )
    return info.lastInsertRowid
  })
  console.log(`✓ 广告账户 ${advIds.length} 个，广告组 ${groupIds.length} 个`)

  // 近30天投放数据
  const adDataStmt = db.prepare(`
    INSERT INTO ad_data (advertiser_id, date, cost, impression, click, conversion)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  let dataCount = 0
  for (let d = 29; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
    advIds.forEach((aid) => {
      const base = 800 + rand(2500)
      const impression = 30000 + rand(200000)
      const click = Math.floor(impression * (0.02 + rand(30) / 1000))
      const conversion = Math.floor(click * (0.03 + rand(80) / 1000))
      adDataStmt.run(aid, date, base, impression, click, conversion)
      dataCount++
    })
  }
  console.log(`✓ 投放数据 ${dataCount} 条`)

  // ============ 9. 商用套餐体系（对标原站：个人版/企业版/AI点充值/拓展包） ============
  const packages = [
    // ---- 个人版会员 ----
    { name: '个人版-月会员', type: 'member_personal', period: '1月', points: 0, price: 98, original: 140, tag: '', sort: 1,
      bonus: 180, unit: 'AI点单价：0.55元', expect: '预计导出视频：60条', discount: '限时7折',
      benefits: JSON.stringify(['存储空间：10GB', '爆款速递', '字幕去除', 'AI素材场：XingTu-2.0 Pro 低至7折', 'AI素材场：XingTu-2.5 低至5折', '批量智能混剪', '智能脚本', '脚本公海', '画质增强']) },
    { name: '个人版-年度会员', type: 'member_personal', period: '1年', points: 0, price: 875, original: 1250, tag: '最受欢迎', sort: 2,
      bonus: 2160, unit: 'AI点单价：0.4元', expect: '预计导出视频：720条', discount: '限时7折',
      benefits: JSON.stringify(['存储空间：150GB', 'AI素材场：XingTu-2.0 Pro 低至7折', 'AI素材场：XingTu-2.5 低至5折', 'AI梦工厂 会员享9折', '批量智能混剪', '爆款速递', '字幕去除', '高光智剪', 'IP形象库', '视频解析', '爆款创作', '爆款复刻Agent']) },
    // ---- 企业版会员 ----
    { name: '企业版-月会员', type: 'member_enterprise', period: '1月', points: 0, price: 498, original: 998, tag: '', sort: 3,
      bonus: 1000, unit: 'AI点单价：0.42元', expect: '预计导出视频：500条', discount: '低至5折',
      benefits: JSON.stringify(['存储空间：500GB', '企业人数：10席', '团队协作空间', 'AI素材场：XingTu-2.5 低至4.5折', '专属客服通道', '批量智能混剪', '全部个人版权益']) },
    { name: '企业版-年度会员', type: 'member_enterprise', period: '1年', points: 0, price: 4980, original: 9980, tag: '团队首选', sort: 4,
      bonus: 15000, unit: 'AI点单价：0.32元', expect: '预计导出视频：6000条', discount: '低至5折',
      benefits: JSON.stringify(['存储空间：2TB', '企业人数：50席', '专属客户成功经理', 'API 开放平台接入', 'AI素材场：XingTu-2.5 低至4折', '全部个人版权益', '私有化素材隔离']) },
    // ---- AI点充值 ----
    { name: '体验包', type: 'points', points: 1000, price: 9.9, original: 19.9, tag: '新用户专享', sort: 10, bonus: 0, unit: 'AI点单价：0.0099元' },
    { name: '基础包', type: 'points', points: 5000, price: 39.9, original: 59.9, tag: '', sort: 11, bonus: 0, unit: 'AI点单价：0.008元' },
    { name: '热门包', type: 'points', points: 12000, price: 89.9, original: 129.9, tag: '最受欢迎', sort: 12, bonus: 0, unit: 'AI点单价：0.0075元' },
    { name: '专业包', type: 'points', points: 30000, price: 199.9, original: 299.9, tag: '超值优惠', sort: 13, bonus: 0, unit: 'AI点单价：0.0067元' },
    { name: '企业包', type: 'points', points: 100000, price: 599.9, original: 999.9, tag: '团队首选', sort: 14, bonus: 0, unit: 'AI点单价：0.006元' },
    // ---- 拓展包 ----
    { name: '存储拓展包 100GB', type: 'extension', points: 0, price: 68, original: 98, tag: '', sort: 20, bonus: 0, unit: '有效期：1年' },
    { name: '团队席位包 +5席', type: 'extension', points: 0, price: 128, original: 188, tag: '', sort: 21, bonus: 0, unit: '有效期：1年' },
    { name: '数字人克隆音色', type: 'extension', points: 2000, price: 198, original: 398, tag: '新功能', sort: 22, bonus: 0, unit: '含音色训练1次' },
  ]
  const insertPkg = db.prepare(`INSERT INTO point_packages (name, type, period, points, bonus_points, price, original_price, tag, discount_tag, unit_price, expect_videos, benefits, sort)
    VALUES (@name, @type, @period, @points, @bonus, @price, @original, @tag, @discount, @unit, @expect, @benefits, @sort)`)
  packages.forEach((p) => {
    insertPkg.run({
      name: p.name, type: p.type, period: p.period || null, points: p.points, bonus: p.bonus || 0,
      price: p.price, original: p.original, tag: p.tag || null, discount: p.discount || null,
      unit: p.unit || null, expect: p.expect || null, benefits: p.benefits || null, sort: p.sort,
    })
  })
  console.log(`✓ 套餐体系 ${packages.length} 个`)

  // ============ 10. 系统数据 ============
  db.prepare('INSERT INTO version_notices (version, title, content) VALUES (?, ?, ?)')
    .run('v2.5.0', '全新AI素材场上线', '爆款Agent帮你复刻翻拍同款素材，批量产出投放素材，快来体验吧！')

  db.prepare('INSERT INTO activity_popup (title, image, link, status) VALUES (?, ?, ?, 1)')
    .run('新手创作营', '/images/dashboard/icon_new_user_guide.png', '/dashboard')

  // 登录日志
  db.prepare('INSERT INTO operation_logs (user_id, user_name, module, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mainUserId, '小兴', '登录', '密码登录', '登录成功', '127.0.0.1')

  // 消费记录
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(mainUserId, 'replica', 'AI生成', -100, '爆款复刻任务')
  db.prepare('INSERT INTO consumption_logs (user_id, module, action, points, remark) VALUES (?, ?, ?, ?, ?)')
    .run(mainUserId, 'charge', '充值', 10000, '热门包充值')

  // 示例会话
  const convInfo = db.prepare('INSERT INTO conversations (title, skill, owner_id) VALUES (?, ?, ?)')
    .run('口红脚本创作讨论', 'script', mainUserId)
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(convInfo.lastInsertRowid, 'user', '帮我写一个口红的带货口播脚本')
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(convInfo.lastInsertRowid, 'assistant', '好的，这是为你创作的口红带货口播脚本：【黄金3秒钩子】"别再乱买了！这支口红显白到发光！"...')

  // 智能剪辑示例项目
  db.prepare('INSERT INTO mix_projects (name, cover, status, script_id, brand_id, duration, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('双11口红促销混剪', DEMO_VIDEOS[0], 'editing', scriptIds[0], brandIds[0], 45, mainUserId)
  db.prepare('INSERT INTO mix_projects (name, cover, status, script_id, brand_id, duration, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('面膜种草视频剪辑', DEMO_VIDEOS[1], 'exported', scriptIds[1], brandIds[1], 38, mainUserId)

  console.log('✓ 系统数据初始化完成')

  // ============ 10.5 新模块种子数据 ============
  // 新用户任务
  const newUserTasks = [
    ['完善个人资料', '上传头像并填写昵称，领取奖励', 100, '/user/info'],
    ['创建第一个脚本', '使用AI脚本创作生成你的第一个脚本', 200, '/my-scripts'],
    ['上传第一个素材', '上传图片或视频到资产库', 100, '/asset-library'],
    ['体验AI Agent', '与AI Agent对话一次', 150, '/agent'],
    ['创作第一个作品', '使用任意AI创作功能生成作品', 300, '/dashboard'],
  ]
  newUserTasks.forEach((t, i) => {
    db.prepare('INSERT INTO new_user_tasks (name, description, reward_points, module, sort) VALUES (?, ?, ?, ?, ?)')
      .run(t[0], t[1], t[2], t[3], i)
  })

  // 消息中心
  const messages = [
    ['欢迎使用兴图智创', '欢迎注册兴图智创AIGC视频分镜创作平台！完成新手任务可领取海量AI点数，快去创作吧～', 'system', '系统通知'],
    ['系统升级通知', 'V2.5.0版本已发布：新增精彩片段直播剪辑、数据罗盘功能，快来体验！', 'system', '版本更新'],
    ['新用户专享福利', '首充套餐限时8折，多充多送，点击充值中心查看详情。', 'marketing', '优惠活动'],
    ['创作小助手', '小提示：使用爆款复刻功能可以快速拆解热门视频结构，助你高效起号。', 'system', '创作技巧'],
  ]
  messages.forEach((m) => {
    db.prepare('INSERT INTO center_messages (title, content, type, category, owner_id) VALUES (?, ?, ?, ?, ?)')
      .run(m[0], m[1], m[2], m[3], mainUserId)
  })

  // 音乐库
  const musicList = [
    ['燃趣节奏', 'trend', 30], ['夏日清新', 'gentle', 45], ['史诗冲击', 'epic', 60],
    ['轻快日常', 'gentle', 35], ['促销高潮', 'trend', 28], ['幽默搞怪', 'funny', 22],
    ['温柔钢琴', 'gentle', 52], ['动感电子', 'trend', 33], ['国风古韵', 'epic', 48],
    ['热门推荐BGM', 'hot', 40],
  ]
  musicList.forEach((m) => {
    db.prepare('INSERT INTO music (name, category, duration, artist) VALUES (?, ?, ?, ?)')
      .run(m[0], m[1], m[2], '兴图音乐库')
  })

  // 脚本海
  const scriptSeaList = [
    ['口红带货口播脚本', '美妆护肤', '【黄金3秒】姐妹们！这支口红显白到发光！...', 328],
    ['面霜种草分镜脚本', '美妆护肤', '【场景一】干燥起皮特写 →【场景二】面霜质地展示...', 412],
    ['零食带货快节奏脚本', '食品饮料', '【钩子】吃货必看！这款零食好吃到舔手指！...', 256],
    ['小家电演示脚本', '数码家电', '【痛点】厨房太小放不下烤箱？【方案】这台空气炸锅...', 385],
    ['服装穿搭展示脚本', '服装鞋包', '【上身】显瘦穿搭三件套，梨形身材必入！...', 298],
    ['家居好物分享脚本', '家居日用', '【开场】租房党必看！这些好物让家焕然一新...', 342],
  ]
  scriptSeaList.forEach((s) => {
    db.prepare('INSERT INTO script_sea (title, category, content, industry, word_count, claim_count, cover) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s[0], s[1], s[2], s[1], s[3], 20 + Math.floor(Math.random() * 100), '/images/course/course_1.png')
  })

  // 我的项目
  const projectList = [
    ['双11大促 campaign', '电商带货', brandIds[0]],
    ['品牌年度宣传', '品牌宣传', brandIds[1]],
    ['新品上市推广', '电商带货', brandIds[0]],
  ]
  projectList.forEach((p) => {
    db.prepare('INSERT INTO my_projects (name, industry, brand_id, script_count, owner_id) VALUES (?, ?, ?, ?, ?)')
      .run(p[0], p[1], p[2], 2, mainUserId)
  })

  // 数字人形象
  const avatarList = [
    ['都市丽人', 'public', '电商带货', '/images/avatar/avatar_1.png'],
    ['阳光青年', 'public', '知识口播', '/images/avatar/avatar_2.png'],
    ['职业女性', 'public', '品牌宣传', '/images/avatar/avatar_3.png'],
    ['亲和主播', 'public', '电商带货', '/images/avatar/avatar_4.png'],
  ]
  avatarList.forEach((a) => {
    db.prepare('INSERT INTO avatars (name, type, category, image_url) VALUES (?, ?, ?, ?)')
      .run(a[0], a[1], a[2], a[3])
  })

  // AI商拍模板
  const templateList = [
    ['白底主图标准模板', '服装鞋包', 'white_bg', '/images/demo/commerce_1.png'],
    ['ins风场景模板', '美妆护肤', 'scene', '/images/demo/commerce_2.png'],
    ['模特上身展示', '服装鞋包', 'model', '/images/demo/commerce_3.png'],
    ['细节特写模板', '数码家电', 'detail', '/images/demo/commerce_1.png'],
    ['节日促销模板', '食品饮料', 'scene', '/images/demo/commerce_2.png'],
    ['对比效果模板', '美妆护肤', 'detail', '/images/demo/commerce_3.png'],
  ]
  templateList.forEach((t) => {
    db.prepare('INSERT INTO commerce_templates (name, category, direction, demo_url, cover, prompt, usage_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t[0], t[1], t[2], t[3], t[3], '专业商拍风格，高清质感', 50 + Math.floor(Math.random() * 200))
  })

  // 数据罗盘视频（24条去重数据 + 分类SVG封面 + AI分析，见 compass-data.js）
  const { seedCompass } = await import('./compass-data.js')
  seedCompass(db, mainUserId)

  console.log('✓ 新模块种子数据完成（任务/消息/音乐/脚本海/项目/形象/模板/罗盘）')

  // ============ 11. 重建ES索引 ============
  await initES()
  const esMaterials = db.prepare('SELECT * FROM materials').all().map((m) => ({
    id: m.id, name: m.name, type: m.type, category: m.category,
    tags: JSON.parse(m.tags || '[]'), url: m.url, cover: m.cover,
    size: m.size, duration: m.duration, width: m.width, height: m.height,
    source: m.source, owner_id: m.owner_id, created_at: m.created_at,
  }))
  const esScripts = db.prepare('SELECT * FROM scripts').all().map((s) => ({
    id: s.id, title: s.title, content: s.content, product_name: s.product_name,
    category: s.category, status: s.status, owner_id: s.owner_id,
    owner_name: s.owner_name, created_at: s.created_at,
  }))
  const esHot = db.prepare('SELECT * FROM hot_videos').all().map((h) => ({
    id: h.id, title: h.title, platform: h.platform, author: h.author,
    category: h.category, likes: h.likes, comments: h.comments,
    shares: h.shares, published_at: h.published_at,
  }))

  await reindexAll('materials', esMaterials)
  await reindexAll('scripts', esScripts)
  await reindexAll('hot', esHot)

  console.log(`
╔══════════════════════════════════════════════════╗
║              种子数据初始化完成！                  ║
╠══════════════════════════════════════════════════╣
║  登录账号: demo-admin                            ║
║  登录密码: 由 DEMO_ADMIN_PASSWORD 环境变量提供                           ║
║  AI点数:   50000                                  ║
╚══════════════════════════════════════════════════╝
  `)
  process.exit(0)
}

seed().catch((e) => {
  console.error('种子数据初始化失败:', e)
  process.exit(1)
})
