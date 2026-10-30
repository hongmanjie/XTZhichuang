import { useState, useEffect } from 'react'
import { Card, Row, Col, Button, Form, Input, Select, Tabs, List, Tag, Empty, message } from 'antd'
import { ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

const HOOK_TYPES = [
  { key: 'pain', name: '痛点提问', example: '为什么你涂口红总是显黑？' },
  { key: 'counter', name: '反常识结论', example: '贵价口红的秘密，成分表不会告诉你' },
  { key: 'number', name: '数字冲击', example: '3秒显白，这支口红做到了' },
  { key: 'suspense', name: '悬念故事', example: '直到我发现这支口红，再也不怕脱妆了' },
  { key: 'identity', name: '身份代入', example: '黄皮女生的本命色号，闭眼入' },
  { key: 'benefit', name: '利益前置', example: '今天下单立减50，还送唇刷' },
]

export default function ThreeSecond() {
  const [categories, setCategories] = useState<any[]>([])
  const [demos, setDemos] = useState<any[]>([])
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.threeSecondCategories().then((d: any) => setCategories(d.list || [])).catch(() => {})
    api.threeSecondDemos().then((d: any) => setDemos(d.list || [])).catch(() => {})
  }, [])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await api.threeSecondMake(values)
      message.success('创建成功！AI 正在为你生成三秒完播视频，可在任务列表查看进度')
      form.resetFields()
    } catch {
      /* ignore */
    }
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">三秒完播</h2>
        <p className="mt-1 text-sm text-gray-500">黄金三秒钩子创作，提升视频完播率，让流量翻倍</p>
      </div>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="创作配置" className="!border-0 shadow-sm">
            <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ category: 'ecommerce' }}>
              <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
                <Input placeholder="例如：口红三秒钩子视频" />
              </Form.Item>
              <Form.Item name="category" label="内容分类">
                <Select options={categories.map((c) => ({ value: c.key, label: c.name }))} />
              </Form.Item>
              <Form.Item name="hookType" label="钩子类型" rules={[{ required: true, message: '请选择钩子类型' }]}>
                <Select
                  placeholder="选择黄金三秒钩子类型"
                  options={HOOK_TYPES.map((h) => ({ value: h.key, label: h.name }))}
                />
              </Form.Item>
              <Form.Item name="productName" label="产品名称">
                <Input placeholder="例如：丝绒雾面口红" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" size="large" block htmlType="submit" icon={<ThunderboltOutlined />} loading={submitting}>
                  生成视频（消耗 30 点数）
                </Button>
              </Form.Item>
            </Form>
          </Card>

          <Card title="钩子类型参考" className="mt-4 !border-0 shadow-sm">
            <List
              grid={{ gutter: 12, column: 2 }}
              dataSource={HOOK_TYPES}
              renderItem={(h) => (
                <List.Item>
                  <Card size="small" className="!border !border-gray-100">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <ClockCircleOutlined className="text-primary" />
                      {h.name}
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">示例：{h.example}</p>
                  </Card>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="爆款案例" className="!border-0 shadow-sm">
            {demos.length ? (
              <List
                dataSource={demos}
                renderItem={(d) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<div className="flex h-14 w-20 items-center justify-center rounded bg-gradient-to-br from-purple-100 to-indigo-100 text-xl">🎬</div>}
                      title={<span className="text-sm">{d.title}</span>}
                      description={<Tag className="!text-[10px]">{d.category}</Tag>}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无案例" />
            )}
          </Card>
          <Card title="完播率提升技巧" className="mt-4 !border-0 shadow-sm">
            <ul className="space-y-2 text-xs leading-relaxed text-gray-500">
              <li>• 前三秒必须抛出核心痛点或利益点</li>
              <li>• 语速加快，信息密度提升 30%</li>
              <li>• 搭配醒目花字强化关键信息</li>
              <li>• 结尾设置悬念引导看完整视频</li>
            </ul>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
