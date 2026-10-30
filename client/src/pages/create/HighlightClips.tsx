import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Input, Select, Table, Tag, Modal, Empty, Spin, message, Progress, Drawer, Upload, Statistic, Popconfirm } from 'antd'
import {
  ThunderboltOutlined, SaveOutlined, SendOutlined, EditOutlined, PlayCircleOutlined,
  LinkOutlined, CloudUploadOutlined, LoadingOutlined, AppstoreOutlined, InboxOutlined, DeleteOutlined,
} from '@ant-design/icons'
import { api } from '../../api/request'

// 平台映射（parseShareUrl 返回英文 key）
const PLATFORM_NAME: Record<string, string> = { douyin: '抖音', kuaishou: '快手', bilibili: 'B站', xiaohongshu: '小红书' }
const PLATFORM_STYLE: Record<string, string> = {
  抖音: 'bg-[#161823] text-white border border-[#3a3a4a]',
  快手: 'bg-[#FF4906]/15 text-[#ff7a45] border border-[#FF4906]/40',
  B站: 'bg-[#00A1D6]/15 text-[#40b5e0] border border-[#00A1D6]/40',
}

const statusTag = (s: string) => {
  const map: Record<string, { color: string; text: string }> = {
    pending: { color: 'gold', text: '排队中' }, running: { color: 'processing', text: '分析中' },
    success: { color: 'success', text: '已完成' }, failed: { color: 'error', text: '失败' },
  }
  const cfg = map[s] || { color: 'default', text: s }
  return <Tag color={cfg.color}>{cfg.text}</Tag>
}

