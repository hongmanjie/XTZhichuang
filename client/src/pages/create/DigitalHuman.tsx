import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Empty, Input, message, Modal, Popconfirm, Select, Spin, Tooltip } from 'antd'
import { InfoCircleOutlined, PictureOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { api } from '../../api/request'
import { withBase } from '../../utils/base'
import { estimateSpeech, humanTaskView } from '../../utils/humanTask'

type Voice = { id: number; name: string; label?: string; gender?: 'female' | 'male'; isDefault?: boolean; system?: boolean }
type Material = { id: number; name: string; url: string; category?: string; canManage?: boolean }
type Scene = { key: string; name: string }
type Task = { id: number; task_no: string; status: string; stage?: string; error?: string; result?: any; params?: any }
type DraftResult = { content: string }

const TONE_DOT: Record<string, string> = {
  run: 'bg-amber-400',
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  fail: 'bg-rose-500',
  idle: 'bg-[#5b5280]',
}

function ImagePicker({ open, title, images, value, onPick, onClose, onUpload, uploading, hasMore, loadingMore, onLoadMore, onDelete, deletingId }: {
  open: boolean; title: string; images: Material[]; value?: string
  onPick: (url: string) => void; onClose: () => void; onUpload: (file?: File) => void; uploading: boolean
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void
  onDelete: (image: Material) => Promise<void>; deletingId: number | null
}) {
  return (
    <Modal title={title} open={open} onCancel={onClose} footer={null} width={760} destroyOnHidden={false}>
      <div className="mb-3 flex items-center gap-3 text-xs text-gray-500">
        <span>已加载 {images.length} 张，点缩略图直接选用</span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#554477] px-3 py-1 hover:border-purple-400">
          <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading}
            onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = '' }} />
          {uploading ? '上传中…' : '上传新图片'}
        </label>
      </div>
      {images.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-gray-500">还没有图片，点右上角上传</span>} />
        : (
          <div className="grid max-h-[420px] grid-cols-4 gap-3 overflow-y-auto pr-1">
            {images.map((image) => (
              <div key={image.id} className={`overflow-hidden rounded-lg border text-left ${value === image.url ? 'border-purple-400' : 'border-[#2a2140] hover:border-[#554477]'}`}>
                <button type="button" className="block w-full text-left" onClick={() => { onPick(image.url); onClose() }}>
                  <img src={withBase(image.url)} alt={image.name} className="h-28 w-full bg-[#0d0918] object-cover" />
                  <div className="truncate px-2 py-1.5 text-[11px] text-[#9d8fd0]">{image.name}</div>
                </button>
                {image.canManage && <Popconfirm title="删除这张图片？" description="已生成的作品不受影响。" okText="删除" cancelText="取消" okButtonProps={{ danger: true, loading: deletingId === image.id }} onConfirm={() => onDelete(image)}>
                  <Button type="text" size="small" danger className="!ml-1">删除</Button>
                </Popconfirm>}
              </div>
            ))}
          </div>
        )}
      {hasMore && <Button className="mt-3 w-full" loading={loadingMore} onClick={onLoadMore}>加载更多历史图片</Button>}
      <p className="mt-3 text-xs text-gray-500">可前往 <Link to="/asset-library" onClick={onClose}>资产库</Link> 管理或删除图片。</p>
    </Modal>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip title={children} placement="top">
      <InfoCircleOutlined className="cursor-help text-xs text-[#6f6592]" />
    </Tooltip>
  )
}

