import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Empty, Input, message, Popconfirm, Select, Spin, Tag } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, ReloadOutlined, ScissorOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; title: string; status: string; stage?: string; error?: string; result?: any }

export default function MixList() {
  const navigate = useNavigate()
  const [videos, setVideos] = useState<Material[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setVideos((data.list || []).filter((item: Material) => /^\/(?:uploads|api\/(?:material\/)?files)\//.test(item.url)))).catch(() => {})
    api.tasks({ module: 'videoJoin', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
    api.mixList({ pageSize: 50 }).then((data: any) => setHistory(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])

  const upload = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('video/')) return message.warning('请选择视频文件')
    if (file.size > 500 * 1024 * 1024) return message.warning('视频不能超过 500 MB')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const saved: Material = await api.uploadMaterial(form)
      setVideos((items) => [saved, ...items.filter((item) => item.url !== saved.url)])
      setSelected((items) => items.length < 6 ? [...items, saved.url] : items)
      if (selected.length >= 6) message.info('视频已上传；当前最多选择 6 个片段')
      else message.success('视频已上传并加入片段')
      load()
    } catch {} finally { setUploading(false) }
  }

  const move = (index: number, direction: number) => setSelected((items) => {
    const next = [...items]
    const other = index + direction
    if (other >= 0 && other < next.length) [next[index], next[other]] = [next[other], next[index]]
    return next
  })

  const submit = async () => {
    if (selected.length < 2 || selected.length > 6) return message.warning('请选择 2–6 个视频片段')
    setSubmitting(true)
    try {
      await api.joinVideos({ videoUrls: selected, title })
      message.success('拼接任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  return <div className="mx-auto max-w-6xl pb-12">
    <h1 className="text-2xl font-bold text-gray-900"><ScissorOutlined className="mr-2 text-primary" />智能剪辑</h1>
    <p className="mt-2 text-sm text-gray-500">选择视频并调整顺序，系统自动拼接。语义匹配和自动选镜尚未接入。</p>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
        <div>
          <label className="mb-2 block text-sm font-medium">1. 选择 2–6 个视频片段</label>
          <div className="flex gap-2">
            <Select mode="multiple" className="flex-1" placeholder="按顺序从素材库选择" value={selected} disabled={uploading} showSearch optionFilterProp="label"
              onChange={(value: string[]) => { if (value.length > 6) message.warning('最多选择 6 个片段'); else setSelected(value) }}
              options={videos.map((item) => ({ value: item.url, label: item.name }))} />
            <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400">
              <input type="file" hidden accept="video/*" disabled={uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} />
              {uploading ? '上传中…' : '上传视频'}
            </label>
          </div>
          {selected.length > 0 && <div className="mt-3 space-y-2">{selected.map((url, index) => <div key={url} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-400">{index + 1}.</span><span className="min-w-0 flex-1 truncate">{videos.find((item) => item.url === url)?.name || '已选视频'}</span>
            <Button size="small" aria-label="上移片段" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
            <Button size="small" aria-label="下移片段" icon={<ArrowDownOutlined />} disabled={index === selected.length - 1} onClick={() => move(index, 1)} />
          </div>)}</div>}
        </div>
        <div><label className="mb-2 block text-sm font-medium">2. 作品名称（可选）</label><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} placeholder="例如：商品展示合集" /></div>
        <p className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">按所选顺序连接并保留各片段原声，画幅以第一个片段为准。每段不超过 120 秒，总长不超过 180 秒，尺寸不超过 1080p；目前本地处理暂不扣点。</p>
        <Button type="primary" size="large" block loading={submitting} disabled={uploading || selected.length < 2} onClick={submit}>开始拼接</Button>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的拼接任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
        {tasks.length === 0 ? <Empty description="暂无拼接任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500"><span>{task.title} · {task.task_no}</span><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.stage || task.status}</Tag></div>
          {task.status === 'success' && task.result?.videos?.[0]?.url ? <>
            {!!task.result.warnings?.length && <p className="mb-2 text-xs leading-5 text-amber-600">{task.result.warnings.join('；')}</p>}
            <video controls preload="metadata" src={task.result.videos[0].url} poster={task.result.videos[0].cover || undefined} className="max-h-96 w-full rounded-lg bg-black" />
            <a className="mt-2 inline-block text-xs text-purple-600" href={task.result.videos[0].url} target="_blank" rel="noreferrer">打开成片</a>
          </> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
          {task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}
          {['failed', 'reconciling'].includes(task.status) && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}
        </div>)}</div>}
      </div>
    </div>
    <details className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">旧版历史项目（{history.length}）</summary>
      <p className="mt-2 text-xs text-gray-500">旧版项目仅供查看，旧版导出和智能匹配不可用。</p>
      {history.length === 0 ? <Empty className="mt-4" description="暂无历史项目" /> : <div className="mt-4 space-y-2">{history.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm">
        <span className="flex-1 truncate">{item.name}</span><Button size="small" onClick={() => navigate(`/ai-mix/edit/${item.id}`)}>查看记录</Button>
        <Popconfirm title="确认删除该项目？" onConfirm={async () => { try { await api.deleteMix({ id: item.id }); message.success('已删除'); load() } catch {} }}>
          <Button size="small" danger aria-label="删除历史项目" icon={<DeleteOutlined />} />
        </Popconfirm>
      </div>)}</div>}
    </details>
  </div>
}
