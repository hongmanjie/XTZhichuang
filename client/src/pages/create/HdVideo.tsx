import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, message, Select, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'
import { withBase } from '../../utils/base'

type Material = { id: number; name: string; url: string }
type Settings = { model: string; provider: 'modelgate' | 'direct'; maxBytes: number; maxSeconds: number; maxLongSide: number; targetLabel: string; pointsPerSecond: number }
type Estimate = { duration: number; width: number; height: number; hasAudio: boolean; points: number; sourceUrl: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any }

export default function HdVideo() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [settings, setSettings] = useState<Settings>()
  const [tasks, setTasks] = useState<Task[]>([])
  const [legacyCount, setLegacyCount] = useState(0)
  const [sourceUrl, setSourceUrl] = useState<string>()
  const [estimate, setEstimate] = useState<Estimate>()
  const [checking, setChecking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef(false)
  const currentEstimate = estimate?.sourceUrl === sourceUrl ? estimate : undefined

  const load = useCallback(() => {
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setMaterials((data.list || []).filter((item: Material) => /^\/(?:uploads|api\/(?:material\/)?files)\//.test(item.url)))).catch(() => {})
    api.superResTasks().then((data: any) => { setTasks(data.list || []); setLegacyCount(data.legacyCount || 0) }).catch(() => {})
  }, [])
  useEffect(() => {
    api.superResInit().then(setSettings).catch(() => {})
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    let active = true
    setEstimate(undefined)
    if (!sourceUrl) { setChecking(false); return () => { active = false } }
    setChecking(true)
    api.superResEstimate(sourceUrl).then((data: Estimate) => { if (active) setEstimate({ ...data, sourceUrl }) }).catch(() => {}).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [sourceUrl])

  const upload = async (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4')) return message.warning('请选择 MP4 视频')
    if (file.size > (settings?.maxBytes || 10 * 1024 * 1024)) return message.warning(`视频不能超过 ${Math.round((settings?.maxBytes || 10 * 1024 * 1024) / 1024 / 1024)} MB`)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const saved: any = await api.uploadMaterial(form)
      setSourceUrl(saved.url)
      load()
      message.success('视频已上传')
    } catch {} finally { setUploading(false) }
  }

  const submit = async () => {
    if (!sourceUrl || !currentEstimate || checking || submitRef.current) return
    submitRef.current = true
    setSubmitting(true)
    try {
      await api.superResCreate({ sourceUrl, name: '视频画质增强' })
      message.success('增强任务已加入队列')
      load()
    } catch {} finally { submitRef.current = false; setSubmitting(false) }
  }

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <h1 className="text-2xl font-bold text-gray-900">视频画质增强</h1>
      <p className="mt-2 text-sm text-gray-500">使用 SeedVR2 增强低分辨率视频；可从素材库选择或上传。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-2 block text-sm font-medium">1. 选择视频</label>
            <div className="flex gap-2">
              <Select className="flex-1" placeholder="从素材库选择视频" allowClear value={sourceUrl} onChange={setSourceUrl} showSearch optionFilterProp="label" options={materials.map((item) => ({ value: item.url, label: item.name }))} />
              <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="video/mp4,.mp4" disabled={uploading} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传视频'}</label>
            </div>
            {sourceUrl && <video key={sourceUrl} controls className="mt-3 max-h-60 rounded-lg bg-black" src={withBase(sourceUrl)} />}
            <p className="mt-2 text-xs leading-5 text-gray-500">支持 MP4、{settings ? Math.round(settings.maxBytes / 1024 / 1024) : '—'} MB 以内、最长 {settings?.maxSeconds ?? '—'} 秒。{settings?.provider === 'direct' ? '模型按画幅增强至 1080P 目标框，已达到目标尺寸的视频不能继续增强。为适配共享显存会逐段增强，速度较慢，接缝处可能闪烁，请检查结果。' : '当前网关输出约 720 像素长边，已达到该尺寸的视频不能增强。'}</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">2. 确认后生成</label>
            <p className="text-xs leading-5 text-gray-500">模型会重新生成部分画面细节，商品文字、标识及人脸可能发生变化，请检查成片。原片有声音时会保留音轨；不支持补帧或口型同步。</p>
            <p className="mt-3 text-xs text-gray-500">计费：每秒 {settings?.pointsPerSecond ?? '—'} 点，不足一秒按一秒计；任务明确失败时退还预留点数，最终网关费用仍需对账。</p>
            {checking ? <p className="mt-2 text-xs text-gray-500">正在检查视频…</p> : currentEstimate && <p className="mt-2 text-xs text-purple-600">原片 {currentEstimate.width} × {currentEstimate.height}，{currentEstimate.duration.toFixed(1)} 秒，预计 {currentEstimate.points} 点</p>}
          </div>
          <Button type="primary" size="large" block loading={submitting} disabled={!settings || !currentEstimate || checking || uploading} onClick={submit}>开始增强</Button>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的增强任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
          {legacyCount > 0 && <p className="mb-3 text-xs text-amber-600">旧版有 {legacyCount} 条来源未验证的记录，已保留，不作为真实增强结果显示。</p>}
          {tasks.length === 0 ? <Empty description="暂无真实增强任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3">
            <div className="mb-2 flex justify-between text-xs text-gray-500"><span>{task.task_no}</span><span>{task.stage || task.status}</span></div>
            {task.status === 'success' && task.result?.videos?.[0]?.url ? <>
              <video controls className="w-full rounded-lg bg-black" src={withBase(task.result.videos[0].url)} />
              <p className="mt-2 text-xs text-gray-500">输出尺寸：{task.result.videos[0].resolution}</p>
              {!!task.result.warnings?.length && <p className="mt-2 text-xs leading-5 text-amber-600">{task.result.warnings.join('；')}</p>}
            </> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
            {task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}
            {(task.status === 'failed' || task.status === 'reconciling') && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}
          </div>)}</div>}
        </div>
      </div>
    </div>
  )
}
