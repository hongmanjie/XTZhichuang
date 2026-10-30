import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Card, Tag, Empty, Modal, Form, Select, Popconfirm, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

const { TextArea } = Input

export default function MyScripts() {
  const navigate = useNavigate()
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(12)
  const [createOpen, setCreateOpen] = useState(false)
  const [brands, setBrands] = useState<any[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [form] = Form.useForm()
  const [aiForm, setAiForm] = useState({ product: '', requirement: '' })
  const [aiGenerating, setAiGenerating] = useState(false)

  useEffect(() => {
    api.brands().then(setBrands).catch(() => {})
  }, [])

  useEffect(() => { fetchData() }, [searchValue, pageNum])

  const fetchData = async () => {
    try {
      const data = await api.scripts({ keyword: searchValue || undefined, pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    const data = await api.saveScript({ title: values.title, product_name: values.product_name, brand_id: values.brand_id, content: values.content, category: values.category })
    message.success('创建成功')
    setCreateOpen(false)
    form.resetFields()
    fetchData()
    // 跳转编辑器
    const newList = await api.scripts({ pageNum: 1, pageSize: 1 })
    if (newList.list?.[0]) navigate(`/aiScript/${newList.list[0].id}/write`)
  }

  const handleAiCreate = async () => {
    if (!aiForm.product.trim()) return message.warning('请输入产品名称')
    setAiGenerating(true)
    try {
      // 调用 AI 口播脚本生成（ModelGate 优先，降级模板）
      const gen = await api.scriptDictate({ productName: aiForm.product, requirement: aiForm.requirement })
      const generated = gen.content
      const data = await api.saveScript({ title: `${aiForm.product}带货脚本`, product_name: aiForm.product, content: generated, category: 'AI生成', status: 'draft' })
      message.success('AI脚本生成成功')
      setAiOpen(false)
      fetchData()
      if (data?.id) navigate(`/aiScript/${data.id}/write`)
    } catch {} finally { setAiGenerating(false) }
  }

  const handleDelete = async (id: number) => {
    await api.deleteScripts({ ids: [id] })
    message.success('已删除')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            <FileTextOutlined className="mr-2 text-primary" />
            我的脚本
          </h1>
          <p className="mt-1 text-xs text-gray-400">品牌脚本项目管理，支持AI辅助创作</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<RobotOutlined />} onClick={() => setAiOpen(true)}>AI生成脚本</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建脚本</Button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <Input.Search
          allowClear
          placeholder="搜索脚本标题/内容"
          onSearch={(v) => { setSearchValue(v); setPageNum(1) }}
          style={{ maxWidth: 360 }}
          enterButton
        />
      </div>

      {/* 脚本列表 */}
      {list.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 shadow-sm">
          <Empty description="暂无脚本">
            <Button type="primary" onClick={() => setCreateOpen(true)}>创建第一个脚本</Button>
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((item) => (
            <Card
              key={item.id}
              className="!rounded-2xl transition-all hover:shadow-md"
              hoverable
              onClick={() => navigate(`/aiScript/${item.id}/write`)}
              actions={[
                <EditOutlined key="edit" onClick={(e) => { e.stopPropagation(); navigate(`/aiScript/${item.id}/write`) }} />,
                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(item.id)}>
                  <DeleteOutlined key="delete" className="text-red-400" onClick={(e) => e.stopPropagation()} />
                </Popconfirm>,
              ]}
            >
              <div className="mb-2 flex items-start justify-between">
                <h3 className="text-sm font-medium text-gray-800">{item.title}</h3>
                <Tag color={item.status === 'published' ? 'green' : 'default'} className="!text-[10px]">
                  {item.status === 'published' ? '已发布' : '草稿'}
                </Tag>
              </div>
              <p className="line-clamp-3 h-14 text-xs leading-relaxed text-gray-500">{item.content}</p>
              <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400">
                <span>{item.product_name} · {item.word_count}字 · {item.category}</span>
                <span>{item.owner_name}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        title="新建脚本"
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="title" label="脚本标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：双11口红促销口播" maxLength={50} />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="product_name" label="产品名称">
              <Input placeholder="产品名称" />
            </Form.Item>
            <Form.Item name="brand_id" label="关联品牌">
              <Select placeholder="选择品牌" allowClear options={brands.map((b) => ({ value: b.id, label: b.name }))} />
            </Form.Item>
          </div>
          <Form.Item name="category" label="脚本类型">
            <Select
              placeholder="选择类型"
              options={[
                { value: '口播脚本', label: '口播脚本' },
                { value: '测评脚本', label: '测评脚本' },
                { value: '剧情脚本', label: '剧情脚本' },
                { value: '分镜脚本', label: '分镜脚本' },
              ]}
            />
          </Form.Item>
          <Form.Item name="content" label="脚本内容">
            <TextArea placeholder="开始编写你的脚本..." autoSize={{ minRows: 5 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI生成弹窗 */}
      <Modal
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        onOk={handleAiCreate}
        confirmLoading={aiGenerating}
        title="AI生成脚本"
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">产品名称 *</label>
            <Input
              placeholder="例如：玻尿酸补水面膜"
              value={aiForm.product}
              onChange={(e) => setAiForm({ ...aiForm, product: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">创作要求</label>
            <TextArea
              placeholder="例如：突出补水功效，目标人群25-35岁女性，语气活泼"
              autoSize={{ minRows: 3 }}
              value={aiForm.requirement}
              onChange={(e) => setAiForm({ ...aiForm, requirement: e.target.value })}
            />
          </div>
          <p className="text-xs text-gray-400">AI将根据产品信息自动生成完整的带货口播脚本结构</p>
        </div>
      </Modal>
    </div>
  )
}
