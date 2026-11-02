import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

// 确保.env最先加载（ESM import提升前手动加载）
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 数据库统一存放在 server/data/ 下
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/yimetai.db')

// 确保数据目录存在
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
-- ============ 用户与团队 ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT UNIQUE NOT NULL,            -- 登录账号（手机号）
  password TEXT NOT NULL,                  -- bcrypt加密
  name TEXT NOT NULL,
  phone TEXT,
  avatar TEXT,
  email TEXT,
  role_id INTEGER DEFAULT 2,               -- 1超管 2管理员 3成员
  department_id INTEGER,
  status INTEGER DEFAULT 1,                -- 1正常 0禁用
  ai_points INTEGER DEFAULT 1000,          -- AI点数
  invite_code TEXT,
  withdraw_account TEXT,                    -- 提现账户
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo TEXT,
  industry TEXT,
  remark TEXT,
  owner_id INTEGER,
  department_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  permissions TEXT,                          -- JSON数组
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 素材资产 ============
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                        -- image/video/audio
  url TEXT NOT NULL,
  cover TEXT,
  size INTEGER DEFAULT 0,
  duration REAL DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  category TEXT DEFAULT '未分类',
  tags TEXT,                                 -- JSON数组
  folder_id INTEGER DEFAULT 0,
  owner_id INTEGER,
  source TEXT DEFAULT 'upload',              -- upload/ai/generated
  status INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS material_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 脚本 ============
CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,                              -- 脚本正文
  product_name TEXT,
  brand_id INTEGER,
  category TEXT,
  status TEXT DEFAULT 'draft',               -- draft/published
  word_count INTEGER DEFAULT 0,
  owner_id INTEGER,
  owner_name TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 作品 ============
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'video',
  url TEXT,
  cover TEXT,
  duration REAL DEFAULT 0,
  source_module TEXT,                        -- replica/factory/studio/analysis/human/mix
  source_id INTEGER,
  owner_id INTEGER,
  status TEXT DEFAULT 'done',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 智能剪辑项目 ============
CREATE TABLE IF NOT EXISTS mix_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cover TEXT,
  status TEXT DEFAULT 'editing',             -- editing/exported
  script_id INTEGER,
  brand_id INTEGER,
  timeline TEXT,                             -- JSON 时间线数据
  duration REAL DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ AI任务 ============
CREATE TABLE IF NOT EXISTS ai_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT UNIQUE NOT NULL,
  module TEXT NOT NULL,                      -- replica/factory/studio/materialField/analysis/human/mix
  title TEXT,
  params TEXT,                               -- JSON 输入参数
  status TEXT DEFAULT 'pending',             -- pending/running/success/failed/canceled
  progress INTEGER DEFAULT 0,
  result TEXT,                               -- JSON 结果
  error TEXT,
  points_cost INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ AI Agent 会话 ============
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '新会话',
  skill TEXT,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,                        -- user/assistant
  content TEXT,
  attachments TEXT,                          -- JSON
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 爆款视频 ============
CREATE TABLE IF NOT EXISTS hot_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cover TEXT,
  video_url TEXT,
  platform TEXT DEFAULT 'douyin',            -- douyin/kuaishou/bilibili
  author TEXT,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  category TEXT,
  duration TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 投放数据 ============
CREATE TABLE IF NOT EXISTS advertisers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT DEFAULT 'qianchuan',         -- qianchuan/gdt/kuaishou/juliang
  advertiser_id TEXT,
  balance REAL DEFAULT 0,
  status INTEGER DEFAULT 1,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ad_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  advertiser_id INTEGER,
  status TEXT DEFAULT 'running',             -- running/paused
  budget REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  impression INTEGER DEFAULT 0,
  click INTEGER DEFAULT 0,
  conversion INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ad_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  advertiser_id INTEGER,
  date TEXT NOT NULL,
  cost REAL DEFAULT 0,
  impression INTEGER DEFAULT 0,
  click INTEGER DEFAULT 0,
  conversion INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 计费 ============
