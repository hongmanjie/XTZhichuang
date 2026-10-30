import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Empty, Input, InputNumber, message, Modal, Popconfirm, Radio, Select, Spin } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Voice = { id: number; name: string }
type Material = { id: number; name: string; url: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any; provider_task_id?: string }

export default function VoiceStudio() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [videoUrl, setVideoUrl] = useState<string>()
  const [voiceId, setVoiceId] = useState<number>()
  const [script, setScript] = useState('')
  const [mode, setMode] = useState('replace')
  const [speed, setSpeed] = useState(1)
  const [subtitle, setSubtitle] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [voiceModal, setVoiceModal] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)

  const load = useCallback(() => {
    api.voiceProfiles().then((data: any) => setVoices(data || [])).catch(() => {})
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setMaterials(data.list || [])).catch(() => {})
    api.tasks({ module: 'voiceDub', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])

  const uploadVideo = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('video/')) return message.warning('请选择视频文件')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result: any = await api.uploadMaterial(form)
      setVideoUrl(result.url)
      load()
      message.success('视频已上传')
    } catch {} finally { setUploading(false) }
  }

  const saveVoice = async () => {
    if (!voiceName.trim() || !voiceFile) return message.warning('请填写名称并选择参考音频')
    if (!consent) return message.warning('请确认音色使用授权')
    if (voiceFile.size > 10 * 1024 * 1024) return message.warning('音频不能超过 10 MB')
    setSavingVoice(true)
    try {
      const form = new FormData()
      form.append('name', voiceName.trim())
      form.append('audio', voiceFile)
      form.append('consent', 'true')
      const saved: any = await api.uploadVoice(form)
      setVoiceId(saved.id)
      setVoiceModal(false)
      setVoiceName(''); setVoiceFile(null); setConsent(false)
      load()
      message.success('音色已添加')
    } catch {} finally { setSavingVoice(false) }
  }

  const createDub = async () => {
    if (!videoUrl || !voiceId || !script.trim()) return message.warning('请选择视频、音色并填写配音文案')
    setSubmitting(true)
    try {
      await api.dubVoice({ videoUrl, voiceId, text: script, mode, speed, lang: 'zh', subtitle })
      message.success('配音任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <h1 className="text-2xl font-bold text-gray-900">配音与口型</h1>
      <p className="mt-2 text-sm text-gray-500">上传视频，选择授权音色并输入文案，生成新的配音视频。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <div><label className="mb-2 block text-sm font-medium">1. 选择视频</label>
            <div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择" value={videoUrl} onChange={setVideoUrl} showSearch optionFilterProp="label" options={materials.map((m) => ({ value: m.url, label: m.name }))} />
              <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="video/*" disabled={uploading} onChange={(event) => { uploadVideo(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传视频'}</label></div>
            {videoUrl && <video src={videoUrl} controls className="mt-3 max-h-56 w-full rounded-lg bg-black" />}</div>
          <div><label className="mb-2 block text-sm font-medium">2. 选择音色</label><div className="flex gap-2"><Select className="flex-1" placeholder="选择我的音色" value={voiceId} onChange={setVoiceId} options={voices.map((v) => ({ value: v.id, label: v.name }))} /><Button icon={<PlusOutlined />} onClick={() => setVoiceModal(true)}>添加音色</Button></div>
            {voiceId && <Popconfirm title="删除该音色？" description="删除后无法继续用它合成语音。" onConfirm={async () => { try { await api.deleteVoice(voiceId); setVoiceId(undefined); load(); message.success('音色已删除') } catch {} }}><button className="mt-2 text-xs text-gray-500 hover:text-red-500"><DeleteOutlined /> 删除所选音色</button></Popconfirm>}</div>
          <div><label className="mb-2 block text-sm font-medium">3. 输入配音文案</label><Input.TextArea rows={5} maxLength={600} showCount value={script} onChange={(e) => setScript(e.target.value)} placeholder="输入视频需要说的话" /></div>
          <div className="flex flex-wrap items-center gap-4"><span className="text-sm">语速</span><InputNumber min={0.5} max={2} step={0.1} value={speed} onChange={(value) => setSpeed(value || 1)} /><span className="text-xs text-gray-500">文案过长时可提高语速或缩短内容</span></div>
          <div><div className="mb-2 text-sm font-medium">原视频声音</div><Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}><Radio value="replace">替换原音</Radio><Radio value="mix">保留低音量原音</Radio></Radio.Group><p className="mt-2 text-xs text-gray-500">保留原音时，原视频中的人声也会保留并可能与新配音重叠。</p></div>
          <div><Checkbox checked={subtitle} onChange={(event) => setSubtitle(event.target.checked)}>添加新字幕</Checkbox><p className="mt-2 text-xs text-gray-500">字幕按文案和语音时长估算，可能与语音存在偏差；不会自动去除画面里的旧字幕。</p></div>
          <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">口型同步暂未接入；当前配音会替换或混合音轨，人物嘴型不会自动改变。画面中已有的字幕也不会自动移除。</div>
          <Button type="primary" size="large" block loading={submitting} disabled={uploading} onClick={createDub}>生成配音视频</Button>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的配音任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
          {tasks.length === 0 ? <Empty description="暂无任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3"><div className="mb-2 flex justify-between text-xs text-gray-500"><span>{task.task_no}</span><span>{task.stage || task.status}</span></div>{task.status === 'success' && task.result?.videos?.[0]?.url ? <video controls className="w-full rounded-lg bg-black" src={task.result.videos[0].url} /> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}{task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}{(task.status === 'failed' || task.status === 'reconciling') && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新发起配音</Button>}</div>)}</div>}</div>
      </div>
      <Modal title="添加授权音色" open={voiceModal} onCancel={() => setVoiceModal(false)} onOk={saveVoice} confirmLoading={savingVoice} okText="添加音色">
        <p className="mb-4 text-sm text-gray-500">上传 1–30 秒清晰人声，推荐 3–10 秒。请仅使用你有权使用的声音。</p>
        <Input placeholder="音色名称" maxLength={50} value={voiceName} onChange={(e) => setVoiceName(e.target.value)} />
        <input className="mt-4 block text-sm" type="file" accept="audio/*" onChange={(event) => setVoiceFile(event.target.files?.[0] || null)} />
        <Checkbox className="mt-4" checked={consent} onChange={(event) => setConsent(event.target.checked)}>我确认已获得该声音的使用授权</Checkbox>
      </Modal>
    </div>
  )
}
