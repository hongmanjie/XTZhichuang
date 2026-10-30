import { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Rate, message, Radio } from 'antd'
import { MessageOutlined } from '@ant-design/icons'
import { api } from '../api/request'

export default function Feedback() {
  const [types, setTypes] = useState<any[]>([])
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.feedbackInit().then((d: any) => setTypes(d.types || [])).catch(() => {})
  }, [])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await api.feedbackSubmit(values)
      message.success('感谢您的反馈，我们会认真评估每一条建议！')
      form.resetFields()
    } catch {
      /* ignore */
    }
    setSubmitting(false)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          <MessageOutlined className="mr-2 text-primary" />
          意见反馈
        </h2>
        <p className="mt-1 text-sm text-gray-500">你的每一条建议，都是我们进步的动力</p>
      </div>

      <Card className="!border-0 shadow-sm">
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ type: '功能建议', satisfaction: 5 }}>
          <Form.Item name="type" label="反馈类型" rules={[{ required: true }]}>
            <Radio.Group buttonStyle="solid">
              {types.map((t) => (
                <Radio.Button key={t} value={t}>{t}</Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="satisfaction" label="整体满意度">
            <Rate count={5} />
          </Form.Item>
          <Form.Item name="content" label="反馈内容" rules={[{ required: true, message: '请填写反馈内容' }, { min: 5, message: '至少填写5个字' }]}>
            <Input.TextArea rows={6} placeholder="请详细描述你遇到的问题或建议，我们会尽快跟进处理..." maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="contact" label="联系方式（选填）">
            <Input placeholder="手机号/微信号，方便我们回访" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" size="large" htmlType="submit" loading={submitting} block>
              提交反馈
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="常见问题" className="!border-0 shadow-sm">
        <ul className="space-y-2 text-sm text-gray-500">
          <li>• AI 生成失败会自动返还点数，可在任务列表重试</li>
          <li>• 素材上传支持 MP4/MOV/JPG/PNG，单个文件最大 500MB</li>
          <li>• 智能剪辑导出的视频保存在「资产库 - 作品」中</li>
          <li>• 如需发票或企业服务，请联系客服</li>
        </ul>
      </Card>
    </div>
  )
}
