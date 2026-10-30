import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, message, Select, Spin, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any; params?: any }

export default function VideoAnalysis() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoUrl, setVideoUrl] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const load = useCallback(() => {
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setMaterials(data.list || [])).catch(() => {})
    api.tasks({ module: 'videoAnalysis', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])
  const upload = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('video/')) return message.warning('请选择视频文件')
    setUploading(true)
    try {
      const form = new FormData(); form.append('file', file)
      const result: any = await api.uploadMaterial(form)
      setVideoUrl(result.url); load(); message.success('视频已上传')
    } catch {} finally { setUploading(false) }
  }
  const submit = async () => {
    if (!videoUrl) return message.warning('请选择需要解析的视频')
    setSubmitting(true)
    try { await api.createVideoAnalysis({ videoUrl }); message.success('解析任务已加入队列'); load() }
    catch {} finally { setSubmitting(false) }
  }
  return <div className="mx-auto max-w-5xl pb-12">
    <h1 className="text-2xl font-bold">视频解析</h1>
    <p className="mt-2 text-sm text-gray-500">识别视频中的语音与画面文字，检测疑似画面切换，并整理识别内容。</p>
    <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">当前不理解画面中的人物、动作和镜头结构；视频分享链接解析尚未接入。识别和 AI 整理都可能有误，请核对原片。</div>
    <div className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-3"><Select className="min-w-[260px] flex-1" placeholder="从素材库选择视频" showSearch optionFilterProp="label" value={videoUrl} onChange={setVideoUrl} options={materials.map((item) => ({ value: item.url, label: item.name }))} />
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="video/*" disabled={uploading} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传视频'}</label>
        <Button type="primary" loading={submitting} disabled={uploading} onClick={submit}>开始解析 · 50 点</Button></div>
      <p className="mt-3 text-xs text-gray-500">支持不超过 120 秒的视频，最多抽取 5 帧识别文字；失败会退回本次预留点数。</p>
      {videoUrl && <video src={videoUrl} controls className="mt-4 max-h-64 w-full rounded-lg bg-black" />}
    </div>
    <div className="mb-4 mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">我的解析</h2><button className="text-xs text-purple-500" onClick={load}><ReloadOutlined /> 刷新</button></div>
    {tasks.length === 0 ? <div className="rounded-2xl bg-white p-8"><Empty description="暂无解析任务" /></div> : <div className="space-y-4">{tasks.map((task) => <AnalysisCard key={task.id} task={task} refresh={load} />)}</div>}
  </div>
}

function AnalysisCard({ task, refresh }: { task: Task; refresh: () => void }) {
  const analysis = task.result?.analysis
  const active = ['pending', 'running'].includes(task.status)
  const retry = async () => { try { await api.retryTask({ id: task.id }); refresh() } catch {} }
  const cancel = async () => { try { await api.cancelTask({ id: task.id }); refresh() } catch {} }
  return <div className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="font-medium">{task.task_no}</span><Tag className="ml-2" color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.stage || task.status}</Tag></div><div className="flex gap-2">{task.status === 'pending' && <Button size="small" onClick={cancel}>取消排队</Button>}{['failed', 'reconciling'].includes(task.status) && <Button size="small" onClick={retry}>重新解析</Button>}</div></div>
    {active && <div className="py-5 text-center"><Spin /></div>}
    {task.error && <p className="mt-3 text-sm text-amber-600">{task.error}</p>}
    {analysis && <div className="mt-4 space-y-4 text-sm"><p className="rounded-lg bg-amber-50 p-3 text-amber-800">{analysis.limitation}</p><div><h3 className="mb-1 font-medium">语音转写</h3><p className="whitespace-pre-wrap text-gray-600">{analysis.transcript || '未识别到语音文字'}</p></div><div><h3 className="mb-2 font-medium">抽帧文字</h3>{analysis.frames?.length ? <div className="space-y-1">{analysis.frames.map((frame: any, index: number) => <p key={index} className="text-gray-600">{frame.time} 秒：{frame.text || '未识别到文字'}</p>)}</div> : <p className="text-gray-500">没有可用的抽帧识别结果</p>}</div>{analysis.sceneChanges && <div><h3 className="mb-1 font-medium">疑似画面切换</h3><p className="text-gray-600">{analysis.sceneChanges.times?.length ? `${analysis.sceneChanges.times.join('、')} 秒${analysis.sceneChanges.truncated ? '（仅展示前 50 处）' : ''}` : '未检测到明显画面突变'}</p><p className="mt-1 text-xs text-gray-500">自动检测可能误判或漏判，不能说明画面内容。</p></div>}{analysis.summary && <div><h3 className="mb-1 font-medium">基于识别文字的整理建议</h3><p className="whitespace-pre-wrap text-gray-600">{analysis.summary}</p></div>}{task.result?.warnings?.length > 0 && <div className="text-amber-700">{task.result.warnings.join('；')}</div>}</div>}
  </div>
}
