import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Empty, Input, InputNumber, message, Modal, Popconfirm, Radio, Select, Spin } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../../api/request'
import { withBase } from "../../utils/base"

type Voice = { id: number; name: string }
type VoiceStatus = { available: boolean | null; reason: string; managementAvailable: boolean | null; managementReason: string; synthesisProvider: string; maxTextLength: number; subtitleTranscribePoints: number | null }
type Material = { id: number; name: string; url: string }
type SubtitleSegment = { text: string; start: number | null; end: number | null }
type Task = { id: number; task_no: string; module: string; status: string; stage?: string; error?: string; result?: any; params?: any; provider_task_id?: string }

export default function VoiceStudio() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>()
  const [materials, setMaterials] = useState<Material[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [workMode, setWorkMode] = useState<'dub' | 'captions'>('dub')
  const [videoUrl, setVideoUrl] = useState<string>()
  const [voiceId, setVoiceId] = useState<number>()
  const [script, setScript] = useState('')
  const [mode, setMode] = useState('replace')
  const [speed, setSpeed] = useState(1)
  const [subtitle, setSubtitle] = useState(false)
  const [subtitleText, setSubtitleText] = useState('')
  const [segments, setSegments] = useState<SubtitleSegment[]>([{ text: '', start: 0, end: 3 }])
  const [subtitleStyle, setSubtitleStyle] = useState('pure')
  const [coverMode, setCoverMode] = useState('none')
  const [estimating, setEstimating] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [voiceModal, setVoiceModal] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)

  const load = useCallback(() => {
    api.voiceProfiles().then((data: any) => setVoices(data || [])).catch(() => {})
    api.materials({ type: 'video', pageSize: 100 }).then((data: any) => setMaterials((data.list || []).filter((item: Material) => /^\/(?:uploads|api\/(?:material\/)?files)\//.test(item.url)))).catch(() => {})
    Promise.all([api.tasks({ module: 'voiceDub', pageSize: 24 }), api.tasks({ module: 'subtitleEdit', pageSize: 24 }), api.tasks({ module: 'subtitleTranscribe', pageSize: 24 })])
      .then(([voice, captions, transcripts]: any[]) => setTasks([...(voice.list || []), ...(captions.list || []), ...(transcripts.list || [])].sort((a: Task, b: Task) => b.id - a.id))).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    const check = () => api.voiceStatus().then(setVoiceStatus).catch(() => setVoiceStatus({ available: null, reason: 'health_unknown', managementAvailable: null, managementReason: 'health_unknown', synthesisProvider: 'unknown', maxTextLength: 600, subtitleTranscribePoints: null }))
    check()
    const timer = setInterval(check, 30000)
    return () => clearInterval(timer)
  }, [])

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
    if (script.length > (voiceStatus?.maxTextLength || 600)) return message.warning(`当前配音方式最多支持 ${voiceStatus?.maxTextLength || 600} 字`)
    setSubmitting(true)
    try {
      await api.dubVoice({ videoUrl, voiceId, text: script, mode, speed, lang: 'zh', subtitle })
      message.success('配音任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  const makeDraft = async () => {
    if (!videoUrl || !subtitleText.trim()) return message.warning('请选择视频并填写字幕文案')
    setEstimating(true)
    try {
      const draft: { segments: SubtitleSegment[] } = await api.estimateSubtitles({ videoUrl, text: subtitleText })
      setSegments(draft.segments)
      message.success('已生成时间草稿，请逐句核对')
    } catch {} finally { setEstimating(false) }
  }

  const transcribe = async () => {
    if (!videoUrl) return message.warning('请先选择有声音的视频')
    setTranscribing(true)
    try {
      await api.transcribeSubtitles(videoUrl)
      message.success('语音识别任务已加入队列，完成后可应用草稿')
      load()
    } catch {} finally { setTranscribing(false) }
  }

  const createCaptions = async () => {
    if (!videoUrl) return message.warning('请先选择视频')
    if (segments.some((item) => !item.text.trim() || item.start === null || item.end === null)) return message.warning('请完整填写每条字幕及时间')
    setSubmitting(true)
    try {
      await api.createSubtitles({ videoUrl, segments: segments.map((item) => ({ text: item.text, start: Number(item.start), end: Number(item.end) })), style: subtitleStyle, coverMode })
      message.success('字幕任务已加入队列')
      load()
    } catch {} finally { setSubmitting(false) }
  }

  const updateSegment = (index: number, change: Partial<SubtitleSegment>) => setSegments((items) => items.map((item, i) => i === index ? { ...item, ...change } : item))

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <h1 className="text-2xl font-bold text-gray-900">配音与口型</h1>
      <p className="mt-2 text-sm text-gray-500">为视频配音，或校对字幕文字与时间后生成新视频。</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <Radio.Group value={workMode} onChange={(event) => { const next = event.target.value as 'dub' | 'captions'; if (next === 'captions' && !subtitleText && script) setSubtitleText(script); setWorkMode(next) }}>
            <Radio.Button value="dub">配音合成</Radio.Button><Radio.Button value="captions">字幕校对</Radio.Button>
          </Radio.Group>
          <div><label className="mb-2 block text-sm font-medium">1. 选择视频</label>
            <div className="flex gap-2"><Select className="flex-1" placeholder="从素材库选择" value={videoUrl} onChange={setVideoUrl} showSearch optionFilterProp="label" options={materials.map((m) => ({ value: m.url, label: m.name }))} />
              <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 text-sm hover:border-purple-400"><input type="file" hidden accept="video/*" disabled={uploading} onChange={(event) => { uploadVideo(event.target.files?.[0]); event.target.value = '' }} />{uploading ? '上传中…' : '上传视频'}</label></div>
            {videoUrl && <video src={withBase(videoUrl)} controls className="mt-3 max-h-56 w-full rounded-lg bg-black" />}</div>
          {workMode === 'dub' ? <>
          {voiceStatus?.available === false && <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">配音服务暂时不可连接，请检查网络或稍后重试；字幕校对仍可使用。</div>}
          {voiceStatus?.available === null && <p className="text-xs text-gray-500">暂时无法确认配音服务状态，可尝试使用。</p>}
          {voiceStatus?.managementAvailable === false && <p className="text-xs text-amber-700">音色管理服务暂时不可连接，无法添加或删除音色；已有音色能否使用取决于配音服务状态。</p>}
          <div><label className="mb-2 block text-sm font-medium">2. 选择音色</label><div className="flex gap-2"><Select className="flex-1" placeholder="选择我的音色" value={voiceId} onChange={setVoiceId} options={voices.map((v) => ({ value: v.id, label: v.name }))} /><Button icon={<PlusOutlined />} disabled={voiceStatus?.managementAvailable === false} onClick={() => setVoiceModal(true)}>添加音色</Button></div>
            {voiceId && <Popconfirm title="删除该音色？" description="删除后无法继续用它合成语音。" onConfirm={async () => { try { await api.deleteVoice(voiceId); setVoiceId(undefined); load(); message.success('音色已删除') } catch {} }}><button disabled={voiceStatus?.managementAvailable === false} className="mt-2 text-xs text-gray-500 hover:text-red-500 disabled:opacity-40"><DeleteOutlined /> 删除所选音色</button></Popconfirm>}</div>
          <div><label className="mb-2 block text-sm font-medium">3. 输入配音文案</label><Input.TextArea rows={5} maxLength={voiceStatus?.maxTextLength || 600} showCount value={script} onChange={(e) => setScript(e.target.value)} placeholder="输入视频需要说的话" /></div>
          <div className="flex flex-wrap items-center gap-4"><span className="text-sm">语速</span><InputNumber min={0.5} max={2} step={0.1} value={speed} onChange={(value) => setSpeed(value || 1)} /><span className="text-xs text-gray-500">文案过长时可提高语速或缩短内容</span></div>
          <div><div className="mb-2 text-sm font-medium">原视频声音</div><Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}><Radio value="replace">替换原音</Radio><Radio value="mix">保留低音量原音</Radio></Radio.Group><p className="mt-2 text-xs text-gray-500">保留原音时，原视频中的人声也会保留并可能与新配音重叠。</p></div>
          <div><Checkbox checked={subtitle} onChange={(event) => setSubtitle(event.target.checked)}>添加新字幕</Checkbox><p className="mt-2 text-xs text-gray-500">字幕按文案和语音时长估算，可能与语音存在偏差；不会自动去除画面里的旧字幕。</p></div>
          <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">口型同步暂未接入；当前配音会替换或混合音轨，人物嘴型不会自动改变。画面中已有的字幕也不会自动移除。</div>
          <Button type="primary" size="large" block loading={submitting} disabled={uploading || voiceStatus?.available === false} onClick={createDub}>生成配音视频</Button>
          </> : <>
            <div><label className="mb-2 block text-sm font-medium">2. 输入字幕文案（可选）</label>
              <Input.TextArea rows={3} maxLength={600} showCount value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} placeholder="粘贴文案后可生成时间草稿，也可直接逐条填写" />
              <div className="mt-2 flex flex-wrap gap-2"><Button loading={estimating} onClick={makeDraft}>按文案生成时间草稿</Button><Button loading={transcribing} disabled={uploading || !videoUrl || voiceStatus?.subtitleTranscribePoints == null} onClick={transcribe}>识别视频语音</Button></div>
              <p className="mt-2 text-xs text-gray-500">按文案分配的时间是估算；语音识别预留 {voiceStatus?.subtitleTranscribePoints ?? '—'} 点，明确失败会退还。两种草稿都请播放视频逐句核对。</p>
            </div>
            <div><label className="mb-2 block text-sm font-medium">3. 校对每句字幕与时间（秒）</label>
              <div className="space-y-2">{segments.map((item, index) => <div key={index} className="rounded-lg bg-gray-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-500"><span>第 {index + 1} 句</span><span className="flex-1" /><Button size="small" danger disabled={segments.length === 1} onClick={() => setSegments((items) => items.filter((_, i) => i !== index))}>删除</Button></div>
                <Input value={item.text} maxLength={120} placeholder="字幕文字" onChange={(event) => updateSegment(index, { text: event.target.value })} />
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500"><span>开始</span><InputNumber className="!w-24" min={0} max={180} step={0.1} value={item.start} onChange={(value) => updateSegment(index, { start: value })} /><span>结束</span><InputNumber className="!w-24" min={0} max={180} step={0.1} value={item.end} onChange={(value) => updateSegment(index, { end: value })} /></div>
              </div>)}</div>
              <Button className="mt-2" icon={<PlusOutlined />} disabled={segments.length >= 80} onClick={() => setSegments((items) => { const end = items[items.length - 1]?.end || 0; return [...items, { text: '', start: end, end: Math.min(180, end + 3) }] })}>添加一句</Button>
            </div>
            <div><label className="mb-2 block text-sm font-medium">字幕样式</label><Select value={subtitleStyle} onChange={setSubtitleStyle} options={[{ value: 'pure', label: '简洁白' }, { value: 'vivid', label: '电商金' }, { value: 'violet', label: '品牌紫' }]} /></div>
            <div><label className="mb-2 block text-sm font-medium">旧字幕遮挡</label><Select className="w-full" value={coverMode} onChange={setCoverMode} options={[{ value: 'none', label: '不遮挡' }, { value: 'bottom15', label: '底部黑条（画面高度的 15%）' }, { value: 'bottom20', label: '底部黑条（画面高度的 20%）' }, { value: 'bottom25', label: '底部黑条（画面高度的 25%）' }]} /><p className="mt-2 text-xs text-gray-500">黑条会整段遮住底部画面，再叠加新字幕；旧字幕不在黑条区域时仍会可见。这不是无痕去字，请查看成片。</p></div>
            <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">字幕会叠加到画面并保留原声音；每条字幕需按时间顺序排列，不重叠，视频最长 180 秒。本地处理暂不扣点。</div>
            <Button type="primary" size="large" block loading={submitting} disabled={uploading || estimating} onClick={createCaptions}>生成字幕视频</Button>
          </>}
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">我的处理任务</h2><button onClick={load} className="text-xs text-purple-600"><ReloadOutlined /> 刷新</button></div>
          {tasks.length === 0 ? <Empty description="暂无任务" /> : <div className="space-y-4">{tasks.map((task) => <div key={task.id} className="rounded-xl border border-gray-100 p-3"><div className="mb-2 flex justify-between text-xs text-gray-500"><span>{task.module === 'subtitleEdit' ? '字幕' : task.module === 'subtitleTranscribe' ? '语音识别' : '配音'} · {task.task_no}</span><span>{task.stage || task.status}</span></div>{!!task.result?.warnings?.length && <p className="mb-2 text-xs text-amber-600">{task.result.warnings.join('；')}</p>}{task.status === 'success' && task.module === 'subtitleTranscribe' && task.result?.subtitles ? <p className="text-xs text-gray-600">已识别 {task.result.subtitles.segments.length} 句，请应用草稿并检查文字与时间。</p> : task.status === 'success' && task.result?.videos?.[0]?.url ? <video controls className="w-full rounded-lg bg-black" src={withBase(task.result.videos[0].url)} /> : ['pending', 'running'].includes(task.status) ? <div className="py-5 text-center"><Spin /></div> : <p className="text-xs text-red-500">{task.error || '任务未完成'}</p>}{task.status === 'pending' && <Button className="mt-2" size="small" onClick={async () => { try { await api.cancelTask({ id: task.id }); load() } catch {} }}>取消排队</Button>}{(task.status === 'failed' || (task.status === 'reconciling' && task.module !== 'subtitleTranscribe')) && <Button className="mt-2" size="small" onClick={async () => { try { await api.retryTask({ id: task.id }); load() } catch {} }}>重新尝试</Button>}{task.module === 'subtitleTranscribe' && task.status === 'success' && task.result?.subtitles && <Popconfirm title="应用后会替换当前字幕草稿，继续吗？" onConfirm={() => { setWorkMode('captions'); setVideoUrl(task.params.videoUrl); setSegments(task.result.subtitles.segments); setSubtitleText(task.result.subtitles.text); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Button className="mt-2" size="small">应用识别草稿</Button></Popconfirm>}{task.module === 'subtitleEdit' && task.status === 'success' && task.params?.segments && <Button className="mt-2" size="small" onClick={() => { setWorkMode('captions'); setVideoUrl(task.params.videoUrl); setSegments(task.params.segments); setSubtitleStyle(task.params.style || 'pure'); setCoverMode(task.params.coverMode || 'none'); setSubtitleText(task.params.segments.map((item: SubtitleSegment) => item.text).join('')); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>再次校对</Button>}</div>)}</div>}</div>
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
