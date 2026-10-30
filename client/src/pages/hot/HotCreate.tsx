import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Button, Tabs, Tag, Dropdown, Empty, Modal, message } from 'antd'
import {
  SearchOutlined, FireOutlined, LikeOutlined, MessageOutlined,
  ShareAltOutlined, PlayCircleOutlined, LinkOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { api } from '../../api/request'

const PLATFORM_MAP: Record<string, { name: string; color: string }> = {
  douyin: { name: '抖音', color: '#000000' },
  kuaishou: { name: '快手', color: '#FF4906' },
  bilibili: { name: 'B站', color: '#FB7299' },
}

export default function HotCreate() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [platform, setPlatform] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [sort, setSort] = useState('likes')
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(12)
  const [categories, setCategories] = useState<any[]>([])
  const [platforms, setPlatforms] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [parseModal, setParseModal] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseResult, setParseResult] = useState<any>(null)

  useEffect(() => {
    api.hotCategories().then(setCategories).catch(() => {})
    api.hotPlatforms().then(setPlatforms).catch(() => {})
  }, [])

  useEffect(() => {
    fetchData()
  }, [platform, category, sort, searchValue, pageNum])

  const fetchData = async () => {
    try {
      const data = await api.hotList({ keyword: searchValue || undefined, platform: platform || undefined, category: category || undefined, sort, pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  const handleSearch = () => {
    setSearchValue(keyword)
    setPageNum(1)
  }

  const handleParse = async () => {
    if (!shareUrl.trim()) return message.warning('请输入视频分享链接')
    setParsing(true)
    try {
      const data = await api.parseShareUrl({ url: shareUrl.trim() })
      setParseResult(data)
      message.success('解析成功')
    } catch {} finally {
      setParsing(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            <FireOutlined className="mr-2 text-orange-500" />
            爆款创作
          </h1>
          <p className="mt-1 text-xs text-gray-400">发现全网热门带货视频，一键解析复刻同款</p>
        </div>
        <Button type="primary" icon={<LinkOutlined />} onClick={() => setParseModal(true)}>
          解析视频链接
        </Button>
      </div>

      {/* 工具栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Input
          allowClear
          placeholder="搜索爆款视频标题（ES全文检索）"
          prefix={<SearchOutlined className="text-gray-300" />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 320 }}
        />
        <Button type="primary" onClick={handleSearch}>搜索</Button>

        {/* 平台筛选 */}
        <Tabs
          size="small"
          activeKey={platform || 'all'}
          onChange={(k) => { setPlatform(k === 'all' ? '' : k); setPageNum(1) }}
          items={[
            { key: 'all', label: '全部' },
            ...platforms.map((p) => ({ key: p.key, label: p.name })),
          ]}
        />

        <div className="flex-1" />

        {/* 分类 */}
        <Dropdown
          menu={{
            items: [
              { key: '', label: '全部分类' },
              ...categories.map((c) => ({ key: c.category, label: `${c.category} (${c.count})` })),
            ],
            onClick: ({ key }) => { setCategory(key); setPageNum(1) },
          }}
        >
          <Button size="small">{category || '全部分类'}</Button>
        </Dropdown>

        {/* 排序 */}
        <Dropdown
          menu={{
            items: [
              { key: 'likes', label: '最多点赞' },
              { key: 'comments', label: '最多评论' },
              { key: 'shares', label: '最多分享' },
              { key: 'newest', label: '最新发布' },
            ],
            onClick: ({ key }) => { setSort(key); setPageNum(1) },
          }}
        >
          <Button size="small">
            {sort === 'likes' ? '最多点赞' : sort === 'comments' ? '最多评论' : sort === 'shares' ? '最多分享' : '最新发布'}
          </Button>
        </Dropdown>
      </div>

      {/* 视频网格 */}
      {list.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 shadow-sm"><Empty description="暂无爆款视频" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {list.map((item) => (
            <div
              key={item.id}
              className="group cursor-pointer overflow-hidden rounded-2xl bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
              onClick={() => setDetail(item)}
            >
              {/* 封面 */}
              <div className="relative aspect-[9/16] max-h-72 overflow-hidden bg-gray-100">
                <img src={item.cover} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                {/* 播放按钮 */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <PlayCircleOutlined className="text-5xl text-white/90 drop-shadow-lg" />
                </div>
                {/* 平台标签 */}
                <span
                  className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] text-white"
                  style={{ background: PLATFORM_MAP[item.platform]?.color || '#666' }}
                >
                  {PLATFORM_MAP[item.platform]?.name || item.platform}
                </span>
                {/* 时长 */}
                <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {item.duration}
                </span>
              </div>
              {/* 信息 */}
              <div className="p-3">
                <p className="line-clamp-2 h-9 text-xs leading-snug text-gray-700">{item.title}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
                  <span>{item.author}</span>
                  <span className="flex items-center gap-2">
                    <span><LikeOutlined /> {(item.likes / 10000).toFixed(1)}w</span>
                    <span><MessageOutlined /> {(item.comments / 1000).toFixed(1)}k</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {total > pageSize && (
        <div className="mt-5 flex justify-center gap-2">
          <Button disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>上一页</Button>
          <span className="leading-8 text-sm text-gray-500">{pageNum} / {Math.ceil(total / pageSize)}</span>
          <Button disabled={pageNum >= Math.ceil(total / pageSize)} onClick={() => setPageNum(pageNum + 1)}>下一页</Button>
        </div>
      )}

      {/* 详情弹窗 */}
      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={[
          <Button key="replica" type="primary" icon={<ThunderboltOutlined />} onClick={() => {
            setDetail(null)
            navigate('/create/hit-replica')
          }}>
            去复刻
          </Button>,
          <Button key="close" onClick={() => setDetail(null)}>关闭</Button>,
        ]}
        width={560}
        title="爆款视频详情"
      >
        {detail && (
          <div className="flex gap-4">
            <video src={detail.video_url} controls className="w-64 rounded-lg" poster={detail.cover} />
            <div className="flex-1 space-y-2 text-sm">
              <p className="text-gray-700">{detail.title}</p>
              <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                <Tag>{PLATFORM_MAP[detail.platform]?.name}</Tag>
                <Tag>{detail.category}</Tag>
                <span>作者：{detail.author}</span>
              </div>
              <div className="flex gap-4 text-xs text-gray-500">
                <span><LikeOutlined /> {detail.likes}</span>
                <span><MessageOutlined /> {detail.comments}</span>
                <span><ShareAltOutlined /> {detail.shares}</span>
              </div>
              <p className="text-xs text-gray-400">发布时间：{detail.published_at}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* 解析弹窗 */}
      <Modal
        open={parseModal}
        onCancel={() => { setParseModal(false); setParseResult(null); setShareUrl('') }}
        footer={[
          <Button key="parse" type="primary" loading={parsing} onClick={handleParse}>
            开始解析
          </Button>,
          parseResult && (
            <Button key="replica" onClick={() => {
              setParseModal(false)
              navigate('/create/hit-replica')
            }}>
              去复刻
            </Button>
          ),
        ]}
        title="解析视频链接"
      >
        <div className="space-y-4 pt-2">
          <Input
            size="large"
            placeholder="粘贴抖音/快手/B站视频分享链接，如：https://v.douyin.com/xxxxx"
            value={shareUrl}
            onChange={(e) => setShareUrl(e.target.value)}
            onPressEnter={handleParse}
          />
          <p className="text-xs text-gray-400">支持抖音、快手、B站视频链接解析，解析后可一键复刻同款</p>
          {parseResult && (
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                ✓ 解析成功
              </div>
              <div className="mt-2 space-y-1 text-xs text-gray-500">
                <p>标题：{parseResult.title}</p>
                <p>作者：{parseResult.author}</p>
                <p>平台：{PLATFORM_MAP[parseResult.platform]?.name || parseResult.platform}</p>
                <p>时长：{parseResult.duration} · 点赞：{parseResult.likes}</p>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
