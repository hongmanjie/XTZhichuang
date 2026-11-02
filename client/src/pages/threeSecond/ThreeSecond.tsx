import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Input, message, Select, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'
import { withBase } from '../../utils/base'

type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any; provider_task_id?: string }

export default function ThreeSecond() {
  const [images, setImages] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [hookType, setHookType] = useState('visual')
  const [resolution, setResolution] = useState('540P')
  const [firstFrame, setFirstFrame] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef(false)

  const load = useCallback(() => {
    api.materials({ type: 'image', pageSize: 100 }).then((data: any) => setImages(data.list || [])).catch(() => {})
    api.tasks({ module: 'threeSecond', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => { load(); const timer = setInterval(load, 6000); return () => clearInterval(timer) }, [load])

  const upload = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) return message.warning('请上传 10 MB 以内的 JPG、PNG 或 WebP 图片')
    setUploading(true)
    try {
      const form = new FormData(); form.append('file', file)
      const saved: any = await api.uploadMaterial(form)
      setFirstFrame(saved.url); load(); message.success('参考图片已上传')
    } catch {} finally { setUploading(false) }
  }

  const submit = async () => {
    if (!prompt.trim() || submitRef.current) return
    submitRef.current = true; setSubmitting(true)
    try {
      await api.threeSecondMake({ name: `三秒开场-${prompt.trim().slice(0, 18)}`, prompt: prompt.trim(), hookType, firstFrame: firstFrame || null, resolution })
      message.success('三秒开场任务已加入队列'); load()
    } catch {} finally { submitRef.current = false; setSubmitting(false) }
  }

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <h1 className="text-2xl font-bold text-gray-900">三秒开场</h1>
      <p className="mt-2 text-sm text-gray-500">制作一段约 3 秒的短视频开头，实际播放效果以成片和发布数据为准。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <div><label className="mb-2 block text-sm font-medium">1. 描述开场内容</label><Input.TextArea rows={4} maxLength={400} showCount value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：简洁影棚中展示一只白色杯子，镜头缓慢推进" /></div>
          <div><label className="mb-2 block text-sm font-medium">2. 参考图片（可选，作为首帧）</label><div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择图片" allowClear value={firstFrame} onChange={setFirstFrame} showSearch optionFilterProp="label" options={images.map((image) => ({ value: image.url, label: image.name }))} /><label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传图片'}</label></div>{firstFrame && <img src={withBase(firstFrame)} alt="选中的参考首帧" className="mt-3 max-h-40 rounded-lg object-contain" />}</div>
          <div className="grid grid-cols-2 gap-3"><div><label className="mb-2 block text-sm font-medium">开场方式</label><Select className="w-full" value={hookType} onChange={setHookType} options={[{ value: 'visual', label: '视觉吸引' }, { value: 'pain', label: '疑问引入' }, { value: 'counter', label: '反差画面' }, { value: 'suspense', label: '悬念开场' }, { value: 'identity', label: '人物代入' }, { value: 'benefit', label: '展示已知卖点' }]} /></div><div><label className="mb-2 block text-sm font-medium">清晰度</label><Select className="w-full" value={resolution} onChange={setResolution} options={[{ value: '540P', label: '540P（544 × 960）' }, { value: '720P', label: '720P（736 × 1280）' }]} /></div></div>
          <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">模型先生成约 5 秒画面，再截取前 3 秒。商品细节、文字和音效可能有误，请检查成片；播放量和完播率不作保证。</div>
          <div className="flex justify-between text-sm text-gray-500"><span>预计预留</span><span>30 点 / 条</span></div>
          <Button type="primary" size="large" block disabled={!prompt.trim() || uploading} loading={submitting} onClick={submit}>生成三秒开场</Button>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的开场视频</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
          {tasks.length === 0 ? <Empty description="暂无真实开场任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3"><div className="mb-2 flex justify-between text-xs text-gray-500"><span>{task.task_no}</span><span>{task.stage || task.status}</span></div>
            {task.status === 'success' && task.result?.videos?.[0]?.url ? <><video controls className="w-full rounded-lg bg-black" src={withBase(task.result.videos[0].url)} />{!!task.result.warnings?.length && <p className="mt-2 text-xs text-amber-600">{task.result.warnings.join('；')}</p>}</> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
            {(task.status === 'pending' || ((task.status === 'running' || task.status === 'reconciling') && task.provider_task_id)) && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消</Button>}
            {(task.status === 'failed' || (task.status === 'reconciling' && task.provider_task_id)) && <Button className="ml-2 mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>{task.status === 'failed' ? '重新尝试' : '检查结果'}</Button>}
          </div>)}</div>}</div>
      </div>
    </div>
  )
}
