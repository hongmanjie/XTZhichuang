import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, message, Select, Spin, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any }
type UploadKind = 'video' | 'image'

export default function HitReplica() {
  const [videos, setVideos] = useState<Material[]>([])
  const [images, setImages] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoUrl, setVideoUrl] = useState<string>()
  const [firstFrame, setFirstFrame] = useState<string>()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(8)
  const [ratio, setRatio] = useState('9:16')
  const [resolution, setResolution] = useState('540P')
  const [uploading, setUploading] = useState<UploadKind | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const cost = 50 + (resolution === '540P' ? 12 : 16) * (duration > 8 ? Math.ceil(duration / 8) * 2 : duration / 4)

  const load = useCallback(() => {
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setVideos(data.list || [])).catch(() => {})
    api.materials({ type: 'image', pageSize: 100 }).then((data: any) => setImages(data.list || [])).catch(() => {})
    api.tasks({ module: 'replica', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => { load(); const timer = setInterval(load, 6000); return () => clearInterval(timer) }, [load])

  const upload = async (kind: UploadKind, file?: File) => {
    if (!file) return
    if (kind === 'video' && !file.type.startsWith('video/')) return message.warning('请选择视频文件')
    if (kind === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message.warning('请上传 JPG、PNG 或 WebP 图片')
    if (kind === 'image' && file.size > 10 * 1024 * 1024) return message.warning('图片不能超过 10 MB')
    setUploading(kind)
    try {
      const form = new FormData()
      form.append('file', file)
      const saved: any = await api.uploadMaterial(form)
      if (kind === 'video') setVideoUrl(saved.url); else setFirstFrame(saved.url)
      load()
      message.success(kind === 'video' ? '参考视频已上传' : '商品图片已上传')
    } catch {} finally { setUploading(null) }
  }
  const submit = async () => {
    if (!videoUrl || !prompt.trim()) return message.warning('请选择参考视频并填写新视频要求')
    setSubmitting(true)
    try {
      await api.createReplica({ videoUrl, firstFrame: firstFrame || null, prompt: prompt.trim(), duration, ratio, resolution, count: 1 })
      message.success('任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  return <div className="mx-auto max-w-5xl pb-12">
    <h1 className="text-2xl font-bold text-gray-900">爆款复刻 <Tag color="gold">部分可用</Tag></h1>
    <p className="mt-2 text-sm text-gray-500">上传参考视频，系统根据其中的语音和画面文字生成新视频。</p>
    <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">当前只参考语音及抽帧文字，不能理解或复制原片的画面、动作、镜头和音乐；平台分享链接暂未接入。完整的视频理解与复刻仍在完善中。</div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <div><label className="mb-2 block text-sm font-medium">1. 选择参考视频</label>
          <div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择视频" value={videoUrl} onChange={setVideoUrl} showSearch optionFilterProp="label" options={videos.map((video) => ({ value: video.url, label: video.name }))} />
            <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="video/*" disabled={!!uploading} onChange={(event) => { upload('video', event.target.files?.[0]); event.target.value = '' }} />{uploading === 'video' ? '上传中…' : '上传视频'}</label></div>
          {videoUrl && <video src={videoUrl} controls className="mt-3 max-h-52 w-full rounded-lg bg-black" />}
          <p className="mt-2 text-xs text-gray-500">支持不超过 120 秒的视频，请使用你有权使用的素材。</p>
        </div>
        <div><label className="mb-2 block text-sm font-medium">2. 商品图片（可选，作为首帧）</label>
          <div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择图片" allowClear value={firstFrame} onChange={setFirstFrame} showSearch optionFilterProp="label" options={images.map((image) => ({ value: image.url, label: image.name }))} />
            <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={(event) => { upload('image', event.target.files?.[0]); event.target.value = '' }} />{uploading === 'image' ? '上传中…' : '上传图片'}</label></div>
          {firstFrame && <img src={firstFrame} alt="商品首帧" className="mt-3 max-h-36 rounded-lg object-contain" />}
        </div>
        <div><label className="mb-2 block text-sm font-medium">3. 描述新视频要求</label><Input.TextArea rows={4} maxLength={1000} showCount value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：介绍我的护肤品，简洁自然，避免未经确认的功效描述" /></div>
        <div className="grid grid-cols-3 gap-3"><div><label className="mb-1 block text-xs text-gray-500">时长</label><Select className="w-full" value={duration} onChange={setDuration} options={[4, 8, 15, 30, 60].map((value) => ({ value, label: `${value} 秒` }))} /></div><div><label className="mb-1 block text-xs text-gray-500">画幅</label><Select className="w-full" value={ratio} onChange={setRatio} options={['9:16', '16:9', '1:1'].map((value) => ({ value, label: value }))} /></div><div><label className="mb-1 block text-xs text-gray-500">清晰度</label><Select className="w-full" value={resolution} onChange={setResolution} options={['540P', '720P'].map((value) => ({ value, label: value }))} /></div></div>
        <div className="flex justify-between text-sm text-gray-500"><span>预计消耗（文字识别 + 视频生成）</span><span>{cost} 点</span></div>
        <Button type="primary" size="large" block loading={submitting} disabled={!!uploading} onClick={submit}>参考文案生成视频</Button>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
        {tasks.length === 0 ? <Empty description="暂无任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3"><div className="mb-2 flex items-center justify-between text-xs text-gray-500"><span>{task.task_no}</span><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.stage || task.status}</Tag></div>
          {task.status === 'success' && task.result?.videos?.[0]?.url ? <>
            {!!task.result.warnings?.length && <p className="mb-2 text-xs leading-5 text-amber-600">{task.result.warnings.join('；')}</p>}
            <video controls className="w-full rounded-lg bg-black" src={task.result.videos[0].url} />
            {task.result.reference && <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">查看参考文字</summary><p className="mt-2 whitespace-pre-wrap">语音：{task.result.reference.transcript || '未识别到'}</p><p className="mt-2 whitespace-pre-wrap">画面文字：{task.result.reference.ocr || '未识别到'}</p></details>}
          </> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
          {task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}
          {['failed', 'reconciling'].includes(task.status) && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}
        </div>)}</div>}
      </div>
    </div>
  </div>
}
