import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Progress, Tag, Empty, Modal, message } from 'antd'
import {
  ThunderboltOutlined, RightOutlined, FireOutlined,
  PictureOutlined, CustomerServiceOutlined, VideoCameraOutlined,
  RocketOutlined, GiftOutlined, TrophyOutlined, RiseOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import { api } from '../api/request'
import { useUserStore } from '../stores/userStore'
import { withBase } from "../utils/base"

// AI创作功能卡片（对标原站：含 HOT 角标与写实封面）
const FEATURES = [
  { key: 'hit-replica', title: '爆款复刻', desc: '参考视频语音与文字生成', badge: '部分可用', path: '/create/hit-replica', cover: '/images/dashboard/features/hit-replica.svg', hot: true },
  { key: 'video-goldTime', title: 'AI梦工厂', desc: '用产品图片生成展示视频', badge: '', path: '/create/video-goldTime', cover: '/images/dashboard/features/video-goldTime.svg' },
  { key: 'ai-product-studio', title: 'AI商拍', desc: '商品抠图并合成 AI 场景', badge: '', path: '/create/ai-product-studio', cover: '/images/dashboard/features/ai-product-studio.svg' },
  { key: 'video-generation', title: 'AI素材场', desc: '文字与首尾帧生成视频', badge: '', path: '/create/video-generation', cover: '/images/dashboard/features/video-generation.svg' },
  { key: 'video-analysis', title: '视频解析', desc: '提取视频语音和画面文字', badge: '', path: '/create/video-analysis', cover: '/images/dashboard/features/video-analysis.svg' },
  { key: 'digital-human', title: '百变数字人', desc: '快速创建多样化数字人视频', badge: '', path: '/create/digital-human', cover: '/images/dashboard/features/digital-human.svg' },
]

// 新手引导步骤
const GUIDE_STEPS = [
  { no: '01', title: '添加品牌客户', desc: '创建品类文件为AI剪辑第一步', icon: '/images/menu/menu_plgl.png', path: '/setting/userManage', action: '开始创作' },
  { no: '02', title: '素材上传', desc: '品牌素材资产管理', icon: '/images/guide/home_guide_material.png', path: '/asset-library', action: '去上传' },
  { no: '03', title: '脚本创作', desc: '创建品牌脚本项目', icon: '/images/menu/script.png', path: '/my-scripts', action: '去创建' },
  { no: '04', title: '自动生成视频', desc: '文字与首尾帧生成视频', icon: '/images/guide/home_guide_match.png', path: '/create/video-generation', action: '去创作' },
  { no: '05', title: '添加配音与字幕', desc: '为视频合成授权音色与字幕', icon: '/images/guide/home_guide_export.png', path: '/voice', action: '去配音' },
]

// 案例教程数据
const CASES = [
  { id: 1, title: '智能混剪配音版（案例一）', cover: '/images/tutorial/brand_toothpaste.png', tag: '案例展示', cat: '智能剪辑' },
  { id: 2, title: '智能混剪氛围感（案例二）', cover: '/images/tutorial/creation_mix.png', tag: '案例展示', cat: '智能剪辑' },
  { id: 3, title: '达人+空镜混剪（案例三）', cover: '/images/tutorial/role_director.png', tag: '案例展示', cat: '智能剪辑' },
  { id: 4, title: 'AI商拍：商品图变影棚大片', cover: '/images/tutorial/creation_aiShoot.png', tag: '案例展示', cat: 'AI创作' },
  { id: 5, title: '投放数据看板使用详解', cover: '/images/blog/blog01.png', tag: '案例展示', cat: '案例展示' },
  { id: 6, title: '素材库高效管理技巧', cover: '/images/blog/blog02.png', tag: '案例展示', cat: '案例展示' },
]
const CASE_TABS = ['全部', '案例展示', '智能剪辑', 'AI创作']

// 子路径部署:静态资源补前缀(path 为路由路径,由 Router basename 处理,不改)
for (const item of [...FEATURES, ...GUIDE_STEPS, ...CASES] as Array<Record<string, any>>) {
  if (item.cover) item.cover = withBase(item.cover)
  if (item.icon) item.icon = withBase(item.icon)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [guideVisible, setGuideVisible] = useState(false)
  const [trend, setTrend] = useState<any[]>([])
  const [ranking, setRanking] = useState<any[]>([])
  const [rewardTasks, setRewardTasks] = useState<any[]>([])
  const [totalReward, setTotalReward] = useState(0)
  const [caseTab, setCaseTab] = useState('全部')

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 3000)
    return () => clearInterval(timer)
  }, [])

  const fetchData = async () => {
    const [taskData, statData, trendData, rankData, rewardData] = await Promise.allSettled([
      api.tasks({ pageSize: 10 }),
      api.assetStatistics(),
      api.boardTrend(),
      api.boardRanking(),
      api.newUserTasks(),
    ])
    if (taskData.status === 'fulfilled') setTasks(taskData.value?.list || [])
    if (statData.status === 'fulfilled') setStats(statData.value)
    if (trendData.status === 'fulfilled') setTrend(trendData.value?.list || [])
    if (rankData.status === 'fulfilled') setRanking(rankData.value?.list || [])
    if (rewardData.status === 'fulfilled') {
      setRewardTasks(rewardData.value?.list || [])
      setTotalReward(rewardData.value?.totalReward || 0)
    }
  }

  const handleClaim = async (taskId: number) => {
    try {
      const d: any = await api.claimReward({ taskId })
      message.success(`领取成功，获得 ${d.points} AI点数`)
      const userInfo = await api.userInfo()
      useUserStore.setState({ userInfo })
      fetchData()
    } catch {}
  }

  const runningTasks = tasks.filter((t) => t.status === 'running' || t.status === 'pending')
  const pendingRewards = rewardTasks.filter((t) => t.status === 'completed')
  const filteredCases = caseTab === '全部' ? CASES : CASES.filter((c) => c.cat === caseTab)

  return (
    <div className="mx-auto max-w-7xl pb-6">
      {/* ============ 居中大标题（对标原站 + 素材场光晕字） ============ */}
      <div className="relative pb-2 pt-6 text-center">
        <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-[520px] -translate-x-1/2 rounded-full bg-purple-600/15 blur-[70px]" />
        <h1 className="relative text-[26px] font-black tracking-wide text-white">
          从脚本创作到素材智能匹配 <span className="mf-glow-text italic">AI一站式搞定</span>
        </h1>
      </div>

      {/* ============ 智能剪辑：新手创作营 + 5步 ============ */}
      <SectionTitle icon={<RocketOutlined />} title="智能剪辑" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {/* 新手创作营大卡 */}
        <div
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-600/30 via-[#1a1030] to-fuchsia-600/20 p-5 transition-all hover:shadow-[0_0_28px_rgba(139,92,246,.35)]"
          onClick={() => setGuideVisible(true)}
        >
          <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-fuchsia-500/25 blur-2xl" />
          <h3 className="text-lg font-black text-white">新手创作营</h3>
          <p className="mt-1 text-xs text-mf-sub">3分钟快速掌握创作流程</p>
          <button className="mt-5 flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black transition-transform group-hover:scale-105">
            立即体验 <RightOutlined className="text-[10px]" />
          </button>
          <img src={withBase('/images/tutorial/creation_arrow.png')} alt="" className="absolute bottom-2 right-2 h-14 w-14 opacity-80" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        {GUIDE_STEPS.map((step) => (
          <div
            key={step.no}
            className="group relative cursor-pointer rounded-2xl border border-mf-border2 bg-mf-card p-4 transition-all hover:border-mf-hover hover:shadow-[0_0_20px_rgba(139,92,246,.18)]"
            onClick={() => navigate(step.path)}
          >
            <span className="absolute right-3 top-2 text-2xl font-black text-mf-border transition-colors group-hover:text-purple-500/40">{step.no}</span>
            <img src={withBase(step.icon)} alt="" className="h-8 w-8" onError={(e) => { (e.target as HTMLImageElement).src = withBase('/images/menu/center.png') }} />
            <h3 className="mt-3 text-sm font-medium text-mf-text">{step.title}</h3>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-mf-faint">{step.desc}</p>
            <button className="mt-3 rounded-full border border-purple-500/50 px-3 py-0.5 text-[11px] text-mf-accent transition-colors group-hover:bg-purple-600/20">
              {step.action}
            </button>
          </div>
        ))}
      </div>

      {/* ============ AI创作 ============ */}
      <SectionTitle icon={<ThunderboltOutlined />} title="AI创作" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {FEATURES.map((f) => (
          <div
            key={f.key}
            className="group relative cursor-pointer overflow-hidden rounded-2xl border border-mf-border2 bg-mf-card transition-all hover:-translate-y-0.5 hover:border-purple-500/60 hover:shadow-[0_0_24px_rgba(139,92,246,.25)]"
            onClick={() => navigate(f.path)}
          >
            {f.badge && (
              <span className="absolute left-2 top-2 z-10 rounded bg-gradient-to-r from-red-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{f.badge}</span>
            )}
            <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-[#241a44] to-mf-card2">
              <img src={withBase(f.cover)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                <PlayCircleOutlined className="text-3xl text-white/90" />
              </div>
            </div>
            <div className="p-3">
              <h3 className="text-sm font-bold text-mf-text">{f.title}</h3>
              <p className="mt-0.5 line-clamp-1 text-[11px] text-mf-faint">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ============ 数据看板（任务/趋势/资产/排行/奖励） ============ */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 进行中任务 */}
        <div className="rounded-2xl border border-mf-border2 bg-mf-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-white"><RiseOutlined className="mr-2 text-mf-accent" />进行中任务</h2>
            <Button type="link" size="small" className="!text-mf-accent" onClick={() => navigate('/agent')}>全部任务 <RightOutlined /></Button>
          </div>
          {runningTasks.length > 0 ? (
            <div className="space-y-3">
              {runningTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl bg-mf-card2 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-600/15">
                    <VideoCameraOutlined className="text-mf-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-mf-text">{t.title || t.module}</span>
                      <Tag color="processing" className="!text-[10px]">{t.stage || '生成中'}</Tag>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="暂无进行中任务" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <button className="mf-btn-gradient rounded-full px-5 py-1.5 text-sm" onClick={() => navigate('/create/video-generation')}>去创作</button>
            </Empty>
          )}
          {/* 消耗趋势 */}
          {trend.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs text-mf-faint">
                <span>近14天点数消耗趋势</span><span>单位：AI点数</span>
              </div>
              <div className="flex h-20 items-end gap-1">
                {trend.map((d: any, i: number) => {
                  const max = Math.max(...trend.map((t) => t.points), 1)
                  const h = (d.points / max) * 100
                  return (
                    <div key={i} className="group flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.points}点`}>
                      <div className="w-full rounded-t bg-gradient-to-t from-purple-600/50 to-fuchsia-500 transition-all hover:to-fuchsia-400" style={{ height: `${Math.max(h, 3)}%` }} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 资产概览 */}
        <div className="rounded-2xl border border-mf-border2 bg-mf-card p-5">
          <h2 className="mb-4 text-base font-bold text-white"><PictureOutlined className="mr-2 text-mf-accent" />资产库概览</h2>
          <div className="space-y-3">
            <StatItem icon={<PictureOutlined />} label="图片素材" value={stats?.imageCount || 0} color="text-blue-400" />
            <StatItem icon={<VideoCameraOutlined />} label="视频素材" value={stats?.videoCount || 0} color="text-purple-400" />
            <StatItem icon={<CustomerServiceOutlined />} label="音频素材" value={stats?.audioCount || 0} color="text-orange-400" />
            <div className="border-t border-mf-border2 pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-mf-dim">存储空间</span>
                <span className="text-mf-text">{((stats?.usedSize || 0) / 1024 / 1024).toFixed(1)}MB / {((stats?.totalSize || 0) / 1024 / 1024 / 1024).toFixed(0)}GB</span>
              </div>
              <Progress percent={((stats?.usedSize || 0) / (stats?.totalSize || 1)) * 100} size="small" showInfo={false} strokeColor="#8B5CF6" />
            </div>
          </div>
        </div>
      </div>

      {/* 新手任务 + 创作排行 */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-mf-border2 bg-mf-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GiftOutlined className="text-lg text-mf-gold" />
              <h2 className="text-base font-bold text-white">新手任务</h2>
              <span className="text-xs text-mf-faint">共可领 {totalReward} 点数</span>
            </div>
            {pendingRewards.length > 0 && <Tag color="gold">{pendingRewards.length} 个待领取</Tag>}
          </div>
          <div className="space-y-2.5">
            {rewardTasks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl bg-mf-card2 px-3 py-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-600/15">🎁</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-mf-text">{t.name}</div>
                  <div className="text-[11px] text-mf-faint">{t.description}</div>
                </div>
                {t.status === 'claimed' ? (
                  <Tag color="default">已领取</Tag>
                ) : t.status === 'completed' ? (
                  <Button type="primary" size="small" onClick={() => handleClaim(t.id)}>领取 +{t.rewardPoints}</Button>
                ) : (
                  <Button size="small" onClick={() => navigate(t.module || '/dashboard')}>去完成</Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-mf-border2 bg-mf-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrophyOutlined className="text-lg text-mf-gold" />
            <h2 className="text-base font-bold text-white">创作排行</h2>
          </div>
          <div className="space-y-2.5">
            {ranking.slice(0, 6).map((r: any) => (
              <div key={r.rank} className="flex items-center gap-3 rounded-xl bg-mf-card2 px-3 py-2.5">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  r.rank === 1 ? 'bg-yellow-400 text-black' : r.rank === 2 ? 'bg-gray-300 text-black' : r.rank === 3 ? 'bg-orange-400 text-black' : 'bg-mf-border text-mf-dim'
                }`}>
                  {r.rank}
                </div>
                <span className="flex-1 text-sm text-mf-text">{r.name}</span>
                <span className="text-sm font-medium text-mf-accent">{r.workCount} 个作品</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ 案例教程 ============ */}
      <div className="mt-8 flex items-center justify-between">
        <SectionTitle icon={<FireOutlined />} title="案例教程" noMargin />
        <div className="flex gap-2">
          {CASE_TABS.map((t) => (
            <button
              key={t}
              className={`rounded-full px-4 py-1.5 text-xs transition-all ${
                caseTab === t
                  ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 font-medium text-white shadow-[0_0_12px_rgba(139,92,246,.4)]'
                  : 'border border-mf-border text-mf-dim hover:border-mf-hover hover:text-mf-text'
              }`}
              onClick={() => setCaseTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {filteredCases.map((c) => (
          <div key={c.id} className="group cursor-pointer" onClick={() => navigate('/blog')}>
            <div className="relative mb-2 aspect-video overflow-hidden rounded-xl border border-mf-border2 bg-mf-card2">
              <img src={withBase(c.cover)} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
              <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{c.tag}</span>
            </div>
            <p className="line-clamp-2 text-xs text-mf-sub">{c.title}</p>
          </div>
        ))}
      </div>

      {/* 新手引导弹窗 */}
      <Modal
        open={guideVisible}
        onCancel={() => setGuideVisible(false)}
        footer={null}
        width={640}
        title={<span className="text-white">新手创作营 · 3分钟快速掌握创作流程</span>}
      >
        <div className="space-y-3 pt-2">
          {GUIDE_STEPS.map((step) => (
            <div
              key={step.no}
              className="flex cursor-pointer items-center gap-4 rounded-xl border border-mf-border2 bg-mf-card2 p-4 transition-colors hover:border-mf-hover"
              onClick={() => { setGuideVisible(false); navigate(step.path) }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600/15 text-sm font-bold text-mf-accent">
                {step.no}
              </div>
              <img src={withBase(step.icon)} alt="" className="h-9 w-9" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-mf-text">{step.title}</h3>
                <p className="text-xs text-mf-faint">{step.desc}</p>
              </div>
              <Button type="primary" size="small" ghost>{step.action}</Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function SectionTitle({ icon, title, noMargin }: { icon: React.ReactNode; title: string; noMargin?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${noMargin ? '' : 'mb-4 mt-8'}`}>
      <span className="text-lg text-mf-accent">{icon}</span>
      <h2 className="text-lg font-bold text-white">{title}</h2>
    </div>
  )
}

function StatItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-mf-card2 p-3">
      <span className={`text-lg ${color}`}>{icon}</span>
      <span className="flex-1 text-sm text-mf-sub">{label}</span>
      <span className="text-lg font-bold text-white">{value}</span>
    </div>
  )
}
