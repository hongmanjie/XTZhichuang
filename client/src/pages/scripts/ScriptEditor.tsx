import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Input, Card, Tabs, Tag, Space, Table, message, Spin, Empty, Modal, Form, InputNumber, Tooltip, Row, Col } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, RobotOutlined, CopyOutlined, ThunderboltOutlined, SplitCellsOutlined, EditOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

const { TextArea } = Input

export default function ScriptEditor() {
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const [script, setScript] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [activeTab, setActiveTab] = useState(tab || 'write')
  const [saving, setSaving] = useState(false)
  const [subitems, setSubitems] = useState<any[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [editForm] = Form.useForm()

  useEffect(() => {
    if (id) {
      api.scriptDetail(+id).then((data) => {
        setScript(data)
        setTitle(data.title)
        setContent(data.content || '')
      }).catch(() => message.error('脚本不存在'))
      fetchSubitems()
    }
  }, [id])

  const fetchSubitems = async () => {
    if (!id) return
    setSubLoading(true)
    try {
      const d: any = await api.subitems(+id)
      setSubitems(d.list || [])
    } catch {
      /* ignore */
    }
    setSubLoading(false)
  }

  const handleSave = async () => {
    if (!title.trim()) return message.warning('请输入标题')
    setSaving(true)
    try {
      await api.saveScript({ id: id ? +id : undefined, title, content, status: 'published' })
      message.success('保存成功')
    } catch {
    } finally {
      setSaving(false)
    }
  }

  const handleAiPolish = async () => {
    if (!content.trim()) return message.warning('请先输入脚本内容')
    if (!aiInput.trim()) return message.warning('请输入润色要求')
    setAiLoading(true)
    try {
      const data = await api.scriptPolish({ content, requirement: aiInput })
      setAiResult(data.content)
      message.success(data.engine === 'real' ? 'AI润色完成' : 'AI润色完成（模拟引擎）')
    } catch {
    } finally {
      setAiLoading(false)
    }
  }

  const handleGenerateStoryboard = async () => {
    if (!id) return
    setGenLoading(true)
    try {
      await api.scriptGenerate({ scriptId: +id, productName: script?.product_name, requirement: content })
      message.success('AI 分镜生成完成')
      fetchSubitems()
      setActiveTab('storyboard')
    } catch {
      /* ignore */
    }
    setGenLoading(false)
  }

  const handleSplit = async (item: any) => {
    try {
      await api.subitemSplit({ id: item.id })
      message.success('拆分完成')
      fetchSubitems()
    } catch {
      /* ignore */
    }
  }

  const handleEditSave = async () => {
    const values = await editForm.validateFields()
    try {
      await api.subitemEdit({ id: editItem.id, ...values })
      message.success('已保存')
      setEditItem(null)
      fetchSubitems()
    } catch {
      /* ignore */
    }
  }

  const totalDuration = subitems.reduce((s, i) => s + (i.duration || 0), 0)

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between rounded-xl bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/my-scripts')}>返回</Button>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            variant="borderless"
            className="!w-80 !text-lg !font-semibold"
            placeholder="脚本标题"
          />
          {script && <Tag color="purple">{script.status === 'published' ? '已发布' : '草稿'}</Tag>}
        </div>
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(content); message.success('已复制') }}>复制文案</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存</Button>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'write',
            label: '文案编辑',
            children: (
              <Card className="!border-0 shadow-sm">
                <TextArea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={22}
                  placeholder="在这里撰写口播文案，或使用「AI创作」标签页智能生成..."
                  className="!text-sm !leading-relaxed"
                />
                <div className="mt-2 text-right text-xs text-gray-400">共 {content.length} 字</div>
              </Card>
            ),
          },
          {
            key: 'storyboard',
            label: `分镜结构 (${subitems.length})`,
            children: (
              <Card
                className="!border-0 shadow-sm"
                extra={
                  <Space>
                    <span className="text-xs text-gray-400">总时长 {totalDuration.toFixed(1)}s</span>
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={genLoading} onClick={handleGenerateStoryboard}>
                      AI 生成分镜
                    </Button>
                  </Space>
                }
              >
                <Spin spinning={subLoading}>
                  <Table
                    rowKey="id"
                    dataSource={subitems}
                    pagination={false}
                    size="small"
                    locale={{ emptyText: <Empty description="暂无分镜，点击「AI 生成分镜」一键创建" className="py-12" /> }}
                    columns={[
                      { title: '#', dataIndex: 'scene_no', width: 48, render: (n: number) => <Tag>{n}</Tag> },
                      { title: '画面描述', dataIndex: 'scene_desc', ellipsis: true },
                      { title: '台词/口播', dataIndex: 'line', ellipsis: true },
                      { title: '时长', dataIndex: 'duration', width: 70, render: (d: number) => `${d}s` },
                      { title: '备注', dataIndex: 'remark', width: 100, ellipsis: true, render: (r: string) => r || '-' },
                      {
                        title: '操作',
                        width: 120,
                        render: (_: any, r: any) => (
                          <Space size={4}>
                            <Tooltip title="编辑">
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditItem(r)
                                  editForm.setFieldsValue({ sceneDesc: r.scene_desc, line: r.line, duration: r.duration, remark: r.remark })
                                }}
                              />
                            </Tooltip>
                            <Tooltip title="拆分台词">
                              <Button type="text" size="small" icon={<SplitCellsOutlined />} onClick={() => handleSplit(r)} />
                            </Tooltip>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Spin>
                <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-600">
                  💡 分镜结构支持 AI 自动生成、单句拆分、结构调整，生成的分镜可直接用于智能剪辑配音轨。
                </div>
              </Card>
            ),
          },
          {
            key: 'ai',
            label: 'AI创作',
            children: (
              <Row gutter={16}>
                <Col span={12}>
                  <Card title="AI 润色优化" className="!border-0 shadow-sm">
                    <TextArea
                      rows={5}
                      placeholder="输入润色要求，例如：让开头更有冲击力，增加促销紧迫感"
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                    />
                    <Button type="primary" block className="mt-3" icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiPolish}>
                      开始润色
                    </Button>
                    {aiResult && (
                      <div className="mt-3 rounded-lg bg-gray-50 p-3">
                        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                          {aiResult}
                        </div>
                        <Button size="small" type="link" className="!px-0" onClick={() => { setContent(aiResult); message.success('已应用到正文') }}>
                          应用到正文
                        </Button>
                      </div>
                    )}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title="AI 生成分镜" className="!border-0 shadow-sm">
                    <p className="text-sm text-gray-500">根据文案自动拆解为分镜结构，包含画面描述、台词、时长。</p>
                    <Button type="primary" block size="large" className="mt-4" icon={<ThunderboltOutlined />} loading={genLoading} onClick={handleGenerateStoryboard}>
                      一键生成分镜
                    </Button>
                    <div className="mt-4 rounded-lg bg-purple-50 p-3 text-xs text-purple-600">
                      <p className="font-medium">生成规则</p>
                      <p className="mt-1">黄金3秒钩子 → 卖点讲解 → 场景演示 → 效果对比 → 促销转化</p>
                    </div>
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />

      {/* 编辑分镜弹窗 */}
      <Modal
        title={`编辑分镜 #${editItem?.scene_no || ''}`}
        open={!!editItem}
        onCancel={() => setEditItem(null)}
        onOk={handleEditSave}
      >
        <Form form={editForm} layout="vertical" className="mt-4">
          <Form.Item name="sceneDesc" label="画面描述">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="line" label="台词/口播">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="duration" label="时长（秒）">
            <InputNumber min={1} max={60} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
