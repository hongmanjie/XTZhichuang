import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, message, Select, Spin } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type FrameRole = 'first' | 'last'
type Frame = { type: 'image'; role: FrameRole; url: string; name: string }
type VideoTask = {
  id: number; task_no: string; title: string; status: string; stage?: string; error?: string
  points_cost: number; provider_task_id?: string; params?: any; result?: any
}

const resolutions: Record<string, Record<string, string>> = {
  '540P': { '9:16': '544 × 960', '16:9': '960 × 544', '1:1': '544 × 544' },
  '720P': { '9:16': '736 × 1280', '16:9': '1280 × 736', '1:1': '736 × 736' },
}

export default function VideoGeneration() {
  const [prompt, setPrompt] = useState('')
  const [frames, setFrames] = useState<Partial<Record<FrameRole, Frame>>>({})
  const [uploading, setUploading] = useState<FrameRole | null>(null)
  const [ratio, setRatio] = useState('9:16')
  const [resolution, setResolution] = useState('720P')
  const [duration, setDuration] = useState(4)
  const [submitting, setSubmitting] = useState(false)
  const [writing, setWriting] = useState(false)
  const [tasks, setTasks] = useState<VideoTask[]>([])
  const cost = (resolution === '540P' ? 12 : 16) * (duration > 8 ? Math.ceil(duration / 8) * 2 : duration / 4)

  const loadTasks = useCallback(() => {
    api.tasks({ module: 'materialField', pageSize: 24 })
      .then((data: any) => setTasks(data.list || []))
      .catch(() => {})
  }, [])
  useEffect(() => {
    loadTasks()
    const timer = setInterval(loadTasks, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  const uploadFrame = async (role: FrameRole, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message.warning('请上传 JPG、PNG 或 WebP 图片')
    if (file.size > 10 * 1024 * 1024) return message.warning('图片不能超过 10 MB')
    setUploading(role)
    try {
      const form = new FormData()
      form.append('file', file)
      const material: any = await api.uploadMaterial(form)
      setFrames((current) => ({ ...current, [role]: { type: 'image', role, url: material.url, name: material.name || file.name } }))
    } catch {} finally { setUploading(null) }
  }

  const writePrompt = async () => {
    setWriting(true)
    try {
      const result: any = await api.mfPrompt({ input: prompt, refs: Object.values(frames).filter(Boolean) })
      setPrompt(result.optimized)
      message.success(result.engine === 'real' ? '已优化创作描述' : '已生成参考描述')
    } catch {} finally { setWriting(false) }
  }

  const submit = async () => {
    if (!prompt.trim()) return message.warning('请先描述想要的视频')
    if (uploading) return message.warning('图片正在上传，请稍候')
    setSubmitting(true)
    try {
      await api.createMaterialField({ prompt, refs: Object.values(frames).filter(Boolean), model: 'MiniMax-H3', ratio, resolution, duration })
      message.success('任务已加入队列')
      loadTasks()
    } catch {} finally { setSubmitting(false) }
  }

  return (
    <div className="-m-6 min-h-[calc(100vh-3.5rem)] bg-[#0A0714] px-6 pb-16 pt-10 text-white">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-center text-3xl font-bold">AI 视频创作</h1>
        <p className="mt-3 text-center text-sm text-[#a69bc9]">描述画面，可选择首帧、尾帧，系统自动生成视频</p>

        <div className="mt-8 rounded-2xl border border-[#302646] bg-[#140e22] p-6">
          <div className="flex flex-wrap gap-4">
            {(['first', 'last'] as FrameRole[]).map((role) => {
              const frame = frames[role]
              return (
                <div key={role} className="w-36">
                  <div className="mb-2 text-xs text-[#c0b6db]">{role === 'first' ? '首帧' : '尾帧'}（可选）</div>
                  <label className="relative flex h-28 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#554477] bg-[#0d0918] hover:border-purple-400">
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={(event) => uploadFrame(role, event)} />
                    {uploading === role ? <Spin /> : frame ? <img src={frame.url} alt={frame.name} className="h-full w-full object-contain" /> : <span className="text-center text-xs text-[#998dbb]"><PlusOutlined /><br />上传图片</span>}
                  </label>
                  {frame && <button className="mt-1 text-xs text-[#a79ac7] hover:text-white" onClick={() => setFrames((old) => ({ ...old, [role]: undefined }))}>移除</button>}
                </div>
              )
            })}
            <div className="min-w-[240px] flex-1">
              <div className="mb-2 text-xs text-[#c0b6db]">创作描述</div>
              <textarea className="h-28 w-full resize-none rounded-xl border border-[#403456] bg-[#0d0918] p-3 text-sm text-white outline-none focus:border-purple-400" maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：一款护肤品放在大理石台面上，镜头缓慢推进，晨光洒在瓶身" />
              <div className="mt-2 flex justify-between text-xs text-[#9486b9]"><span>{prompt.length}/2000</span><button onClick={writePrompt} disabled={writing}>{writing ? '正在优化…' : '智能优化描述'}</button></div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-[#302646] pt-5">
            <Field label="模型"><div className="rounded-lg bg-[#231936] px-3 py-2 text-sm">MiniMax-H3</div></Field>
            <Field label="画幅"><Select value={ratio} onChange={setRatio} style={{ width: 110 }} options={['9:16', '16:9', '1:1'].map((value) => ({ value, label: value }))} /></Field>
            <Field label="清晰度"><Select value={resolution} onChange={setResolution} style={{ width: 110 }} options={['540P', '720P'].map((value) => ({ value, label: value }))} /></Field>
            <Field label="时长"><Select value={duration} onChange={setDuration} style={{ width: 105 }} options={[4, 8, 15, 30, 60].map((value) => ({ value, label: `${value} 秒` }))} /></Field>
            <div className="ml-auto text-right"><div className="mb-2 text-xs text-[#a99acb]">{resolutions[resolution][ratio]} · 预计 {cost} 点</div><Button type="primary" size="large" loading={submitting} disabled={!!uploading} onClick={submit}>生成视频</Button></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#9183ac]">首尾帧均可省略。15–60 秒视频由系统自动规划、逐段生成并合成；时长越长，所需排队和生成时间越长。</p>
        </div>

        <div className="mb-4 mt-10 flex items-center justify-between"><h2 className="text-lg font-semibold">我的创作</h2><button className="text-xs text-[#b7a8df]" onClick={loadTasks}><ReloadOutlined /> 刷新</button></div>
        {tasks.length === 0 ? <div className="rounded-2xl bg-[#140e22] py-12"><Empty description={<span className="text-[#9183ac]">暂无创作任务</span>} /></div> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tasks.map((task) => <TaskCard key={task.id} task={task} refresh={loadTasks} />)}</div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-2 text-xs text-[#b5a8d4]">{label}</div>{children}</div>
}

function TaskCard({ task, refresh }: { task: VideoTask; refresh: () => void }) {
  const video = task.result?.videos?.[0]
  const active = task.status === 'pending' || task.status === 'running'
  const terminal = ['success', 'failed', 'canceled'].includes(task.status)
  const resume = async () => {
    try { await api.retryTask({ id: task.id }); message.success(task.status === 'reconciling' ? '正在检查上游结果' : '任务已重新加入队列'); refresh() } catch {}
  }
  const remove = async () => {
    try { await api.deleteTasks({ ids: [task.id] }); refresh() } catch {}
  }
  const cancel = async () => {
    try {
      const result: any = await api.cancelTask({ id: task.id })
      message.info(result.status === 'canceled' ? '任务已取消' : result.status === 'succeeded' ? '上游已生成，正在获取结果' : result.status === 'failed' ? '上游已失败，正在更新状态' : '取消请求已提交，等待上游确认')
      refresh()
    } catch {}
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[#302646] bg-[#140e22]">
      <div className="flex aspect-video items-center justify-center bg-black">
        {task.status === 'success' && video?.url ? <video src={video.url} poster={video.cover || undefined} controls className="h-full w-full" /> : active ? <div className="text-center"><Spin /><div className="mt-3 text-xs text-[#b3a4d1]">{task.stage || '任务进行中'}</div></div> : <span className="text-sm text-[#b3a4d1]">{task.status === 'reconciling' ? '上游状态待核对' : task.status === 'canceled' ? '已取消' : '生成失败'}</span>}
      </div>
      <div className="p-4"><div className="truncate text-sm">{task.title}</div><div className="mt-1 text-xs text-[#9386b0]">{task.task_no} · {task.points_cost} 点</div>
        {video?.resolution && <div className="mt-1 text-xs text-[#9386b0]">{video.resolution} · {Number(video.duration).toFixed(1)} 秒</div>}
        {task.error && <div className="mt-2 text-xs leading-5 text-amber-300">{task.error}</div>}
        <div className="mt-3 flex gap-3 text-xs text-[#c4b5fd]">{(task.status === 'failed' || (task.status === 'reconciling' && task.provider_task_id)) && <button onClick={resume}><ReloadOutlined /> {task.status === 'reconciling' ? '检查结果' : '重试'}</button>}{(task.status === 'pending' || ((task.status === 'running' || task.status === 'reconciling') && task.provider_task_id)) && <button onClick={cancel}>取消任务</button>}{terminal && <button onClick={remove}><DeleteOutlined /> 删除</button>}</div>
      </div>
    </div>
  )
}
