import { useEffect, useState, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Input, Button, Tabs, Upload, message, Modal, Tag, Dropdown, Progress,
  Empty, Image, Tooltip, Space, Popconfirm,
} from 'antd'
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, FolderOpenOutlined,
  UploadOutlined, DownloadOutlined, EditOutlined, AppstoreOutlined,
  VideoCameraOutlined, PictureOutlined, CustomerServiceOutlined, FileTextOutlined,
  ReloadOutlined, SoundOutlined, PlayCircleOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/request'
import { ESStatusBadge } from '../../components/ESStatusBadge'

type MaterialType = 'image' | 'video' | 'audio' | 'all'

export default function AssetLibrary() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'materials' | 'scripts' | 'works' | 'music'>('materials')
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [type, setType] = useState<MaterialType>('all')
  const [source, setSource] = useState<'' | 'upload' | 'ai' | 'edit'>('')
  const [category, setCategory] = useState<string>('')
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [pageSize, setPageSize] = useState(24)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [preview, setPreview] = useState<any>(null)
  const [editModal, setEditModal] = useState<any>(null)
  const [editForm, setEditForm] = useState({ name: '', category: '' })
  const [uploading, setUploading] = useState(false)
  const [musicCategories, setMusicCategories] = useState<any[]>([])
  const [musicCategory, setMusicCategory] = useState<string>('')
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const pageSizeOptions = [24, 48, 96]

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'materials') {
        const data = await api.materials({
          keyword: searchValue || undefined,
          type: type === 'all' ? undefined : type,
          category: category || undefined,
          source: source || undefined,
          pageNum, pageSize,
        })
        setList(data.list || [])
        setTotal(data.total || 0)
      } else if (tab === 'scripts') {
        const data = await api.scripts({ keyword: searchValue || undefined, pageNum, pageSize: 12 })
        setList(data.list || [])
        setTotal(data.total || 0)
      } else if (tab === 'music') {
        const data = musicCategory
          ? await api.musicByCategory(musicCategory)
          : await api.musicList()
        setList(data.list || [])
        setTotal((data.list || []).length)
      } else {
        const data = await api.works({ keyword: searchValue || undefined, pageNum, pageSize })
        setList(data.list || [])
        setTotal(data.total || 0)
      }
    } catch {} finally {
      setLoading(false)
    }
  }, [tab, searchValue, type, source, category, pageNum, pageSize, musicCategory])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    api.materialCategories().then(setCategories).catch(() => {})
    api.assetStatistics().then(setStats).catch(() => {})
    api.musicCategories().then((d: any) => setMusicCategories(d.list || [])).catch(() => {})
  }, [])

  // 播放/暂停音乐
  const togglePlay = (item: any) => {
    if (playingId === item.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(item.url || '')
    audioRef.current = audio
    audio.play().catch(() => {})
    setPlayingId(item.id)
    audio.onended = () => setPlayingId(null)
  }

  const handleSearch = () => {
    setSearchValue(keyword)
    setPageNum(1)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', category || '未分类')
      await api.uploadMaterial(formData)
      message.success('上传成功')
      fetchData()
      api.assetStatistics().then(setStats).catch(() => {})
    } catch {} finally {
      setUploading(false)
    }
    return false
  }

  // 统一删除入口：按当前 Tab 调对应接口
  const deleteApi = () => {
    if (tab === 'materials') return api.deleteMaterials
    if (tab === 'scripts') return api.deleteScripts
    if (tab === 'works') return api.deleteWork
    return api.musicDelete
  }

  const handleDelete = async (ids: number[]) => {
    if (!ids.length) return
    const r: any = await deleteApi()({ ids })
    if (r?.denied) message.warning(`已删除${r.deleted}项，${r.denied}项无权限跳过`)
    else message.success(`已删除${r?.deleted ?? ids.length}项`)
    setSelected([])
    setPreview(null)
    fetchData()
    api.assetStatistics().then(setStats).catch(() => {})
  }

  const confirmDelete = (ids: number[], title = `确认删除选中的 ${ids.length} 项？删除后不可恢复`) =>
    Modal.confirm({ title: '删除确认', content: title, okText: '删除', okButtonProps: { danger: true }, onOk: () => handleDelete(ids) })

  // 卡片勾选（作品/素材共用）
  const toggleSelect = (id: number, e: ReactMouseEvent) => {
    e.stopPropagation()
    setSelected((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  const handleEdit = async () => {
    if (!editModal) return
    await api.updateMaterial({ id: editModal.id, ...editForm })
    message.success('已保存')
    setEditModal(null)
    fetchData()
  }

  const typeCounts = {
    image: stats?.imageCount || 0,
    video: stats?.videoCount || 0,
    audio: stats?.audioCount || 0,
  }

  const formatSize = (size: number) => {
    if (size < 1024) return size + 'B'
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + 'KB'
    return (size / 1024 / 1024).toFixed(1) + 'MB'
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* ============ 头部 ============ */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">资产库</h1>
          <p className="mt-1 text-xs text-gray-400">
            品牌素材统一管理 · 共 {stats?.total || 0} 个素材 · 已用 {formatSize(stats?.usedSize || 0)}
          </p>
        </div>
        <Space>
          <ESStatusBadge />
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="image/*,video/*,audio/*">
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
              上传素材
            </Button>
          </Upload>
        </Space>
      </div>

      {/* ============ Tab与工具栏 ============ */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <Tabs
          activeKey={tab}
          onChange={(k) => { setTab(k as any); setPageNum(1); setSelected([]) }}
          items={[
            { key: 'materials', label: <span><AppstoreOutlined /> 素材管理</span> },
            { key: 'scripts', label: <span><FileTextOutlined /> 我的脚本</span> },
            { key: 'works', label: <span><VideoCameraOutlined /> 作品管理</span> },
            { key: 'music', label: <span><SoundOutlined /> 音乐库</span> },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* 搜索框 */}
          <Input
            allowClear
            placeholder={tab === 'scripts' ? '搜索脚本标题/内容' : '搜索素材名称/标签（Elasticsearch全文检索）'}
            prefix={<SearchOutlined className="text-gray-300" />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 360 }}
          />
          <Button type="primary" onClick={handleSearch}>搜索</Button>

          {tab === 'materials' && (
            <>
              {/* 类型筛选 */}
              <div className="flex gap-1">
                {[
                  { key: 'all', label: '全部', icon: <AppstoreOutlined /> },
                  { key: 'image', label: `图片 ${typeCounts.image}`, icon: <PictureOutlined /> },
                  { key: 'video', label: `视频 ${typeCounts.video}`, icon: <VideoCameraOutlined /> },
                  { key: 'audio', label: `音频 ${typeCounts.audio}`, icon: <CustomerServiceOutlined /> },
                ].map((t) => (
                  <Button
                    key={t.key}
                    size="small"
                    type={type === t.key ? 'primary' : 'default'}
                    ghost={type !== t.key}
                    icon={t.icon}
                    onClick={() => { setType(t.key as MaterialType); setPageNum(1) }}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>

              {/* 分类筛选 */}
              <Dropdown
                menu={{
                  items: [
                    { key: '', label: '全部分类' },
                    ...categories.map((c) => ({ key: c.category, label: `${c.category} (${c.count})` })),
                  ],
                  onClick: ({ key }) => { setCategory(key); setPageNum(1) },
                }}
              >
                <Button size="small">
                  <FolderOpenOutlined /> {category || '全部分类'}
                </Button>
              </Dropdown>

              {/* 来源筛选 */}
              <div className="flex gap-1">
                {[
                  { key: '', label: '全部来源' },
                  { key: 'upload', label: '本地上传' },
                  { key: 'ai', label: 'AI生成' },
                  { key: 'edit', label: '本地剪辑' },
                ].map((s) => (
                  <Button
                    key={s.key}
                    size="small"
                    type={source === s.key ? 'primary' : 'default'}
                    ghost={source !== s.key}
                    onClick={() => { setSource(s.key as any); setPageNum(1) }}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </>
          )}

          {tab === 'music' && (
            <div className="flex flex-wrap gap-1">
              <Button
                size="small"
                type={!musicCategory ? 'primary' : 'default'}
                ghost={!!musicCategory}
                onClick={() => { setMusicCategory(''); setPageNum(1) }}
              >
                全部
              </Button>
              {musicCategories.map((c) => (
                <Button
                  key={c.key}
                  size="small"
                  type={musicCategory === c.key ? 'primary' : 'default'}
                  ghost={musicCategory !== c.key}
                  onClick={() => { setMusicCategory(c.key); setPageNum(1) }}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {/* 批量操作 */}
          {selected.length > 0 && tab !== 'music' && (
            <Space>
              <span className="text-xs text-gray-400">已选 {selected.length} 项</span>
              <Button size="small" onClick={() => setSelected([])}>取消选择</Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(selected)}>
                批量删除
              </Button>
            </Space>
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        </div>
      </div>

      {/* ============ 内容区 ============ */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        {loading ? (
          <div className="py-16 text-center"><Progress type="circle" percent={99} width={40} /></div>
        ) : list.length === 0 ? (
          <Empty description={searchValue ? `未找到与"${searchValue}"相关的${tab === 'materials' ? '素材' : tab === 'scripts' ? '脚本' : '作品'}` : '暂无数据'} />
        ) : tab === 'materials' ? (
          /* ---- 素材网格 ---- */
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {list.map((item) => (
              <div
                key={item.id}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-white transition-all hover:shadow-md ${
                  selected.includes(item.id) ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100'
                }`}
                onClick={() => setPreview(item)}
              >
                {/* 选择框 */}
                <div
                  className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border ${
                    selected.includes(item.id) ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white/80 opacity-0 group-hover:opacity-100'
                  }`}
                  onClick={(e) => toggleSelect(item.id, e)}
                >
                  {selected.includes(item.id) && '✓'}
                </div>

                {/* 单删按钮（hover 显示） */}
                <Popconfirm
                  title="删除该素材？"
                  description="删除后不可恢复"
                  okText="删除"
                  okButtonProps={{ danger: true, size: 'small' }}
                  cancelText="取消"
                  onConfirm={() => handleDelete([item.id])}
                >
                  <div
                    className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/50 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DeleteOutlined className="text-xs" />
                  </div>
                </Popconfirm>

                {/* 封面 */}
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-gray-50">
                  {item.type === 'image' ? (
                    <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : item.type === 'video' ? (
                    <div className="relative h-full w-full">
                      <video src={item.url} poster={item.cover || undefined} className="h-full w-full object-cover" muted preload={item.cover ? 'none' : 'metadata'} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50">
                          <VideoCameraOutlined className="text-white" />
                        </div>
                      </div>
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                        {item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '视频'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-orange-400">
                      <CustomerServiceOutlined className="text-3xl" />
                      <span className="mt-1 text-[10px]">音频</span>
                    </div>
                  )}
                </div>

                {/* 信息 */}
                <div className="p-2">
                  <p className="truncate text-xs text-gray-700" title={item.name}>{item.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">{formatSize(item.size)}</span>
                    {item.source === 'ai' && (
                      <span className="flex items-center gap-1">
                        {item.engine === 'real' && item.model && (
                          <Tag color="geekblue" className="!text-[9px] !px-1 !m-0" title={`真实模型输出：${item.model}`}>{item.model}</Tag>
                        )}
                        {item.engine === 'mock' && <Tag color="default" className="!text-[9px] !px-1 !m-0">模拟</Tag>}
                        <Tag color="purple" className="!text-[9px] !px-1">AI生成</Tag>
                      </span>
                    )}
                    {item.source === 'edit' && <Tag color="blue" className="!text-[9px] !px-1">本地剪辑</Tag>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'scripts' ? (
          /* ---- 脚本列表 ---- */
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {list.map((item) => (
              <div key={item.id} className="group rounded-xl border border-gray-100 p-4 hover:border-primary hover:shadow-sm">
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="cursor-pointer text-sm font-medium text-gray-800 hover:text-primary" onClick={() => navigate(`/aiScript/${item.id}`)}>{item.title}</h3>
                  <div className="flex items-center gap-1">
                    <Tag color={item.status === 'published' ? 'green' : 'default'} className="!text-[10px]">
                      {item.status === 'published' ? '已发布' : '草稿'}
                    </Tag>
                    {item.canManage !== false && (
                      <Popconfirm title="删除该脚本？" okText="删除" okButtonProps={{ danger: true, size: 'small' }} cancelText="取消" onConfirm={() => handleDelete([item.id])}>
                        <DeleteOutlined className="cursor-pointer text-xs text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" />
                      </Popconfirm>
                    )}
                  </div>
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-gray-500">{item.content}</p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400">
                  <span>{item.product_name} · {item.word_count}字</span>
                  <span>{item.owner_name}</span>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'music' ? (
          /* ---- 音乐库 ---- */
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {list.map((item) => (
              <div key={item.id} className="group flex items-center gap-3 rounded-xl border border-gray-100 p-3 hover:border-primary hover:shadow-sm">
                <div
                  className={`flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${
                    playingId === item.id ? 'bg-primary text-white' : 'bg-purple-50 text-primary hover:bg-primary hover:text-white'
                  }`}
                  onClick={() => togglePlay(item)}
                >
                  {playingId === item.id ? <SoundOutlined className="animate-pulse" /> : <PlayCircleOutlined />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{item.name}</p>
                  <p className="text-[10px] text-gray-400">
                    {item.artist || '兴图音乐库'} · {item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : '--:--'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Tag className="!mr-0 !text-[10px]">{item.category}</Tag>
                  {item.source === 'upload' && (
                    <>
                      <Tag color="blue" className="!mr-0 !text-[10px]">我的</Tag>
                      <Popconfirm title="删除该音乐？" okText="删除" okButtonProps={{ danger: true, size: 'small' }} cancelText="取消" onConfirm={() => handleDelete([item.id])}>
                        <DeleteOutlined className="cursor-pointer text-xs text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" />
                      </Popconfirm>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ---- 作品列表 ---- */
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {list.map((item) => (
              <div
                key={item.id}
                className={`group relative overflow-hidden rounded-xl border transition-all hover:shadow-sm ${
                  selected.includes(item.id) ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100'
                }`}
              >
                {/* 选择框 */}
                <div
                  className={`absolute left-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border ${
                    selected.includes(item.id) ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white/80 opacity-0 group-hover:opacity-100'
                  }`}
                  onClick={(e) => toggleSelect(item.id, e)}
                >
                  {selected.includes(item.id) && '✓'}
                </div>
                {/* 单删按钮 */}
                {item.canManage !== false && (
                  <Popconfirm title="删除该作品？" okText="删除" okButtonProps={{ danger: true, size: 'small' }} cancelText="取消" onConfirm={() => handleDelete([item.id])}>
                    <div className="absolute right-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-black/50 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100">
                      <DeleteOutlined className="text-xs" />
                    </div>
                  </Popconfirm>
                )}
                <div className="relative aspect-video bg-gray-50">
                  {item.type === 'image' ? (
                    <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <video src={item.url} poster={item.cover || undefined} className="h-full w-full object-cover" muted preload={item.cover ? 'none' : 'metadata'} />
                  )}
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    {item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : ''}
                  </span>
                </div>
                <div className="p-2">
                  <p className="truncate text-xs text-gray-700">{item.name}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">{item.created_at}</span>
                    {item.source_module && <Tag className="!mr-0 !text-[9px]" color="purple">{item.source_module}</Tag>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {total > pageSize && (
          <div className="mt-5 flex justify-center">
            <Button.Group>
              <Button disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>上一页</Button>
              {Array.from({ length: Math.min(5, Math.ceil(total / pageSize)) }, (_, i) => {
                const p = i + 1
                return (
                  <Button key={p} type={p === pageNum ? 'primary' : 'default'} onClick={() => setPageNum(p)}>
                    {p}
                  </Button>
                )
              })}
              <Button disabled={pageNum >= Math.ceil(total / pageSize)} onClick={() => setPageNum(pageNum + 1)}>下一页</Button>
            </Button.Group>
          </div>
        )}
      </div>

      {/* ============ 预览弹窗 ============ */}
      <Modal
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={[
          <Button key="del" danger icon={<DeleteOutlined />} onClick={() => confirmDelete([preview.id], `确认删除「${preview.name}」？删除后不可恢复`)}>
            删除
          </Button>,
          <Button key="edit" icon={<EditOutlined />} onClick={() => {
            setEditModal(preview)
            setEditForm({ name: preview.name, category: preview.category })
            setPreview(null)
          }}>
            编辑
          </Button>,
          <Button key="close" type="primary" onClick={() => setPreview(null)}>关闭</Button>,
        ]}
        width={720}
        title={preview?.name}
      >
        {preview && (
          <div className="flex gap-4">
            <div className="flex-1">
              {preview.type === 'image' ? (
                <img src={preview.url} alt="" className="w-full rounded-lg" />
              ) : (
                <video src={preview.url} poster={preview.cover || undefined} controls className="w-full rounded-lg" preload={preview.cover ? 'none' : 'metadata'} />
              )}
            </div>
            <div className="w-48 space-y-3 text-xs">
              <div><span className="text-gray-400">类型：</span>{preview.type === 'image' ? '图片' : preview.type === 'video' ? '视频' : '音频'}</div>
              <div><span className="text-gray-400">大小：</span>{formatSize(preview.size)}</div>
              <div><span className="text-gray-400">分类：</span>{preview.category}</div>
              <div><span className="text-gray-400">上传时间：</span>{preview.created_at}</div>
              {preview.tags && (() => {
                let tags: string[] = []
                try { const t = JSON.parse(preview.tags); tags = Array.isArray(t) ? t : [] } catch { tags = [] }
                if (!tags.length) return null
                return (
                  <div>
                    <span className="text-gray-400">标签：</span>
                    {tags.map((t: string, i: number) => (
                      <Tag key={i} className="!mb-1 !text-[10px]">{t}</Tag>
                    ))}
                  </div>
                )
              })()}
              <Button block size="small" icon={<DownloadOutlined />} href={preview.url} target="_blank">
                下载原文件
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ============ 编辑弹窗 ============ */}
      <Modal
        open={!!editModal}
        onCancel={() => setEditModal(null)}
        onOk={handleEdit}
        title="编辑素材"
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">名称</label>
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">分类</label>
            <Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
