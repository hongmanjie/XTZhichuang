import { useCallback, useEffect, useRef, useState } from 'react'
import { message, Modal, Select, Upload, Empty, Tag } from 'antd'
import {
  PlusOutlined, ThunderboltOutlined, PlayCircleOutlined, LoadingOutlined,
  ReloadOutlined, DeleteOutlined,
} from '@ant-design/icons'
import { api } from '../../api/request'
import { withBase } from "../../utils/base"

// ============ 案例数据（海报素材由 tools/gen-factory-cases.mjs 生成） ============
const CATS = ['全部', '通用场景', '节日气氛', '毛绒质感', '微缩小人', '切开产品', '樱花系列', '产品蛋糕', '地标建筑', '服饰']
const CASES = [
  { id: 1, cat: '节日气氛', title: '双11大促狂欢', cover: '/images/factory/cases/case_01.svg', prompt: '双11大促氛围，红金配色，礼盒与产品环绕出场，促销动感节奏' },
  { id: 2, cat: '节日气氛', title: '年终盛典预售', cover: '/images/factory/cases/case_02.svg', prompt: '年终盛典预售氛围，玫红渐变舞台光，产品礼盒缓缓升起' },
  { id: 3, cat: '通用场景', title: '焕新上市大片', cover: '/images/factory/cases/case_03.svg', prompt: '蓝紫影棚聚光灯下，香水瓶360度旋转展示，高级质感' },
  { id: 4, cat: '通用场景', title: '冰爽气泡水', cover: '/images/factory/cases/case_04.svg', prompt: '深蓝冰爽场景，气泡升腾，罐装饮料冷凝水珠特写' },
  { id: 5, cat: '毛绒质感', title: '软萌治愈公仔', cover: '/images/factory/cases/case_05.svg', prompt: '粉色毛绒质感，公仔软糯回弹特写，治愈系慢节奏' },
  { id: 6, cat: '微缩小人', title: '微观产品世界', cover: '/images/factory/cases/case_06.svg', prompt: '微缩小人国视角，小人在巨大产品旁攀爬探索，创意趣味' },
  { id: 7, cat: '切开产品', title: '鲜切果萃特写', cover: '/images/factory/cases/case_07.svg', prompt: '新鲜橙子被切开瞬间，果汁飞溅慢镜头，清新橙色滤镜' },
  { id: 8, cat: '樱花系列', title: '樱花限定香氛', cover: '/images/factory/cases/case_08.svg', prompt: '樱花花瓣飘落，粉色香水瓶置身于樱花雨中，浪漫唯美' },
  { id: 9, cat: '产品蛋糕', title: '甜蜜蛋糕工坊', cover: '/images/factory/cases/case_09.svg', prompt: '奶油蛋糕层层堆叠，樱桃落下定格，甜品美食诱惑' },
  { id: 10, cat: '地标建筑', title: '城市天际联名', cover: '/images/factory/cases/case_10.svg', prompt: '夜晚城市天际线灯火通明，产品如地标般矗立，震撼航拍' },
  { id: 11, cat: '服饰', title: '潮流新季穿搭', cover: '/images/factory/cases/case_11.svg', prompt: '紫色霓虹秀场，新品连衣裙飘动展示，时尚潮流节奏卡点' },
  { id: 12, cat: '节日气氛', title: '双11好礼就位', cover: '/images/factory/cases/case_12.svg', prompt: '双11预售氛围，面霜与金色礼盒组合，礼花绽放收尾' },
]

const statusTag = (s: string) => {
  const map: Record<string, { color: string; text: string }> = {
    pending: { color: 'gold', text: '排队中' },
    running: { color: 'processing', text: '生成中' },
    success: { color: 'success', text: '已完成' },
    failed: { color: 'error', text: '失败' },
    reconciling: { color: 'warning', text: '待核对' },
    canceled: { color: 'default', text: '已取消' },
  }
  const c = map[s] || { color: 'default', text: s }
  return <Tag color={c.color} className="!mr-0 !text-[10px]">{c.text}</Tag>
}

