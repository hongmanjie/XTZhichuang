import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppstoreOutlined, RobotOutlined, FolderOpenOutlined, FireOutlined,
  ScissorOutlined, ThunderboltOutlined, LineChartOutlined, SettingOutlined,
  BellOutlined, LogoutOutlined, WalletOutlined, UserOutlined, DownOutlined,
  TeamOutlined, FundProjectionScreenOutlined, CreditCardOutlined,
  CompassOutlined, EditOutlined,
  FileTextOutlined, CustomerServiceOutlined,
  PlayCircleOutlined, CrownOutlined, ApiOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Dropdown, Popover, List, Tag, Button, Tooltip, Modal } from 'antd'
import { useUserStore } from '../stores/userStore'
import { useIsAdmin } from '../utils/access'
import { api } from '../api/request'
import BrandLogo from '../components/BrandLogo'

// ============ 菜单配置（复刻原站） ============
const MENUS = [
  { key: '/dashboard', icon: <AppstoreOutlined />, label: '创作中心' },
  { key: '/agent', icon: <RobotOutlined />, label: 'AI Agent', badge: '测试' },
  { key: '/asset-library', icon: <FolderOpenOutlined />, label: '资产库' },
  { key: '/my-scripts', icon: <FileTextOutlined />, label: '我的脚本' },
  { key: '/hot', icon: <FireOutlined />, label: '爆款创作', hot: true },
  { key: '/compass', icon: <CompassOutlined />, label: '数据罗盘' },
  { key: '/ai-mix', icon: <ScissorOutlined />, label: '智能剪辑' },
  {
    key: 'create',
    icon: <ThunderboltOutlined />,
    label: 'AI创作',
    children: [
      { key: '/create/hit-replica', label: '爆款复刻', desc: '参考语音与文字生成视频', badge: 'HOT' },
      { key: '/create/video-goldTime', label: 'AI梦工厂', desc: '一张产品图片生成爆款' },
      { key: '/create/ai-product-studio', label: 'AI商拍', desc: '商品抠图并合成 AI 场景' },
      { key: '/create/video-analysis', label: '视频解析', desc: '识别视频语音和画面文字' },
      { key: '/create/digital-human', label: '百变数字人', desc: '快速创建数字人视频' },
      { key: '/create/hd_video', label: '高清视频', desc: '高清修复与增强' },
      { key: '/create/highlight-clips', label: '精彩片段', desc: '直播录像AI剪辑', badge: 'New' },
      { key: '/create/three-second', label: '三秒完播', desc: '黄金三秒钩子创作' },
    ],
  },
  { key: '/create/video-generation', icon: <PlayCircleOutlined />, label: 'AI素材场', badge: 'HOT' },
  { key: '/voice', icon: <CustomerServiceOutlined />, label: '配音与口型' },
  {
    key: 'tools',
    icon: <EditOutlined />,
    label: '创作工具',
    children: [
      { key: '/tools/erase', label: '消除笔', desc: 'AI一键消除图片多余元素' },
    ],
  },
  {
    key: 'material_data',
    icon: <LineChartOutlined />,
    label: '投放数据',
    children: [
      { key: '/material_data/dataInfo', label: '数据看板', desc: '广告账户消耗转化监控' },
      { key: '/material_data/adsVideoData', label: '广告视频数据', desc: '视频维度投放分析' },
      { key: '/material_data/authManager', label: '授权管理', desc: '广告账户授权绑定' },
    ],
  },
  {
    key: 'setting',
    icon: <SettingOutlined />,
    label: '全部设置',
    children: [
      { key: '/setting/userManage', label: '用户管理', adminOnly: true },
      { key: '/setting/roleManage', label: '角色管理', adminOnly: true },
      { key: '/setting/aiPointManage', label: 'AI点数管理', adminOnly: true },
      { key: '/setting/consumption', label: '消费记录' },
      { key: '/setting/logManage', label: '日志管理', adminOnly: true },
      { key: '/team/project', label: '团队管理' },
      { key: '/team/mine', label: '部门与成员', adminOnly: true },
      { key: '/partner', label: '合作伙伴' },
      { key: '/setting/msgCenter', label: '消息中心' },
      { key: '/feedback', label: '意见反馈' },
    ],
  },
]

// 公告跑马灯（对标原站企微福利引导）
const ANNOUNCEMENTS = [
  'AI 视频创作支持文字、首帧与尾帧；长视频由系统自动生成和合成。',
]