export default function DigitalHuman() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [images, setImages] = useState<Material[]>([])
  const [imagePage, setImagePage] = useState(1)
  const [imageTotal, setImageTotal] = useState(0)
  const [loadingImages, setLoadingImages] = useState(false)
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [firstFrame, setFirstFrame] = useState<string>()
  const [voiceId, setVoiceId] = useState<number>()
  const [sceneKey, setSceneKey] = useState<string>()
  const [humanName, setHumanName] = useState('')
  const [script, setScript] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftTopic, setDraftTopic] = useState('')
  const [draftDetails, setDraftDetails] = useState('')
  const [draftSeconds, setDraftSeconds] = useState(15)
  const [draftText, setDraftText] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [subtitle, setSubtitle] = useState(true)
  const [lipSync, setLipSync] = useState(false)
  const [lipSyncAvailable, setLipSyncAvailable] = useState<boolean | null>(null)
  const [resolution, setResolution] = useState('540P')
  const [uploading, setUploading] = useState<null | 'person' | 'product'>(null)
  const [productImage, setProductImage] = useState<string>()
  const [productDesc, setProductDesc] = useState('')
  const [picker, setPicker] = useState<null | 'person' | 'product'>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showDetail, setShowDetail] = useState<number | null>(null)

  const loadBase = useCallback(() => {
    api.voiceProfiles().then((data: any) => {
      const list: Voice[] = data || []
      setVoices(list)
      // 未手动选择时默认用女声·治愈博主，男主播可在下拉里切活力讲师
      setVoiceId((prev) => prev ?? list.find((voice) => voice.system && voice.isDefault && voice.gender === 'female')?.id)
    }).catch(() => {})
    api.materials({ type: 'image', pageNum: 1, pageSize: 100 }).then((data: any) => { setImages(data.list || []); setImageTotal(Number(data.total) || 0); setImagePage(1) }).catch(() => {})
    api.digitalHumanScenes().then((data: any) => setScenes(data || [])).catch(() => {})
  }, [])

  const loadTasks = useCallback(() => {
    api.tasks({ module: 'human', pageSize: 24 }).then((data: any) => setTasks(data.list || [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadBase()
    loadTasks()
    const timer = setInterval(loadTasks, 6000)
    return () => clearInterval(timer)
  }, [loadBase, loadTasks])

  useEffect(() => {
    const check = () => api.voiceStatus().then((status) => setLipSyncAvailable(status.lipSyncAvailable)).catch(() => setLipSyncAvailable(null))
    check()
    const timer = setInterval(check, 30000)
    return () => clearInterval(timer)
  }, [])

  const estimate = useMemo(() => estimateSpeech(script), [script])
  const points = 70 * (voiceId ? Math.max(1, Math.ceil(estimate.chars / (resolution === '720P' ? 18 : 35))) : 1)
  const latest = tasks[0]
  const history = tasks.slice(1)

  const loadMoreImages = async () => {
    if (loadingImages || images.length >= imageTotal) return
    setLoadingImages(true)
    try {
      const next = imagePage + 1
      const data: any = await api.materials({ type: 'image', pageNum: next, pageSize: 100 })
      setImages((items) => {
        const ids = new Set(items.map((item) => item.id))
        return [...items, ...(data.list || []).filter((item: Material) => !ids.has(item.id))]
      })
      setImageTotal(Number(data.total) || 0)
      setImagePage(next)
    } catch {} finally { setLoadingImages(false) }
  }

  const deleteImage = async (image: Material) => {
    setDeletingImageId(image.id)
    try {
      const result: any = await api.deleteMaterials({ ids: [image.id] })
      if (!result?.deleted) { message.warning('没有删除这张图片的权限'); return }
      setImages((items) => items.filter((item) => item.id !== image.id))
      setImageTotal((total) => Math.max(0, total - 1))
      setFirstFrame((current) => current === image.url ? undefined : current)
      setProductImage((current) => current === image.url ? undefined : current)
      loadBase() // Refresh page offsets after deletion; later pages may have shifted.
      message.success('图片已删除')
    } catch {} finally { setDeletingImageId(null) }
  }

  const uploadImage = async (file: File | undefined, category: '人物形象' | '商品图') => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message.warning('请上传 JPG、PNG 或 WebP 图片')
    if (file.size > 10 * 1024 * 1024) return message.warning('图片不能超过 10 MB')
    setUploading(category === '人物形象' ? 'person' : 'product')
    try {
      const form = new FormData()
      form.append('file', file)
      // 打分类，人物图和商品图分开，避免和截图、对比图混在一起
      form.append('category', category)
      const saved: any = await api.uploadMaterial(form)
      if (category === '人物形象') setFirstFrame(saved.url)
      else setProductImage(saved.url)
      loadBase()
      message.success(category === '人物形象' ? '人物图片已上传' : '商品图片已上传')
    } catch {} finally { setUploading(null) }
  }

  const writeDraft = async () => {
    if (!draftTopic.trim()) return message.warning('请填写主题或商品名称')
    setDrafting(true)
    try {
      const result = await api.createHumanDraft({ topic: draftTopic.trim(), details: draftDetails.trim(), seconds: draftSeconds }) as DraftResult
      setDraftText(result.content)
      if (result.content.length > 200) message.warning('生成文案超过 200 字，请先删减')
    } catch {} finally { setDrafting(false) }
  }

  const useDraft = () => {
    if (!draftText.trim()) return message.warning('请先生成或填写口播文案')
    if (draftText.length > 200) return message.warning('口播文案最多 200 字，请先删减')
    setScript(draftText.trim())
    setDraftOpen(false)
  }

  const submit = async () => {
    if (!script.trim()) return message.warning('请填写文案')
    if (estimate.chars > 35 && !voiceId) return message.warning('超过 35 字请先选择音色')
    if (estimate.chars > 18 && resolution === '720P' && !voiceId) return message.warning('720P 超过 18 字请先选择音色，系统会自动分段生成')
    setSubmitting(true)
    try {
      await api.createHuman({ text: script.trim(), firstFrame: firstFrame || null, productImage: productImage || null,
        productDesc: productDesc.trim(), voiceProfileId: voiceId || null,
        humanName: humanName.trim(), sceneKey: sceneKey || null, count: 1, resolution, subtitle: { enabled: subtitle, style: 'pure' }, lipSync })
      message.success('任务已加入队列')
      loadTasks()
    } catch {} finally { setSubmitting(false) }
  }

  const retry = async (id: number) => {
    try { await api.retryTask({ id }); loadTasks() } catch {}
  }

  const cancel = async (id: number) => {
    try { await api.cancelTask({ id }); loadTasks() } catch {}
  }

  // 弹窗里把同分类的排前面，老素材仍然可选
  const personPickerImages = [...images].sort((a, b) => Number(b.category === '人物形象') - Number(a.category === '人物形象'))
  const productPickerImages = [...images].sort((a, b) => Number(b.category === '商品图') - Number(a.category === '商品图'))

  const voiceOptions = [
    { label: '女声', options: voices.filter((v) => v.gender === 'female').map((v) => ({ value: v.id, label: `${v.label || v.name}${v.isDefault ? '（默认）' : ''}` })) },
    { label: '男声', options: voices.filter((v) => v.gender === 'male').map((v) => ({ value: v.id, label: `${v.label || v.name}${v.isDefault ? '（默认）' : ''}` })) },
    { label: '我的音色', options: voices.filter((v) => !v.system).map((v) => ({ value: v.id, label: v.name })) },
  ].filter((group) => group.options.length > 0)

  const renderPreview = (task: Task, large: boolean) => {
    const view = humanTaskView(task)
    const video = task.result?.videos?.[0]
    if (['pending', 'running'].includes(task.status)) {
      return (
        <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-[#2a2140] bg-[#0d0918] ${large ? 'h-72' : 'h-28'}`}>
          <Spin size={large ? 'default' : 'small'} />
          <span className="text-xs text-[#9d8fd0]">{view.label}</span>
        </div>
      )
    }
    if (task.status === 'success' && video?.url) {
      return large
        ? <video controls preload="metadata" className="mx-auto block max-h-[380px] w-auto rounded-xl bg-black" src={withBase(video.url)} poster={video.cover ? withBase(video.cover) : undefined} />
        : <video className="h-28 w-full rounded-lg bg-black object-cover" src={withBase(video.url)} muted />
    }
    return (
      <div className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-[#2a2140] bg-[#0d0918] text-center ${large ? 'h-72' : 'h-28'}`}>
        <span className="text-xs text-[#9d8fd0]">{view.label}</span>
        {view.notes[0] && <span className="px-3 text-[11px] leading-4 text-[#7d74a3]">{view.notes[0].text}</span>}
      </div>
    )
  }

  const renderLatest = () => {
    if (!latest) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-[#8f85b3]">还没有作品，左边填好文案就能生成</span>} />
    const view = humanTaskView(latest)
    const video = latest.result?.videos?.[0]
    return (
      <div className="space-y-3">
        {renderPreview(latest, true)}
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[view.status]}`} />
          <span className="text-[#c0b6db]">{view.label}</span>
          {video?.duration ? <span className="text-[#6f6592]">{Number(video.duration).toFixed(1)} 秒</span> : null}
          {latest.status === 'failed' || latest.status === 'reconciling'
            ? <Button size="small" className="!ml-auto" onClick={() => retry(latest.id)}>重新生成</Button>
            : latest.status === 'pending' ? <Button size="small" className="!ml-auto" onClick={() => cancel(latest.id)}>取消</Button> : null}
        </div>
        {view.notes.map((note) => (
          <div key={note.text} className="flex items-start gap-2 rounded-lg bg-[#0d0918] px-3 py-2 text-xs leading-5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${note.tone === 'ok' ? 'bg-emerald-400' : note.tone === 'error' ? 'bg-rose-500' : 'bg-amber-400'}`} />
            <span className="text-[#c0b6db]">{note.text}</span>
            {note.action === 'subtitle' && <Link className="ml-auto shrink-0 text-purple-300" to="/voice" state={{ videoUrl: video?.url, text: latest.params?.text || '' }}>去处理</Link>}
            {note.action === 'shorten' && <button className="ml-auto shrink-0 text-purple-300" onClick={() => setScript(latest.params?.text || '')}>用这段文案改</button>}
          </div>
        ))}
        {view.detail && (
          <div className="text-xs">
            <button className="text-[#6f6592] hover:text-[#c0b6db]" onClick={() => setShowDetail(showDetail === latest.id ? null : latest.id)}>
              {showDetail === latest.id ? '收起详情' : '详情'}
            </button>
            {showDetail === latest.id && <p className="mt-2 rounded-lg bg-[#0d0918] p-3 leading-5 text-[#7d74a3]">{view.detail}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="-m-6 min-h-[calc(100vh-3.5rem)] bg-[#0A0714] px-6 pb-16 pt-10 text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-center text-3xl font-bold">数字人视频</h1>
        <p className="mt-3 text-center text-sm text-[#a69bc9]">选一张人物图或描述形象，写下要念的话，挑个声音就能生成</p>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* ---------- 左：创作 ---------- */}
          <section className="rounded-2xl border border-[#302646] bg-[#140e22] p-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e1f5]">人物形象</span>
              <span className="text-xs text-[#6f6592]">可选</span>
              <Hint>图片只作为首帧参考，生成的人物长相和动作会和图片有差异；不选则由描述自动生成。</Hint>
            </div>
            <div className="mt-4 flex gap-4">
              <button type="button" onClick={() => setPicker('person')}
                className="relative flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#554477] bg-[#0d0918] hover:border-purple-400">
                {firstFrame
                  ? <img src={withBase(firstFrame)} alt="人物图片" className="h-full w-full object-cover" />
                  : <span className="text-center text-[11px] leading-4 text-[#998dbb]"><PictureOutlined /><br />点此选择</span>}
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Button size="small" onClick={() => setPicker('person')}>选择历史图片</Button>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#554477] px-2.5 py-1 text-xs text-[#c0b6db] hover:border-purple-400">
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading === 'person'}
                      onChange={(event) => { uploadImage(event.target.files?.[0], '人物形象'); event.target.value = '' }} />
                    {uploading === 'person' ? '上传中…' : '上传'}
                  </label>
                  {firstFrame && <button className="text-xs text-[#6f6592] hover:text-white" onClick={() => setFirstFrame(undefined)}>移除</button>}
                </div>
                <Input maxLength={80} value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="形象描述，例如：亲切的女主播，穿米色上衣" />
                <Select className="w-full" placeholder="场景（可选）" allowClear value={sceneKey} onChange={setSceneKey}
                  options={scenes.map((scene) => ({ value: scene.key, label: scene.name }))} />
              </div>
            </div>

            <div className="mt-7 flex items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e1f5]">商品形象</span>
              <span className="text-xs text-[#6f6592]">可选</span>
              <Hint>商品图会与人物画面组成首帧供视频模型参考。未选人物图片时会先生成一张人物画面，成片中的商品细节仍可能变化。</Hint>
            </div>
            <div className="mt-4 flex gap-4">
              <button type="button" onClick={() => setPicker('product')}
                className="relative flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#554477] bg-[#0d0918] hover:border-purple-400">
                {productImage
                  ? <img src={withBase(productImage)} alt="商品图片" className="h-full w-full object-cover" />
                  : <span className="text-center text-[11px] leading-4 text-[#998dbb]"><PictureOutlined /><br />点此选择</span>}
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Button size="small" onClick={() => setPicker('product')}>选择历史图片</Button>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#554477] px-2.5 py-1 text-xs text-[#c0b6db] hover:border-purple-400">
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={uploading === 'product'}
                      onChange={(event) => { uploadImage(event.target.files?.[0], '商品图'); event.target.value = '' }} />
                    {uploading === 'product' ? '上传中…' : '上传'}
                  </label>
                  {productImage && <button className="text-xs text-[#6f6592] hover:text-white" onClick={() => setProductImage(undefined)}>移除</button>}
                </div>
                <Input maxLength={120} value={productDesc} onChange={(event) => setProductDesc(event.target.value)} placeholder="商品描述，例如：白色陶瓷马克杯，350ml，哑光釉面" />
              </div>
            </div>

            <div className="mt-7 flex items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e1f5]">口播文案</span>
              <Hint>系统按实际语音时长自动分段，最长 200 字；AI 写的稿子请逐句核对商品信息。</Hint>
              <Button size="small" className="!ml-auto" onClick={() => setDraftOpen(true)}>AI 帮我写</Button>
            </div>
            <Input.TextArea className="!mt-3" rows={5} maxLength={200} value={script} onChange={(event) => setScript(event.target.value)}
              placeholder="例如：大家好，今天给大家分享一只白色陶瓷杯，容量三百五十毫升，做工细腻。" />
            <div className="mt-2 flex items-center gap-3 text-xs text-[#6f6592]">
              <span>{estimate.chars}/200 字</span>
              <span>预计口播 {estimate.seconds < 1 ? '不到 1' : estimate.seconds.toFixed(1)} 秒</span>
              <span className="ml-auto">预留 {points} 点</span>
            </div>

            <div className="mt-7 flex items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e1f5]">声音与字幕</span>
              <Hint>音色由你选择，系统不会自动替换。清空音色则不做配音，保留模型原声。</Hint>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Select className="!w-56" placeholder="选择音色" allowClear value={voiceId}
                onChange={(value) => { setVoiceId(value); if (!value) setLipSync(false) }} options={voiceOptions} />
              <Checkbox checked={subtitle} onChange={(event) => setSubtitle(event.target.checked)}>加字幕</Checkbox>
              <Checkbox checked={lipSync} disabled={!voiceId || (lipSyncAvailable === false && !lipSync)}
                onChange={(event) => setLipSync(event.target.checked)}>同步口型</Checkbox>
              <Link to="/voice" className="text-xs text-purple-300">管理音色</Link>
            </div>
            <p className="mt-2 text-xs leading-5 text-[#6f6592]">
              {lipSyncAvailable === false ? '口型服务暂时不可用，可先关闭口型直接生成。' : '口型处理较慢，清晰正面的人物效果更好。'}
            </p>

            <div className="mt-7 flex items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e1f5]">输出</span>
            </div>
            <div className="mt-3 flex gap-2">
              {[['540P', '544 × 960'], ['720P', '736 × 1280']].map(([value, size]) => (
                <button key={value} onClick={() => setResolution(value)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${resolution === value ? 'border-purple-400 bg-[rgba(124,58,237,0.16)] text-white' : 'border-[#2a2140] bg-[#0d0918] text-[#9d8fd0] hover:border-[#554477]'}`}>
                  <div className="text-sm font-medium">{value}</div>
                  <div className="mt-0.5 text-[11px] opacity-70">{size}</div>
                </button>
              ))}
            </div>
            {resolution === '720P' && <p className="mt-2 text-xs leading-5 text-[#6f6592]">720P 会自动拆成更短的片段，耗时和预留点数可能增加。</p>}

            <div className="mt-7 flex items-center gap-3 border-t border-[#2a2140] pt-5">
              <div className="text-xs text-[#6f6592]">按实际生成段数结算，多余和失败点数退回</div>
              <Button type="primary" size="large" className="!ml-auto !px-8" loading={submitting}
                disabled={!!uploading || (lipSync && lipSyncAvailable === false)} onClick={submit}>生成视频</Button>
            </div>
          </section>

          {/* ---------- 右：结果 ---------- */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <div className="rounded-2xl border border-[#302646] bg-[#140e22] p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-semibold">最新作品</h2>
                <button className="ml-auto text-xs text-[#8f85b3] hover:text-white" onClick={loadTasks}><ReloadOutlined /> 刷新</button>
              </div>
              {renderLatest()}
            </div>

            <div className="rounded-2xl border border-[#302646] bg-[#140e22] p-5">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold">历史作品</h2>
                <span className="text-xs text-[#6f6592]">{history.length} 条</span>
              </div>
              {history.length === 0
                ? <p className="py-6 text-center text-xs text-[#6f6592]">生成第一条后，这里会保留最近的作品</p>
                : (
                  <div className="grid max-h-[320px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                    {history.map((task) => {
                      const view = humanTaskView(task)
                      const video = task.result?.videos?.[0]
                      return (
                        <button key={task.id} onClick={() => { if (video?.url) window.open(withBase(video.url), '_blank') }}
                          className="group relative overflow-hidden rounded-lg border border-[#2a2140] bg-[#0d0918] text-left hover:border-[#554477]">
                          {video?.cover
                            ? <img src={withBase(video.cover)} alt="" className="h-24 w-full object-cover opacity-90 group-hover:opacity-100" />
                            : <div className="flex h-24 w-full items-center justify-center text-[11px] text-[#7d74a3]">{view.label}</div>}
                          <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-[#9d8fd0]">
                            <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[view.status]}`} />
                            <span className="truncate">{view.label}</span>
                            {video?.duration ? <span className="ml-auto shrink-0 text-[#6f6592]">{Number(video.duration).toFixed(0)}s</span> : null}
                          </div>
                          {view.notes[0] && view.notes[0].tone !== 'ok' && <div className="truncate px-2 pb-1.5 text-[10px] text-amber-300" title={view.notes[0].text}>{view.notes[0].text}</div>}
                        </button>
                      )
                    })}
                  </div>
                )}
            </div>
          </aside>
        </div>
      </div>

      <Modal title="AI 帮我写口播" open={draftOpen} onCancel={() => setDraftOpen(false)} footer={null} destroyOnHidden={false}>
        <div className="space-y-4 pt-2">
          <div><label className="mb-1 block text-sm font-medium">主题或商品名称</label><Input maxLength={120} value={draftTopic} onChange={(event) => setDraftTopic(event.target.value)} placeholder="例如：白色陶瓷杯" /></div>
          <div><label className="mb-1 block text-sm font-medium">已确认的卖点和要求</label><Input.TextArea maxLength={600} rows={3} value={draftDetails} onChange={(event) => setDraftDetails(event.target.value)} placeholder="真实卖点、语气等，没有就留空" /></div>
          <div><label className="mb-1 block text-sm font-medium">期望时长</label><Select className="w-full" value={draftSeconds} onChange={setDraftSeconds} options={[10, 15, 30, 45].map((value) => ({ value, label: `约 ${value} 秒` }))} /></div>
          <Button loading={drafting} onClick={writeDraft}>生成口播稿</Button>
          {draftText && <><Input.TextArea rows={5} value={draftText} onChange={(event) => setDraftText(event.target.value)} /><p className="text-xs leading-5 text-gray-500">请核对商品事实，超过 200 字请删减。</p><Button type="primary" onClick={useDraft}>使用这段文案</Button></>}
        </div>
      </Modal>

      <ImagePicker open={picker === 'person'} title="选择人物图片" images={personPickerImages} value={firstFrame}
        onPick={setFirstFrame} onClose={() => setPicker(null)} uploading={uploading === 'person'}
        onUpload={(file) => uploadImage(file, '人物形象')} hasMore={images.length < imageTotal} loadingMore={loadingImages} onLoadMore={loadMoreImages} onDelete={deleteImage} deletingId={deletingImageId} />
      <ImagePicker open={picker === 'product'} title="选择商品图片" images={productPickerImages} value={productImage}
        onPick={setProductImage} onClose={() => setPicker(null)} uploading={uploading === 'product'}
        onUpload={(file) => uploadImage(file, '商品图')} hasMore={images.length < imageTotal} loadingMore={loadingImages} onLoadMore={loadMoreImages} onDelete={deleteImage} deletingId={deletingImageId} />
    </div>
  )
}
