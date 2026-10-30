import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, message, Select, Spin, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any }

const styles = [
  { value: '极简白色影棚，柔和自然光', label: '极简影棚' },
  { value: '暖色家居空间，晨间自然光', label: '温馨家居' },
  { value: '深色高端影棚，柔和轮廓光', label: '高端影棚' },
]

export default function AIProductStudio() {
  const [images, setImages] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [sourceUrl, setSourceUrl] = useState<string>()
  const [imageUrl, setImageUrl] = useState<string>()
  const [preparedMethod, setPreparedMethod] = useState<'original' | 'u2netp'>()
  const [prompt, setPrompt] = useState(styles[0].value)
  const [uploading, setUploading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    api.materials({ type: 'image', pageSize: 100 }).then((data: any) => setImages((data.list || []).filter((image: Material) => /^\/(?:uploads|api\/(?:material\/)?files)\//.test(image.url) && /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(image.url)))).catch(() => {})
    api.tasks({ module: 'studio', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])

  const prepare = async (url?: string) => {
    setSourceUrl(url)
    setImageUrl(undefined)
    setPreparedMethod(undefined)
    if (!url) return
    setPreparing(true)
    try {
      const prepared: { url: string; method: 'original' | 'u2netp' } = await api.prepareStudio({ imageUrl: url })
      setImageUrl(prepared.url)
      setPreparedMethod(prepared.method)
      load()
    } catch {} finally { setPreparing(false) }
  }

  const upload = async (file?: File) => {
    if (!file) return
    if (!/\.(?:png|jpe?g|webp)$/i.test(file.name)) return message.warning('请上传 JPG、PNG 或 WebP 商品图')
    if (file.size > 10 * 1024 * 1024) return message.warning('图片不能超过 10 MB')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const saved: any = await api.uploadMaterial(form)
      message.success('商品图片已上传')
      await prepare(saved.url)
    } catch {} finally { setUploading(false) }
  }

  const submit = async () => {
    if (!imageUrl) return message.warning('请先选择商品图片')
    setSubmitting(true)
    try {
      await api.createStudio({ imageUrl, prompt, count: 1 })
      message.success('商拍任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  return <div className="mx-auto max-w-5xl pb-12">
    <h1 className="text-2xl font-bold text-gray-900">AI商拍</h1>
    <p className="mt-2 text-sm text-gray-500">生成场景背景，并合成你上传的商品原图。</p>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <div>
          <label className="mb-2 block text-sm font-medium">1. 选择商品图片</label>
          <div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择商品图" allowClear value={sourceUrl} onChange={(url) => { void prepare(url) }} disabled={uploading || preparing} showSearch optionFilterProp="label" options={images.map((image) => ({ value: image.url, label: image.name }))} />
            <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={uploading || preparing} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传图片'}</label></div>
          {preparing && <div className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-500"><Spin size="small" /> 正在检查并处理商品主体，请稍候…</div>}
          {sourceUrl && !preparing && <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-100 p-2"><p className="mb-2 text-xs text-gray-500">原图</p><img src={sourceUrl} alt="商品原图" className="mx-auto max-h-48 object-contain" /></div>
            {imageUrl ? <div className="rounded-lg bg-gray-100 p-2"><p className="mb-2 text-xs text-gray-500">{preparedMethod === 'original' ? '使用原透明图' : '自动抠图结果'}</p><img src={imageUrl} alt="待合成的商品主体" className="mx-auto max-h-48 object-contain" /></div>
              : <div className="flex flex-col items-center justify-center rounded-lg bg-gray-50 p-3 text-center text-xs text-gray-500"><span>图片尚未处理成功</span><Button className="mt-2" size="small" onClick={() => { void prepare(sourceUrl) }}>重新处理</Button></div>}
          </div>}
          <p className="mt-2 text-xs leading-5 text-gray-500">支持 10 MB 以内的 JPG、PNG、WebP。普通照片会自动抠图；透明 PNG 可直接使用。请先检查主体是否完整、是否保留手或其他物体，必要时使用透明 PNG。商品按原图合成，不会重新绘制包装文字。</p>
        </div>
        <div><label className="mb-2 block text-sm font-medium">2. 选择或描述背景</label>
          <div className="mb-2 flex flex-wrap gap-2">{styles.map((style) => <Button key={style.value} size="small" onClick={() => setPrompt(style.value)}>{style.label}</Button>)}</div>
          <Input.TextArea rows={3} maxLength={400} showCount value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：暖色家居空间，柔和自然光" />
        </div>
        <p className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">输出一张 1024×1024 图片。背景由 AI 生成，商品直接叠加；光影融合与商品边缘请在使用前检查。</p>
        <div className="flex justify-between text-sm text-gray-500"><span>预计消耗</span><span>30 点 / 张</span></div>
        <Button type="primary" size="large" block loading={submitting} disabled={uploading || preparing || !imageUrl} onClick={submit}>生成商品场景图</Button>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的商拍任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
        {tasks.length === 0 ? <Empty description="暂无任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500"><span>{task.task_no}</span><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.stage || task.status}</Tag></div>
          {task.status === 'success' && task.result?.images?.[0]?.url ? <>
            {!!task.result.warnings?.length && <p className="mb-2 text-xs leading-5 text-amber-600">{task.result.warnings.join('；')}</p>}
            <img src={task.result.images[0].url} alt="生成的商品场景图" className="w-full rounded-lg" />
            <a className="mt-2 inline-block text-xs text-purple-600" href={task.result.images[0].url} target="_blank" rel="noreferrer">打开图片</a>
          </> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
          {task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}
          {['failed', 'reconciling'].includes(task.status) && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}
        </div>)}</div>}
      </div>
    </div>
  </div>
}