export default function VideoGoldTime() {
  const [tab, setTab] = useState<'cases' | 'mine'>('cases')
  const [cat, setCat] = useState('全部')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(15)
  const [submitting, setSubmitting] = useState(false)
  const [tasks, setTasks] = useState<any[]>([])
  const [previewCase, setPreviewCase] = useState<any>(null)
  const [previewTask, setPreviewTask] = useState<any>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const timer = useRef<any>(null)

  // ---- 我的创作轮询 ----
  const loadTasks = useCallback(() => {
    api.tasks({ module: 'factory', pageSize: 24 }).then((d: any) => setTasks(d.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    loadTasks()
    timer.current = setInterval(loadTasks, 3000)
    return () => clearInterval(timer.current)
  }, [loadTasks])

  const handleUpload = async (file: File) => {
    setUploading(true)
    const hide = message.loading('上传中...', 0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', 'AI梦工厂')
      const data = await api.uploadMaterial(fd)
      setImageUrl(data.url)
      message.success('产品图已上传')
    } catch {
      message.error('上传失败')
    } finally { hide(); setUploading(false) }
    return false
  }

  const handleSubmit = async () => {
    if (!imageUrl) return message.warning('请先点击 + 上传产品图片')
    setSubmitting(true)
    try {
      await api.createFactory({ imageUrl, prompt: prompt.trim(), duration, count: 1 })
      message.success('任务已创建，AI 开始生成...')
      setPrompt('')
      setTab('mine')
      loadTasks()
    } catch {} finally { setSubmitting(false) }
  }

  const useCasePrompt = (c: any) => {
    setPrompt(c.prompt)
    setPreviewCase(null)
    message.success('已填充同款提示词，上传产品图后即可生成')
    barRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  const filteredCases = cat === '全部' ? CASES : CASES.filter((c) => c.cat === cat)

  return (
    <div className="relative mx-auto max-w-[1240px] px-6 pb-10">
      {/* ============ 标题 ============ */}
      <div className="pt-2 text-center">
        <h1 className="text-[26px] font-black tracking-wider">
          <span className="mf-glow-text bg-gradient-to-r from-[#c4b5fd] via-[#f0abfc] to-[#c4b5fd] bg-clip-text text-transparent">黄金创作时代</span>
          <span className="ml-3 text-white">一键开启</span>
        </h1>
        <p className="mt-2 text-[13px] text-[#7d74a3]">上传产品图，系统自动生成展示视频；商品细节与效果请检查成片。</p>
      </div>

      {/* ============ Tabs ============ */}
      <div className="mt-6 flex items-center justify-center gap-8 border-b border-[#221a38] pb-3">
        {[['cases', '创作灵感'], ['mine', '我的创作']].map(([k, label]) => (
          <button
            key={k}
            className={`relative text-[15px] transition-colors ${tab === k ? 'font-bold text-white' : 'text-[#7d74a3] hover:text-[#b3a8d9]'}`}
            onClick={() => setTab(k as any)}
          >
            {label}
            {tab === k && <span className="absolute -bottom-[13px] left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500" />}
          </button>
        ))}
      </div>

      {/* ============ 案例展示 ============ */}
      {tab === 'cases' && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {CATS.map((c) => (
              <button
                key={c}
                className={`rounded-full px-4 py-1.5 text-[13px] transition-all ${
                  cat === c
                    ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 font-medium text-white shadow-[0_0_12px_rgba(139,92,246,.4)]'
                    : 'border border-[#2a2140] text-[#9d8fd0] hover:border-purple-500/60 hover:text-white'
                }`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {filteredCases.length === 0 ? (
            <div className="flex h-64 items-center justify-center"><Empty description="该分类暂无案例" /></div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {filteredCases.map((c) => (
                <div
                  key={c.id}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border border-[#221a38] bg-[#120d20] transition-all hover:border-purple-500/70 hover:shadow-[0_0_24px_rgba(139,92,246,.25)]"
                  onClick={() => setPreviewCase(c)}
                >
                  <div className="relative aspect-[9/16] overflow-hidden">
                    <img src={withBase(c.cover)} alt={c.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">{c.cat}</span>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/35 group-hover:opacity-100">
                      <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">查看示例提示词</span>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-8">
                      <div className="truncate text-xs font-medium text-white">{c.title}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ============ 我的创作 ============ */}
      {tab === 'mine' && (
        <div className="mt-5">
          {tasks.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2">
              <Empty description={<span className="text-[#7d74a3]">暂无创作记录，在底部输入创意开始生成</span>} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {tasks.map((t) => {
                // 封面用上传的产品图（mock 结果的 cover 为 mp4 无法直接作 img）
                const cover = t.params?.imageUrl || ''
                return (
                  <div
                    key={t.id}
                    className="group relative cursor-pointer overflow-hidden rounded-xl border border-[#221a38] bg-[#120d20] transition-all hover:border-purple-500/70"
                    onClick={() => t.status === 'success' && setPreviewTask(t)}
                  >
                    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-[#241a44] to-[#120d20]">
                      {cover && <img src={withBase(cover)} alt="" className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105" />}
                      {(t.status === 'running' || t.status === 'pending') && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45">
                          <LoadingOutlined className="text-xl text-purple-300" spin />
                          <span className="text-xs text-purple-200">{t.stage || '生成中'}</span>
                        </div>
                      )}
                      {t.status === 'success' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/35 group-hover:opacity-100">
                          <PlayCircleOutlined className="text-4xl text-white/90" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[#e6e1f5]">{t.title}</div>
                        {t.result?.engine === 'mock' && <div className="mt-1 text-[10px] text-amber-400">历史模拟结果</div>}
                        <div className="mt-0.5 text-[10px] text-[#5b5280]">{t.created_at}</div>
                        {t.error && <div className="mt-1 text-[10px] text-amber-300">{t.error}</div>}
                        {(t.status === 'failed' || (t.status === 'reconciling' && t.provider_task_id)) && <button className="mt-1 text-[10px] text-purple-300" onClick={async (e) => { e.stopPropagation(); try { await api.retryTask({ id: t.id }); loadTasks() } catch {} }}>{t.status === 'failed' ? '重试' : '检查结果'}</button>}
                        {(t.status === 'pending' || ((t.status === 'running' || t.status === 'reconciling') && t.provider_task_id)) && <button className="ml-2 mt-1 text-[10px] text-purple-300" onClick={async (e) => { e.stopPropagation(); try { const result: any = await api.cancelTask({ id: t.id }); message.info(result.status === 'canceled' ? '任务已取消' : '已请求取消或获取上游结果'); loadTasks() } catch {} }}>取消</button>}
                      </div>
                      {statusTag(t.status)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ============ 底部创作栏 ============ */}
      <div ref={barRef} className="sticky bottom-5 z-30 mx-auto mt-10 max-w-3xl">
        <div className="flex items-center gap-3 rounded-2xl border border-[#2a2140] bg-[#120d20]/95 p-3 shadow-[0_8px_40px_rgba(0,0,0,.55),0_0_40px_rgba(124,58,237,.16)] backdrop-blur">
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*" disabled={uploading}>
            <div className="flex h-12 w-12 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#3a2f5a] bg-[#0d0918] transition-colors hover:border-purple-500">
              {uploading ? (
                <LoadingOutlined className="text-lg text-purple-300" spin />
              ) : imageUrl ? (
                <img src={withBase(imageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <PlusOutlined className="text-lg text-[#7d74a3]" />
              )}
            </div>
          </Upload>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="输入您想生成的视频，如：双11大促氛围，产品旋转展示"
            className="h-12 flex-1 rounded-xl border border-[#2a2140] bg-[#0d0918] px-4 text-[13px] text-[#e6e1f5] outline-none transition-colors placeholder:text-[#5b5280] focus:border-purple-500/70"
          />
          <Select
            value={duration}
            onChange={setDuration}
            style={{ width: 96 }}
            options={[5, 10, 15, 30].map((s) => ({ value: s, label: `${s}秒` }))}
          />
          <button
            className="mf-btn-gradient flex h-12 items-center gap-1.5 rounded-xl px-5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
            开始生成
            <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[11px] font-medium">⚡80</span>
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[#9286b0]">当前每条预留 80 平台点；不同视频时长的实际网关成本尚待对账。</p>
      </div>

      {/* ============ 案例预览 ============ */}
      <Modal open={!!previewCase} onCancel={() => setPreviewCase(null)} footer={null} width={720} centered>
        {previewCase && (
          <div className="flex gap-5 pt-4">
            <img src={withBase(previewCase.cover)} alt="" className="w-64 rounded-xl border border-[#2a2140]" />
            <div className="flex flex-1 flex-col">
              <Tag color="purple" className="!w-fit">{previewCase.cat}</Tag>
              <h3 className="mt-2 text-lg font-bold text-[#e6e1f5]">{previewCase.title}</h3>
              <p className="mt-2 text-xs text-[#9d8fd0]">图片为创作灵感示意，不是该系统生成的视频样片。</p>
              <div className="mt-3 rounded-xl border border-[#221a38] bg-[#0d0918] p-3 text-[13px] leading-6 text-[#9d8fd0]">
                <div className="mb-1 text-[11px] text-[#5b5280]">同款提示词</div>
                {previewCase.prompt}
              </div>
              <div className="mt-auto flex gap-3 pt-5">
                <button
                  className="flex-1 rounded-xl border border-[#3a2f5a] py-2.5 text-sm text-[#c4b5fd] transition-colors hover:border-purple-500 hover:text-white"
                  onClick={() => useCasePrompt(previewCase)}
                >
                  <ReloadOutlined className="mr-1.5" />使用提示词
                </button>
                <button
                  className="mf-btn-gradient flex-1 rounded-xl py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.02]"
                  onClick={() => useCasePrompt(previewCase)}
                >
                  <ThunderboltOutlined className="mr-1.5" />使用提示词创作
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ============ 成片预览 ============ */}
      <Modal open={!!previewTask} onCancel={() => setPreviewTask(null)} footer={null} width={680} centered title={previewTask?.title}>
        {!!previewTask?.result?.warnings?.length && <p className="mb-3 text-xs leading-5 text-amber-500">{previewTask.result.warnings.join('；')}</p>}
        {previewTask?.result?.videos?.map((v: any, i: number) => (
          <div key={i} className="mb-3">
            <video src={withBase(v.url)} poster={withBase(v.cover || undefined)} controls className="w-full rounded-xl bg-black" preload={v.cover ? 'none' : 'metadata'} />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#7d74a3]">
              <span>{v.name} · {v.duration}s · {v.resolution}</span>
              <div className="flex gap-3">
                <a href={withBase(v.url)} target="_blank" rel="noreferrer" className="text-[#c4b5fd] hover:text-white">下载</a>
                <button
                  className="text-[#f87171] hover:text-red-400"
                  onClick={async () => { await api.deleteTasks({ ids: [previewTask.id] }); setPreviewTask(null); loadTasks() }}
                >
                  <DeleteOutlined /> 删除任务
                </button>
              </div>
            </div>
          </div>
        ))}
      </Modal>
    </div>
  )
}