CREATE TABLE IF NOT EXISTS point_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  points INTEGER NOT NULL,
  price REAL NOT NULL,
  original_price REAL,
  tag TEXT,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS charge_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  package_id INTEGER,
  points INTEGER,
  amount REAL,
  status TEXT DEFAULT 'pending',             -- pending/paid/canceled
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS consumption_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  module TEXT,
  action TEXT,
  points INTEGER DEFAULT 0,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 系统 ============
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  module TEXT,
  action TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS version_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT,
  title TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS activity_popup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  image TEXT,
  link TEXT,
  status INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(type);
CREATE INDEX IF NOT EXISTS idx_materials_owner ON materials(owner_id);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_module ON ai_tasks(module);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_owner ON ai_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_hot_platform ON hot_videos(platform);
CREATE INDEX IF NOT EXISTS idx_ad_data_date ON ad_data(date);
CREATE INDEX IF NOT EXISTS idx_works_owner ON works(owner_id);
CREATE INDEX IF NOT EXISTS idx_works_source ON works(source_module, source_id);
CREATE INDEX IF NOT EXISTS idx_scripts_owner ON scripts(owner_id);
CREATE INDEX IF NOT EXISTS idx_consumption_user ON consumption_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advertisers_owner ON advertisers(owner_id);

-- ============ 消息中心 ============
CREATE TABLE IF NOT EXISTS center_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,
  type TEXT DEFAULT 'system',                -- system/task/marketing
  category TEXT DEFAULT '系统通知',
  is_read INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 新用户任务 ============
CREATE TABLE IF NOT EXISTS new_user_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  reward_points INTEGER DEFAULT 0,
  module TEXT,                                -- 跳转模块
  sort INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS new_user_task_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',              -- pending/completed/claimed
  completed_at TEXT,
  claimed_at TEXT,
  UNIQUE(task_id, user_id)
);

-- ============ 音乐库 ============
CREATE TABLE IF NOT EXISTS music (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT '热门',
  url TEXT,
  cover TEXT,
  duration REAL DEFAULT 0,
  artist TEXT,
  source TEXT DEFAULT 'library',              -- library/upload
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 字幕素材 ============
CREATE TABLE IF NOT EXISTS subtitle_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  video_url TEXT,
  subtitle_url TEXT,
  language TEXT DEFAULT '中文',
  status TEXT DEFAULT 'done',
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 精彩片段（直播剪辑） ============
CREATE TABLE IF NOT EXISTS highlight_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT DEFAULT 'live',            -- live/upload
  source_url TEXT,
  status TEXT DEFAULT 'pending',              -- pending/running/success/failed
  progress INTEGER DEFAULT 0,
  clip_count INTEGER DEFAULT 0,
  cover TEXT,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS highlight_clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  title TEXT,
  video_url TEXT,
  cover TEXT,
  duration REAL DEFAULT 0,
  tags TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 会员订单 ============
CREATE TABLE IF NOT EXISTS member_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  package_name TEXT,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',              -- pending/paid/canceled
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  paid_at TEXT
);

-- ============ 脚本海 ============
CREATE TABLE IF NOT EXISTS script_sea (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,
  content TEXT,
  industry TEXT,
  word_count INTEGER DEFAULT 0,
  claim_count INTEGER DEFAULT 0,
  cover TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS script_sea_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(script_id, user_id)
);

-- ============ 我的项目（团队） ============
CREATE TABLE IF NOT EXISTS my_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  industry TEXT,
  brand_id INTEGER,
  department_id INTEGER,
  script_count INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 数字人形象 ============
CREATE TABLE IF NOT EXISTS avatars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'public',                 -- public/custom
  category TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'active',
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 数字人创作链路资产（场景背景/IP形象/首帧） ============
CREATE TABLE IF NOT EXISTS human_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                         -- scene=口播场景背景 / persona=IP主播形象 / firstFrame=合成首帧
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  prompt TEXT,                                -- 实际使用的生成 prompt
  meta TEXT,                                  -- JSON：场景模板key、形象结构化约束等
  status TEXT DEFAULT 'active',
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ AI商拍模板 ============
CREATE TABLE IF NOT EXISTS commerce_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  direction TEXT,
  demo_url TEXT,
  cover TEXT,
  prompt TEXT,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 高清视频任务 ============
