import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Modal, Form, Select, Empty, Tag, Popconfirm, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ExportOutlined, ScissorOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function MixList() {
  const navigate = useNavigate()
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(12)
  const [createOpen, setCreateOpen] = useState(false)
  const [brands, setBrands] = useState<any[]>([])
  const [scripts, setScripts] = useState<any[]>([])
  const [form] = Form.useForm()

  useEffect(() => {
    api.brands().then(setBrands).catch(() => {})
    api.scripts({ pageSize: 50 }).then((d) => setScripts(d.list || [])).catch(() => {})
  }, [])

  useEffect(() => { fetchData() }, [searchValue, pageNum])

  const fetchData = async () => {
    try {
      const data = await api.mixList({ keyword: searchValue || undefined, pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    await api.saveMix({ name: values.name, brand_id: values.brand_id, script_id: values.script_id })
    message.success('创建成功')
    setCreateOpen(false)
    form.resetFields()
    fetchData()
  }

  const handleDelete = async (id: number) => {
    await api.deleteMix({ id })
    message.success('已删除')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            <ScissorOutlined className="mr-2 text-primary" />
            智能剪辑
          </h1>
          <p className="mt-1 text-xs text-gray-400">真实混剪和导出暂未接入，历史项目可查看。</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} disabled>
          新建剪辑项目
        </Button>
      </div>

      {/* 搜索 */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <Input.Search
          allowClear
          placeholder="搜索项目名称"
          onSearch={(v) => { setSearchValue(v); setPageNum(1) }}
          style={{ maxWidth: 360 }}
          enterButton
        />
      </div>

      {/* 项目列表 */}
      {list.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 shadow-sm">
          <Empty description="暂无剪辑项目">
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((item) => (
            <div key={item.id} className="group overflow-hidden rounded-2xl bg-white shadow-sm transition-all hover:shadow-md">
              {/* 封面 */}
              <div className="relative aspect-video bg-gray-100">
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">历史项目</div>
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/ai-mix/edit/${item.id}`)}>
                    查看记录
                  </Button>
                </div>
                <Tag
                  color={item.status === 'exported' ? 'green' : 'blue'}
                  className="!absolute right-2 top-2"
                >
                  历史记录
                </Tag>
              </div>
              {/* 信息 */}
              <div className="p-4">
                <h3 className="text-sm font-medium text-gray-800">{item.name}</h3>
                <p className="mt-1 text-xs text-gray-400">
                  时长 {item.duration ? `${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2, '0')}` : '--'} · 更新于 {item.updated_at}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/ai-mix/edit/${item.id}`)}>
                    查看记录
                  </Button>
                  <Button size="small" icon={<ExportOutlined />} disabled>导出暂不可用</Button>
                  <div className="flex-1" />
                  <Popconfirm title="确认删除该项目？" onConfirm={() => handleDelete(item.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建弹窗 */}
      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        title="新建剪辑项目"
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：双11口红促销混剪" maxLength={50} />
          </Form.Item>
          <Form.Item name="brand_id" label="关联品牌">
            <Select placeholder="选择品牌客户（可选）" allowClear options={brands.map((b) => ({ value: b.id, label: b.name }))} />
          </Form.Item>
          <Form.Item name="script_id" label="关联脚本">
            <Select placeholder="选择脚本文案（可选）" allowClear options={scripts.map((s) => ({ value: s.id, label: s.title }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