export default function MainLayout() {
  useEffect(() => { api.mediaSession().catch(() => {}) }, [])
  const location = useLocation()
  const navigate = useNavigate()
  const { userInfo, setUserInfo, logout } = useUserStore()
  const [collapsed, setCollapsed] = useState(false)
  const [openKeys, setOpenKeys] = useState<string[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [notice, setNotice] = useState<any>(null)
  const [pointsTip, setPointsTip] = useState<{ open: boolean; message: string }>({ open: false, message: '' })
  const timerRef = useRef<any>(null)

  // 点数不足：全局充值引导弹窗（request 拦截器派发）
  useEffect(() => {
    const onInsufficient = (e: any) => setPointsTip({ open: true, message: e.detail?.message || 'AI点数不足' })
    window.addEventListener('mf:insufficient-points', onInsufficient)
    return () => window.removeEventListener('mf:insufficient-points', onInsufficient)
  }, [])

  // 进入布局时同步最新用户信息（昵称/点数/会员状态），避免 localStorage 缓存过期显示
  useEffect(() => {
    if (!useUserStore.getState().token) return
    api.userInfo().then((u: any) => u && setUserInfo(u)).catch(() => {})
  }, [])

  // 根据路由自动展开菜单
  useEffect(() => {
    const path = location.pathname
    if (path.startsWith('/create')) setOpenKeys(['create'])
    else if (path.startsWith('/tools')) setOpenKeys(['tools'])
    else if (path.startsWith('/material_data')) setOpenKeys(['material_data'])
    else if (path.startsWith('/setting') || path.startsWith('/team') || path.startsWith('/partner') || path.startsWith('/feedback')) setOpenKeys(['setting'])
  }, [location.pathname])

  // 任务列表轮询
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await api.tasks({ pageSize: 20 })
        setTasks(data.list || [])
      } catch {}
    }
    fetchTasks()
    timerRef.current = setInterval(fetchTasks, 3000)
    return () => clearInterval(timerRef.current)
  }, [])

  // 未读消息轮询
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const d: any = await api.unreadMessages()
        setUnread(d.unread || 0)
      } catch {}
    }
    fetchUnread()
    const t = setInterval(fetchUnread, 15000)
    return () => clearInterval(t)
  }, [])

  // 版本公告（每次会话只弹一次）
  useEffect(() => {
    if (sessionStorage.getItem('noticeShown')) return
    api.versionNotice()
      .then((d: any) => {
        if (d?.show && d.title) {
          setNotice(d)
          sessionStorage.setItem('noticeShown', '1')
        }
      })
      .catch(() => {})
  }, [])

  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'pending').length

  const handleLogout = async () => {
    try { await api.logout() } catch {}
    logout()
    navigate('/login')
  }

  const userMenu = {
    items: [
      { key: 'info', icon: <UserOutlined />, label: '个人中心' },
      { key: 'charge', icon: <CreditCardOutlined />, label: '充值中心' },
      { key: 'record', icon: <FundProjectionScreenOutlined />, label: '充值记录' },
      { key: 'feedback', icon: <CustomerServiceOutlined />, label: '意见反馈' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'info') navigate('/user/info')
      else if (key === 'charge') navigate('/charge')
      else if (key === 'record') navigate('/chargerecord')
      else if (key === 'feedback') navigate('/feedback')
      else if (key === 'logout') handleLogout()
    },
  }

  // 选中菜单key（含父级前缀匹配）
  const selectedKey = (() => {
    const p = location.pathname
    for (const menu of MENUS) {
      if (menu.children?.some((c) => p.startsWith(c.key))) return p
    }
    return p
  })()

  const isTrial = !userInfo?.vip_level || userInfo?.vip_level === 'trial'

  // 管理入口仅管理员可见（与服务端 adminRequired 对齐）
  const isAdmin = useIsAdmin()
  const visibleMenus = MENUS.map((menu: any) =>
    menu.children ? { ...menu, children: menu.children.filter((c: any) => !c.adminOnly || isAdmin) } : menu,
  ).filter((menu: any) => (!menu.adminOnly || isAdmin) && (!menu.children || menu.children.length > 0))

  return (
    <div className="flex h-screen overflow-hidden bg-mf-bg text-mf-text">
      {/* ============ 侧边栏 ============ */}
      <aside
        className={`flex shrink-0 flex-col border-r border-mf-border2 bg-[#0C0916] transition-all duration-200 ${collapsed ? 'w-16' : 'w-52'}`}
      >
        {/* Logo */}
        <div className="flex h-14 cursor-pointer items-center gap-2 border-b border-mf-border2 px-4" onClick={() => navigate('/dashboard')}>
          <BrandLogo size={28} />
          {!collapsed && <span className="text-base font-bold text-white">兴图智创</span>}
        </div>

        {/* 菜单 */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleMenus.map((menu: any) => {
            if (menu.children) {
              const isOpen = openKeys.includes(menu.key)
              const hasActive = menu.children.some((c: any) => selectedKey === c.key)
              return (
                <div key={menu.key}>
                  <div
                    className={`mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-purple-600/10 hover:text-mf-accent ${
                      isOpen || hasActive ? 'text-mf-accent' : 'text-mf-dim'
                    }`}
                    onClick={() => setOpenKeys(isOpen ? [] : [menu.key])}
                  >
                    <span className="text-base">{menu.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="flex-1">{menu.label}</span>
                        <DownOutlined className={`text-[10px] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </>
                    )}
                  </div>
                  {isOpen && !collapsed && (
                    <div className="ml-9 mt-1 space-y-0.5 border-l-2 border-mf-border pl-3">
                      {menu.children.map((child: any) => (
                        <div
                          key={child.key}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                            selectedKey === child.key
                              ? 'bg-purple-600/15 font-medium text-mf-accent'
                              : 'text-mf-dim hover:text-mf-accent'
                          }`}
                          onClick={() => navigate(child.key)}
                          title={child.desc || child.label}
                        >
                          {child.label}
                          {child.badge && (
                            <span className={`rounded px-1 text-[9px] font-bold ${child.badge === 'New' ? 'bg-emerald-500/90 text-white' : 'bg-gradient-to-r from-red-500 to-orange-500 text-white'}`}>
                              {child.badge}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <div
                key={menu.key}
                className={`mx-2 my-0.5 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  selectedKey === menu.key
                    ? 'bg-purple-600/15 font-medium text-mf-accent'
                    : 'text-mf-dim hover:bg-purple-600/10 hover:text-mf-accent'
                }`}
                onClick={() => navigate(menu.key)}
                title={collapsed ? menu.label : undefined}
              >
                <span className="text-base">{menu.icon}</span>
                {!collapsed && (
                  <span className="flex items-center gap-1.5">
                    {menu.hot ? (
                      <span className="italic text-transparent" style={{ backgroundImage: 'linear-gradient(92deg,#f43f5e,#fb923c)', WebkitBackgroundClip: 'text', backgroundClip: 'text', fontWeight: 800 }}>{menu.label}</span>
                    ) : (
                      menu.label
                    )}
                    {menu.badge && (
                      <span className="rounded bg-gradient-to-r from-red-500 to-orange-500 px-1 text-[9px] font-bold text-white">{menu.badge}</span>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </nav>

        {/* 广告数据授权 */}
        {!collapsed && (
          <div className="px-3 pb-2">
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-mf-border bg-mf-card2 py-2 text-xs text-mf-dim transition-colors hover:border-mf-hover hover:text-mf-accent"
              onClick={() => navigate('/material_data/authManager')}
            >
              <ApiOutlined /> 广告数据授权
            </button>
          </div>
        )}

        {/* 折叠按钮 */}
        <div className="border-t border-mf-border2 p-2">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-mf-faint hover:bg-purple-600/10 hover:text-mf-dim"
            onClick={() => setCollapsed(!collapsed)}
          >
            <img src="/images/menu/icon_collapsed_left.png" alt="" className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''} opacity-70 invert`} />
            {!collapsed && '收起菜单'}
          </button>
        </div>
      </aside>

      {/* ============ 主区域 ============ */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-mf-border2 bg-[#0C0916] px-6">
          {/* 公告跑马灯 */}
          <div className="flex min-w-0 flex-1 items-center gap-3 pr-4">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-full border border-mf-border2 bg-mf-card2 py-1.5 pl-9 pr-3">
              <img src="/images/laba.png" alt="" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <div className="mf-marquee whitespace-nowrap text-xs text-mf-sub">
                {ANNOUNCEMENTS.map((a, i) => (
                  <span key={i} className="mx-8">{a}</span>
                ))}
              </div>
            </div>
          </div>
          <style>{`
            .mf-marquee { display: inline-block; animation: mf-marquee 30s linear infinite; }
            .mf-marquee:hover { animation-play-state: paused; }
            @keyframes mf-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
          `}</style>

          <div className="flex shrink-0 items-center gap-4">
            {/* 全部任务列表 */}
            <Popover
              open={taskPanelOpen}
              onOpenChange={setTaskPanelOpen}
              placement="bottomRight"
              trigger="click"
              content={
                <div className="w-80">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-mf-text">全部任务列表</span>
                    <span className="text-xs text-mf-faint">{runningCount > 0 ? `${runningCount}个进行中` : '暂无进行中任务'}</span>
                  </div>
                  <List
                    size="small"
                    dataSource={tasks}
                    locale={{ emptyText: '暂无任务' }}
                    renderItem={(item: any) => (
                      <List.Item className="!px-0">
                        <div className="flex w-full items-center gap-2">
                          <img
                            src={item.status === 'running' ? '/images/task/task_list_active.gif' : '/images/task/task_list_idle.png'}
                            alt=""
                            className="h-4 w-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs text-mf-text">{item.title || item.module}</div>
                            <div className="text-[10px] text-mf-faint">{item.task_no}</div>
                          </div>
                          <TaskStatusTag status={item.status} progress={item.progress} />
                        </div>
                      </List.Item>
                    )}
                  />
                </div>
              }
            >
              <button className="flex items-center gap-1.5 rounded-full border border-mf-border px-3 py-1 text-xs text-mf-sub transition-colors hover:border-mf-hover hover:text-mf-accent">
                <Badge count={runningCount} size="small" offset={[4, -2]}>
                  <FileTextOutlined />
                </Badge>
                全部任务列表
              </button>
            </Popover>

            {/* 加入/创建企业 CTA */}
            <button
              className="flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3.5 py-1.5 text-xs font-bold text-black transition-transform hover:scale-[1.03]"
              onClick={() => navigate('/team/mine')}
            >
              <TeamOutlined /> 加入/创建企业
            </button>

            {/* AI点数 */}
            <Tooltip title="AI点数余额">
              <div
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-600/15 px-3 py-1 text-xs font-medium text-mf-accent transition-shadow hover:shadow-[0_0_12px_rgba(139,92,246,.35)]"
                onClick={() => navigate('/charge')}
              >
                <ThunderboltOutlined />
                <span>{userInfo?.ai_points ?? 0}</span>
              </div>
            </Tooltip>

            {/* 会员徽标 */}
            <Tooltip title={isTrial ? '体验会员 · 升级解锁全部权益' : '正式会员'}>
              <div
                className={`flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                  isTrial
                    ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border border-mf-gold/50 bg-mf-gold/10 text-mf-gold'
                }`}
                onClick={() => navigate('/charge')}
              >
                <CrownOutlined />
                {isTrial ? '体验会员' : '正式会员'}
              </div>
            </Tooltip>

            {/* 充值 */}
            <Tooltip title="充值中心">
              <WalletOutlined className="cursor-pointer text-base text-mf-dim hover:text-mf-accent" onClick={() => navigate('/charge')} />
            </Tooltip>

            {/* 消息 */}
            <Tooltip title="消息通知">
              <Badge count={unread} size="small" offset={[-2, 2]}>
                <BellOutlined className="cursor-pointer text-base text-mf-dim hover:text-mf-accent" onClick={() => navigate('/setting/msgCenter')} />
              </Badge>
            </Tooltip>

            {/* 用户信息 */}
            <Dropdown menu={userMenu} placement="bottomRight">
              <div className="flex cursor-pointer items-center gap-2">
                <Avatar size={30} src={userInfo?.avatar} icon={<UserOutlined />} className="!bg-purple-600" />
                <span className="text-sm text-mf-text">{userInfo?.name || '用户'}</span>
                <DownOutlined className="text-[10px] text-mf-faint" />
              </div>
            </Dropdown>
          </div>
        </header>

        {/* 内容区 */}
        <main className="flex-1 overflow-y-auto bg-mf-bg p-6">
          <Outlet />
        </main>
      </div>

      {/* 版本公告弹窗 */}
      <Modal
        title={`${notice?.version ? `V${notice.version} ` : ''}${notice?.title || ''}`}
        open={!!notice}
        onCancel={() => setNotice(null)}
        footer={<Button type="primary" onClick={() => setNotice(null)}>知道了</Button>}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-mf-sub">{notice?.content}</p>
      </Modal>

      {/* 点数不足充值引导弹窗 */}
      <Modal
        open={pointsTip.open}
        onCancel={() => setPointsTip({ open: false, message: '' })}
        footer={null}
        width={420}
        centered
      >
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-600/15 text-3xl text-mf-accent shadow-[0_0_24px_rgba(139,92,246,0.35)]">
            <WalletOutlined />
          </div>
          <h3 className="mb-2 text-lg font-bold text-mf-text">AI点数不足</h3>
          <p className="mb-1 text-sm text-mf-sub">{pointsTip.message}</p>
          <p className="mb-5 text-xs text-mf-dim">在线充值暂未接入，请联系管理员处理点数。</p>
          <div className="flex w-full gap-3">
            <Button block onClick={() => setPointsTip({ open: false, message: '' })}>知道了</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function TaskStatusTag({ status }: { status: string; progress: number }) {
  const map: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: '排队中' },
    running: { color: 'processing', text: '生成中' },
    reconciling: { color: 'warning', text: '待核对' },
    success: { color: 'success', text: '已完成' },
    failed: { color: 'error', text: '失败' },
    canceled: { color: 'default', text: '已取消' },
  }
  const cfg = map[status] || { color: 'default', text: status }
  return <Tag color={cfg.color} className="!mr-0 !text-[10px]">{cfg.text}</Tag>
}
