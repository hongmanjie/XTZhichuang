import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Empty, Input, message, Select, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { api } from '../../api/request'
import { withBase } from '../../utils/base'

type Voice = { id: number; name: string }
type Material = { id: number; name: string; url: string }
type Scene = { key: string; name: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any }

export default function DigitalHuman() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [images, setImages] = useState<Material[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [firstFrame, setFirstFrame] = useState<string>()
  const [voiceId, setVoiceId] = useState<number>()
  const [sceneKey, setSceneKey] = useState<string>()
  const [humanName, setHumanName] = useState('')
  const [script, setScript] = useState('')
  const [subtitle, setSubtitle] = useState(true)
  const [lipSync, setLipSync] = useState(false)
  const [lipSyncAvailable, setLipSyncAvailable] = useState<boolean | null>(null)
  const [resolution, setResolution] = useState('540P')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    api.voiceProfiles().then((data: any) => setVoices(data || [])).catch(() => {})
    api.materials({ type: 'image', pageSize: 100 }).then((data: any) => setImages(data.list || [])).catch(() => {})
    api.digitalHumanScenes().then((data: any) => setScenes(data || [])).catch(() => {})
    api.tasks({ module: 'human', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    const check = () => api.voiceStatus().then((status) => setLipSyncAvailable(status.lipSyncAvailable)).catch(() => setLipSyncAvailable(null))
    check()
    const timer = setInterval(check, 30000)
    return () => clearInterval(timer)
  }, [])

  const uploadImage = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message.warning('请上传 JPG、PNG 或 WebP 图片')
    if (file.size > 10 * 1024 * 1024) return message.warning('图片不能超过 10 MB')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const saved: any = await api.uploadMaterial(form)
      setFirstFrame(saved.url)
      load()
      message.success('人物图片已上传')
    } catch {} finally { setUploading(false) }
  }

  const submit = async () => {
    if (!script.trim()) return message.warning('请填写文案')
    setSubmitting(true)
    try {
      await api.createHuman({ text: script.trim(), firstFrame: firstFrame || null, voiceProfileId: voiceId || null,
        humanName: humanName.trim(), sceneKey: sceneKey || null, count: 1, resolution, subtitle: { enabled: subtitle, style: 'pure' }, lipSync })
      message.success('任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <h1 className="text-2xl font-bold text-gray-900">数字人视频</h1>
      <p className="mt-2 text-sm text-gray-500">生成一段人物视频，可选人物图片、授权音色和字幕。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-2 block text-sm font-medium">1. 人物图片（可选）</label>
            <div className="flex gap-2">
              <Select className="flex-1" placeholder="从素材库选择" allowClear value={firstFrame} onChange={setFirstFrame} showSearch optionFilterProp="label" options={images.map((image) => ({ value: image.url, label: image.name }))} />
              <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { uploadImage(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传图片'}</label>
            </div>
            {firstFrame && <img src={withBase(firstFrame)} alt="选中的人物图片" className="mt-3 max-h-48 rounded-lg object-contain" />}
            <p className="mt-2 text-xs text-gray-500">图片作为首帧参考；生成的人物形象和动作可能变化。</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">2. 人物和场景（可选）</label>
            <Input maxLength={80} value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="例如：亲切的女主播，穿米色上衣" />
            <Select className="!mt-2 w-full" placeholder="选择场景" allowClear value={sceneKey} onChange={setSceneKey} options={scenes.map((scene) => ({ value: scene.key, label: scene.name }))} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">3. 文案</label>
            <Input.TextArea rows={3} maxLength={35} showCount value={script} onChange={(event) => setScript(event.target.value)} placeholder="输入本段要表达的内容，最多 35 字" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">4. 配音和字幕（可选）</label>
            <Select className="w-full" placeholder="选择我的授权音色" allowClear value={voiceId} onChange={(value) => { setVoiceId(value); if (!value) setLipSync(false) }} options={voices.map((voice) => ({ value: voice.id, label: voice.name }))} />
            <p className="mt-2 text-xs leading-5 text-gray-500">不选音色时不会合成配音。可在 <Link to="/voice" className="text-purple-600">配音与口型</Link> 添加音色。</p>
            <Checkbox className="!mt-2" checked={subtitle} onChange={(event) => setSubtitle(event.target.checked)}>添加字幕</Checkbox>
            <Checkbox className="!mt-2 !ml-4" checked={lipSync} disabled={!voiceId || (lipSyncAvailable === false && !lipSync)} onChange={(event) => setLipSync(event.target.checked)}>同步人物口型</Checkbox>
            {lipSyncAvailable === false && <p className="mt-1 text-xs text-amber-700">口型同步服务暂不可用，可关闭后继续生成。</p>}
            <p className="mt-2 text-xs leading-5 text-gray-500">口型同步需要已选音色，清晰正面的人物效果更好，处理可能较慢；失败时保留生成画面或普通配音并显示提示。系统会抽帧检查画面文字，发现疑似文字或检查失败时暂停添加字幕；抽帧可能漏检或误判，请检查成片。已有画面文字不会自动移除。</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">5. 清晰度</label>
            <Select className="w-full" value={resolution} onChange={setResolution} options={[
              { value: '540P', label: '540P（544 × 960）' }, { value: '720P', label: '720P（736 × 1280）' },
            ]} />
          </div>
          <div className="flex items-center justify-between text-sm text-gray-500"><span>预计消耗</span><span>70 点 / 条</span></div>
          <Button type="primary" size="large" block loading={submitting} disabled={uploading || (lipSync && lipSyncAvailable === false)} onClick={submit}>生成数字人视频</Button>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的数字人任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
          {tasks.length === 0 ? <Empty description="暂无任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3">
            <div className="mb-2 flex justify-between text-xs text-gray-500"><span>{task.task_no}</span><span>{task.stage || task.status}</span></div>
            {task.status === 'success' && task.result?.videos?.[0]?.url ? <>
              <video controls className="w-full rounded-lg bg-black" src={withBase(task.result.videos[0].url)} />
              {!!task.result.warnings?.length && <p className="mt-2 text-xs leading-5 text-amber-600">{task.result.warnings.join('；')}</p>}
            </> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}
            {task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}
            {(task.status === 'failed' || (task.status === 'reconciling' && !['口型状态待核对', '配音状态待核对'].includes(task.stage || ''))) && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}
          </div>)}</div>}
        </div>
      </div>
    </div>
  )
}