export default function HighlightClips() {
  // ---- 创作区 ----
  const [mode, setMode] = useState<'link' | 'upload'>('link')
  const [link, setLink] = useState('')
  const [parsing, setParsing] = useState(false)
  const [videoInfo, setVideoInfo] = useState<any>(null) // {title, cover, author, platform, duration, url}
  const [videoName, setVideoName] = useState('')
  const [anchor, setAnchor] = useState('')
  const [platform, setPlatform] = useState<string>()
  const [clipDuration, setClipDuration] = useState('auto')
  const [submitting, setSubmitting] = useState(false)

  // ---- 任务中心 ----
  const [centerOpen, setCenterOpen] = useState(false)
  const [overview, setOverview] = useState<any>({})
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [clips, setClips] = useState<any[]>([])
  const [clipsLoading, setClipsLoading] = useState(false)
  const [editTitle, setEditTitle] = useState<any>(null)
  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, t]: any[] = await Promise.all([api.highlightOverview(), api.highlightTasks({ pageSize: 20 })])
      setOverview(ov)
      setTasks(t.list || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])
  useEffect(() => { fetchData() }, [fetchData])
  // 轮询进行中任务
  useEffect(() => {
    const timer = setInterval(() => {
      if (tasksRef.current.some((t) => t.status === 'pending' || t.status === 'running')) fetchData()
    }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 解析链接 ----
  const handleParse = async () => {
    if (!link.trim()) return message.warning('请先输入视频链接')
    setParsing(true)
    try {
      const d: any = await api.parseShareUrl({ url: link.trim() })
      const plat = PLATFORM_NAME[d.platform] || '抖音'
      setVideoInfo({ ...d, platform: plat })
      setVideoName(d.title || '')
      setAnchor(d.author || '')
      setPlatform(plat)
      message.success('视频解析成功，信息已自动填充')
    } catch { message.error('解析失败，请检查链接') } finally { setParsing(false) }
  }

  // ---- 本地上传 ----
  const handleUpload = async (file: File) => {
    const hide = message.loading('视频上传中...', 0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', '高光智剪')
      const data = await api.uploadMaterial(fd)
      setVideoInfo({ title: file.name, url: data.url, platform: '本地上传', duration: '' })
      setVideoName(file.name.replace(/\.[^.]+$/, ''))
      setPlatform('本地上传')
      message.success('视频已上传')
    } catch { message.error('上传失败') } finally { hide() }
    return false
  }

  // ---- 创建剪辑任务 ----
  const handleCreate = async () => {
    if (!videoName.trim()) return message.warning('请填写视频名称')
    if (!anchor.trim()) return message.warning('请填写主播/创作者')
    const sourceUrl = mode === 'link' ? (videoInfo?.url || link.trim()) : videoInfo?.url
    if (!sourceUrl) return message.warning(mode === 'link' ? '请先输入链接并解析视频' : '请先上传视频文件')
    setSubmitting(true)
    try {
      await api.highlightCreate({
        name: videoName.trim(), anchor: anchor.trim(), platform: platform || '',
        clipDuration, sourceType: mode === 'link' ? 'live' : 'upload', sourceUrl,
      })
      message.success('任务创建成功，AI 正在识别高光内容')
      setCenterOpen(true)
      fetchData()
    } catch { /* 拦截器已提示（含点数不足充值引导） */ } finally { setSubmitting(false) }
  }

  const viewClips = async (task: any) => {
    setSelectedTask(task)
    setClipsLoading(true)
    try {
      const d: any = await api.highlightClips(task.id)
      setClips(d.list || [])
    } catch { setClips([]) }
    setClipsLoading(false)
  }

  return (
    <div className="mx-auto max-w-[1240px] px-6 pb-10">
      {/* ============ 标题 + 任务中心 ============ */}
      <div className="relative pt-2 text-center">
        <h1 className="text-[26px] font-black tracking-wider">
          <span className="mf-glow-text bg-gradient-to-r from-[#c4b5fd] via-[#f0abfc] to-[#c4b5fd] bg-clip-text text-transparent">AI驱动视频理解</span>
          <span className="ml-3 text-white">自动识别高光内容并智能切片</span>
        </h1>
        <p className="mt-2 text-[13px] text-[#7d74a3]">粘贴直播/视频链接或上传录像，AI 自动剪辑高光片段，一键发布</p>
        <button
          className="absolute right-0 top-2 flex items-center gap-1.5 rounded-xl border border-[#3a2f5a] px-4 py-2 text-[13px] text-[#c4b5fd] transition-colors hover:border-purple-500 hover:text-white"
          onClick={() => setCenterOpen(true)}
        >
          <AppstoreOutlined />任务中心
        </button>
      </div>

      {/* ============ 主工作卡 ============ */}
      <div className="mt-8 grid grid-cols-1 gap-0 rounded-2xl border border-dashed border-[#3a2f5a] bg-[#120d20]/70 lg:grid-cols-2">
        {/* ---- 左：来源 ---- */}
        <div className="border-b border-[#221a38] p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-baseline gap-2">
            <span className="text-[16px] font-bold text-white">高光智剪</span>
            <span className="text-[11px] text-[#5b5280]">视频时长不超过 2 小时且视频大小不超过 10GB</span>
          </div>

          {/* 链接导入 / 本地上传 */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-full border border-[#2a2140] bg-[#0d0918] p-1">
            {([['link', '链接导入', <LinkOutlined key="l" />], ['upload', '本地上传', <CloudUploadOutlined key="u" />]] as const).map(([k, label, icon]) => (
              <button
                key={k}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-full text-[13px] transition-all ${
                  mode === k ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 font-bold text-white shadow-[0_0_14px_rgba(139,92,246,.4)]' : 'text-[#9d8fd0] hover:text-white'
                }`}
                onClick={() => setMode(k)}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {mode === 'link' ? (
            <>
              <div className="mt-5 flex gap-3">
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleParse()}
                  placeholder="请在此输入链接"
                  className="h-11 flex-1 rounded-xl border border-[#2a2140] bg-[#0d0918] px-4 text-[13px] text-[#e6e1f5] outline-none transition-colors placeholder:text-[#5b5280] focus:border-purple-500/70"
                />
                <button
                  className="h-11 rounded-xl bg-white/90 px-6 text-[13px] font-bold text-[#1a1430] transition-transform hover:scale-[1.03] disabled:opacity-50"
                  disabled={parsing}
                  onClick={handleParse}
                >
                  {parsing ? <LoadingOutlined spin /> : '解析视频'}
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[12px] text-[#7d74a3]">
                支持平台：
                {['抖音', '快手', 'B站'].map((p) => (
                  <span key={p} className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${PLATFORM_STYLE[p]}`}>{p}</span>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-[12px] leading-5 text-[#9d8fd0]">
                支持粘贴直播分享链接，一次可输入一个视频链接，系统将自动解析并创建分析切片任务。
              </div>
            </>
          ) : (
            <Upload.Dragger beforeUpload={handleUpload} showUploadList={false} accept="video/*" className="!mt-5 !rounded-xl">
              <div className="py-8">
                <InboxOutlined className="text-3xl text-[#5b5280]" />
                <p className="mt-2 text-[13px] text-[#9d8fd0]">点击或拖拽上传视频文件</p>
                <p className="mt-1 text-[11px] text-[#5b5280]">支持 MP4/MOV，单文件不超过 10GB</p>
              </div>
            </Upload.Dragger>
          )}
        </div>

        {/* ---- 右：视频信息 ---- */}
        <div className="p-6">
          <div className="text-[16px] font-bold text-white">视频信息</div>
          {/* 预览 */}
          <div className="mt-4 flex h-24 items-center justify-center rounded-xl border border-[#2a2140] bg-[#0d0918]">
            {videoInfo ? (
              <div className="flex w-full items-center gap-3 px-4">
                {videoInfo.cover ? (
                  <img src={videoInfo.cover} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#1a1430]"><PlayCircleOutlined className="text-xl text-[#7d74a3]" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[#e6e1f5]">{videoInfo.title}</div>
                  <div className="mt-1 text-[11px] text-[#7d74a3]">{videoInfo.platform}{videoInfo.duration ? ` · ${videoInfo.duration}` : ''}{videoInfo.author ? ` · ${videoInfo.author}` : ''}</div>
                </div>
              </div>
            ) : (
              <span className="text-[12px] text-[#5b5280]">暂无视频信息</span>
            )}
          </div>
          {/* 表单 */}
          <div className="mt-4 space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[12px] text-[#9d8fd0]">视频名称 <span className="text-red-400">*</span></label>
              <Input value={videoName} onChange={(e) => setVideoName(e.target.value)} placeholder="请输入视频名称" maxLength={50} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] text-[#9d8fd0]">主播/创作者 <span className="text-red-400">*</span></label>
              <Input value={anchor} onChange={(e) => setAnchor(e.target.value)} placeholder="请输入主播/创作者名称" maxLength={30} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] text-[#9d8fd0]">来源平台</label>
                <Select
                  value={platform} onChange={setPlatform} placeholder="请选择来源平台" className="w-full"
                  options={['抖音', '快手', 'B站', '小红书', '视频号', '本地上传'].map((p) => ({ value: p, label: p }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] text-[#9d8fd0]">目标切片时长</label>
                <Select
                  value={clipDuration} onChange={setClipDuration} className="w-full"
                  options={[
                    { value: 'auto', label: 'AI自动判断' },
                    { value: '15', label: '15秒以内' },
                    { value: '30', label: '30秒以内' },
                    { value: '45', label: '45秒以内' },
                    { value: '60', label: '60秒以内' },
                  ]}
                />
              </div>
            </div>
          </div>
          <button
            className="mf-btn-gradient mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white transition-transform hover:scale-[1.01] disabled:opacity-50"
            disabled={submitting}
            onClick={handleCreate}
          >
            {submitting ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
            高光智剪
            <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[11px] font-medium">⚡60</span>
          </button>
        </div>
      </div>

      {/* ============ 任务中心 Drawer ============ */}
      <Drawer open={centerOpen} onClose={() => setCenterOpen(false)} width={760} title={<span><AppstoreOutlined className="mr-2 text-[#c4b5fd]" />任务中心</span>}>
        <div className="mb-4 grid grid-cols-3 gap-4">
          {[
            ['剪辑任务', overview.taskCount || 0, '个'],
            ['生成片段', overview.clipCount || 0, '个'],
            ['支持平台', 4, '个直播平台'],
          ].map(([t, v, s]) => (
            <div key={t as string} className="rounded-xl border border-[#221a38] bg-[#0d0918] p-4">
              <Statistic title={t as string} value={v as number} suffix={s as string} />
            </div>
          ))}
        </div>
        <Spin spinning={loading}>
          {tasks.length ? (
            <Table
              rowKey="id"
              dataSource={tasks}
              pagination={false}
              size="small"
              columns={[
                { title: '任务名称', dataIndex: 'name', render: (t: string, r: any) => (
                  <div>
                    <div className="text-[13px] text-[#e6e1f5]">{t}</div>
                    <div className="mt-0.5 text-[10px] text-[#5b5280]">{[r.anchor, r.platform].filter(Boolean).join(' · ')}</div>
                  </div>
                ) },
                { title: '来源', dataIndex: 'source_type', width: 90, render: (t: string) => (t === 'live' ? '链接导入' : '本地上传') },
                {
                  title: '状态', dataIndex: 'status', width: 130,
                  render: (s: string, r: any) =>
                    s === 'pending' || s === 'running' ? (
                      <span className="flex items-center gap-2">
                        <Progress percent={r.progress || 30} size="small" style={{ width: 64, margin: 0 }} strokeColor={{ from: '#8B5CF6', to: '#D946EF' }} />
                        分析中
                      </span>
                    ) : statusTag(s),
                },
                { title: '片段数', dataIndex: 'clip_count', width: 70, render: (c: number) => c || '-' },
                { title: '创建时间', dataIndex: 'created_at', width: 150 },
                {
                  title: '操作', width: 140,
                  render: (_: any, r: any) => (
                    <span className="flex items-center">
                      <Button type="link" size="small" disabled={r.status !== 'success'} onClick={() => viewClips(r)}>查看片段</Button>
                      <Popconfirm title="删除该任务及全部片段？" okText="删除" okButtonProps={{ danger: true, size: 'small' }} cancelText="取消"
                        onConfirm={async () => {
                          await api.highlightTaskDelete({ id: r.id }).catch(() => {})
                          message.success('任务已删除')
                          fetchData()
                        }}>
                        <Button type="link" size="small" danger>删除</Button>
                      </Popconfirm>
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <Empty description="暂无剪辑任务" className="py-12" />
          )}
        </Spin>
      </Drawer>

      {/* ============ 片段列表弹窗 ============ */}
      <Modal
        title={`${selectedTask?.name || ''} - 精彩片段`}
        open={!!selectedTask}
        onCancel={() => setSelectedTask(null)}
        footer={null}
        width={720}
      >
        <Spin spinning={clipsLoading}>
          <div className="grid grid-cols-2 gap-4">
            {clips.map((c: any) => (
              <div key={c.id} className="rounded-xl border border-[#221a38] bg-[#0d0918] p-3">
                <div className="relative mb-2 flex h-28 items-center justify-center rounded-lg bg-gradient-to-br from-[#241a44] to-[#120d20] text-3xl text-[#7d74a3]">
                  <PlayCircleOutlined />
                  <span className="absolute bottom-1 right-2 rounded bg-black/60 px-1.5 text-[10px] text-white">{c.duration}s</span>
                </div>
                <div className="text-sm font-medium text-[#e6e1f5]">{c.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(() => {
                    let tags: string[] = []
                    try { const t = JSON.parse(c.tags); tags = Array.isArray(t) ? t : [] } catch { tags = [] }
                    return tags.map((t) => <Tag key={t} className="!text-[10px]">{t}</Tag>)
                  })()}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="small" icon={<EditOutlined />} onClick={() => setEditTitle(c)}>改名</Button>
                  <Button size="small" icon={<SaveOutlined />} onClick={async () => { await api.highlightClipSave({ id: c.id }).catch(() => {}); message.success('已保存到素材库') }}>
                    存素材
                  </Button>
                  <Button size="small" type="primary" icon={<SendOutlined />} onClick={async () => { await api.highlightClipPublish({ id: c.id }).catch(() => {}); message.success('发布成功') }}>
                    发布
                  </Button>
                  <Popconfirm title="删除该片段？" okText="删除" okButtonProps={{ danger: true, size: 'small' }} cancelText="取消"
                    onConfirm={async () => {
                      await api.highlightClipDelete({ id: c.id }).catch(() => {})
                      message.success('片段已删除')
                      if (selectedTask) viewClips(selectedTask)
                      fetchData()
                    }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
          {!clips.length && !clipsLoading && <Empty description="暂无片段" className="py-8" />}
        </Spin>
      </Modal>

      {/* ============ 片段改名 ============ */}
      <Modal
        title="修改片段标题"
        open={!!editTitle}
        onCancel={() => setEditTitle(null)}
        onOk={async () => {
          if (editTitle?.newTitle) {
            await api.highlightClipTitle({ id: editTitle.id, title: editTitle.newTitle }).catch(() => {})
            message.success('标题已更新')
            if (selectedTask) viewClips(selectedTask)
          }
          setEditTitle(null)
        }}
      >
        <Input defaultValue={editTitle?.title} onChange={(e) => setEditTitle({ ...editTitle, newTitle: e.target.value })} />
      </Modal>
    </div>
  )
}