CREATE TABLE IF NOT EXISTS super_res_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_url TEXT,
  result_url TEXT,
  mode TEXT DEFAULT 'standard',               -- standard/pro
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ 三秒完播 ============
CREATE TABLE IF NOT EXISTS three_second_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  params TEXT,
  result_url TEXT,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  points_cost INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ 视频解析 ============
CREATE TABLE IF NOT EXISTS scene_analysis_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  video_url TEXT,
  status TEXT DEFAULT 'pending',              -- pending/running/success/failed
  progress INTEGER DEFAULT 0,
  result TEXT,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ 消除笔 ============
CREATE TABLE IF NOT EXISTS erase_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_url TEXT,
  result_url TEXT,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ 提现记录 ============
CREATE TABLE IF NOT EXISTS withdraw_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',              -- pending/success/failed
  account TEXT,
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  finished_at TEXT
);

-- ============ 数据罗盘 ============
CREATE TABLE IF NOT EXISTS compass_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  platform TEXT DEFAULT 'douyin',
  author TEXT,
  cover TEXT,
  play_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  category TEXT,
  analysis_status TEXT DEFAULT 'pending',
  owner_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 脚本分镜 ============
CREATE TABLE IF NOT EXISTS script_subitems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL,
  scene_no INTEGER DEFAULT 1,                -- 分镜序号
  scene_desc TEXT,                           -- 画面描述
  line TEXT,                                 -- 台词/口播
  duration REAL DEFAULT 3,                   -- 时长（秒）
  remark TEXT,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============ 反馈 ============
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'suggestion',
  content TEXT,
  contact TEXT,
  images TEXT,
  owner_id INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_subitems_script ON script_subitems(script_id);
CREATE INDEX IF NOT EXISTS idx_center_msg_owner ON center_messages(owner_id);
CREATE INDEX IF NOT EXISTS idx_highlight_clips_task ON highlight_clips(task_id);
CREATE INDEX IF NOT EXISTS idx_highlight_tasks_owner ON highlight_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_music_owner ON music(owner_id);
`)

// ============ 幂等列迁移（对已存在的旧表补充新增列） ============
function ensureColumn(table, column, ddl) {
  const cols = db.pragma(`table_info(${table})`)
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    console.log(`[db] 迁移: ${table} 增加 ${column} 列`)
  }
}
ensureColumn('materials', 'brand_id', 'brand_id INTEGER DEFAULT 0')
// Persist the upstream task and reservation so a restart never silently submits a duplicate.
ensureColumn('ai_tasks', 'provider_task_id', 'provider_task_id TEXT')
ensureColumn('ai_tasks', 'idempotency_key', 'idempotency_key TEXT')
ensureColumn('ai_tasks', 'billing_state', 'billing_state TEXT')
ensureColumn('ai_tasks', 'stage', 'stage TEXT')
db.exec(`CREATE TABLE IF NOT EXISTS long_video_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  duration REAL NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  provider_task_id TEXT,
  first_frame_url TEXT,
  result_url TEXT,
  UNIQUE(task_id, position)
)`)
ensureColumn('long_video_segments', 'soundscape', 'soundscape TEXT')
ensureColumn('long_video_segments', 'music', 'music TEXT')
ensureColumn('long_video_segments', 'quality_check', 'quality_check TEXT')
ensureColumn('long_video_segments', 'quality_attempts', 'quality_attempts INTEGER NOT NULL DEFAULT 0')
db.exec(`CREATE TABLE IF NOT EXISTS super_res_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  start_frame INTEGER NOT NULL,
  frame_count INTEGER NOT NULL,
  drop_prefix INTEGER NOT NULL,
  fps TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_task_id TEXT,
  input_url TEXT,
  result_url TEXT,
  UNIQUE(task_id, position)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS human_voice_workflows (
  task_id INTEGER PRIMARY KEY REFERENCES ai_tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  speech_file TEXT,
  speech_duration REAL,
  video_duration REAL,
  speech_check TEXT
)`)
ensureColumn('human_voice_workflows', 'speech_check', 'speech_check TEXT')
ensureColumn('human_voice_workflows', 'speech_timing', 'speech_timing TEXT')
ensureColumn('human_voice_workflows', 'subtitle_alignment', 'subtitle_alignment TEXT')
db.exec(`CREATE TABLE IF NOT EXISTS human_speech_segments (
  task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  speech_file TEXT,
  speech_duration REAL,
  PRIMARY KEY(task_id, position)
)`)

db.exec(`CREATE TABLE IF NOT EXISTS human_product_workflows (
  task_id INTEGER PRIMARY KEY REFERENCES ai_tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  provider_task_id TEXT,
  background_url TEXT,
  cutout_url TEXT,
  first_frame_url TEXT
)`)
db.exec(`CREATE TABLE IF NOT EXISTS human_lip_segments (
  task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  result_url TEXT NOT NULL,
  PRIMARY KEY(task_id, position)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS voice_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  provider_name TEXT NOT NULL UNIQUE,
  consent_granted_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`)
db.exec(`CREATE TABLE IF NOT EXISTS script_generation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`)

// 会员体系（商用化）：体验/月/年/企业
ensureColumn('users', 'vip_level', "vip_level TEXT DEFAULT 'trial'")
ensureColumn('users', 'vip_expire_at', 'vip_expire_at TEXT')
ensureColumn('users', 'storage_total', 'storage_total INTEGER DEFAULT 10737418240') // 默认10GB

// 套餐体系扩展：points=AI点充值 / member_personal / member_enterprise / extension=拓展包
ensureColumn('point_packages', 'type', "type TEXT DEFAULT 'points'")
ensureColumn('point_packages', 'period', 'period TEXT')                // 会员周期：1月/1年
ensureColumn('point_packages', 'bonus_points', 'bonus_points INTEGER DEFAULT 0') // 一次性赠送点数
ensureColumn('point_packages', 'unit_price', 'unit_price TEXT')        // AI点单价展示
ensureColumn('point_packages', 'expect_videos', 'expect_videos TEXT')  // 预计导出视频
ensureColumn('point_packages', 'benefits', 'benefits TEXT')            // 专属权益 JSON 数组
ensureColumn('point_packages', 'discount_tag', 'discount_tag TEXT')    // 限时7折 等角标

// 数据罗盘：封面已在表结构中，补充时长/评论/分享/AI分析结果
ensureColumn('compass_videos', 'duration', "duration TEXT DEFAULT '00:30'")
ensureColumn('compass_videos', 'comment_count', 'comment_count INTEGER DEFAULT 0')
ensureColumn('compass_videos', 'share_count', 'share_count INTEGER DEFAULT 0')
ensureColumn('compass_videos', 'analysis', 'analysis TEXT')             // AI分析 JSON：完播率/互动率/受众/爆款因子

// 高光智剪：扩展主播/平台/目标切片时长（对标原站视频信息表单）
ensureColumn('highlight_tasks', 'anchor', "anchor TEXT DEFAULT ''")
ensureColumn('highlight_tasks', 'platform', "platform TEXT DEFAULT ''")
ensureColumn('highlight_tasks', 'clip_duration', "clip_duration TEXT DEFAULT 'auto'")

// AI 素材模型溯源：materials 增加 model/engine 列（engine=real 为真实模型输出；mock 为降级模拟非模型产物）
ensureColumn('materials', 'model', 'model TEXT')
ensureColumn('materials', 'engine', "engine TEXT DEFAULT ''")

// ============ AI素材场：案例库 + IP形象库（深度复刻原站） ============
db.exec(`
CREATE TABLE IF NOT EXISTS mf_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tag TEXT NOT NULL,
  cover TEXT,
  video_url TEXT,
  prompt TEXT,
  play_count INTEGER DEFAULT 0,
  duration INTEGER DEFAULT 15,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS mf_avatars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cover TEXT,
  tags TEXT DEFAULT '[]',
  style TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
`)

export default db
