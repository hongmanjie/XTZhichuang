import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Table, Button, Modal, Form, Input, InputNumber, Select, Space, message, Tag } from 'antd'
import { ThunderboltOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function AIPointManage() {
  const [overview, setOverview] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantUser, setGrantUser] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchOverview()
    fetchMembers()
  }, [pageNum])

  const fetchOverview = async () => {
    try {
      setOverview(await api.aiPointOverview())
    } catch {}
  }

  const fetchMembers = async () => {
    try {
      const data = await api.members({ pageNum, pageSize })
      setMembers(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  const handleGrant = async () => {
    const values = await form.validateFields()
    await api.grantPoints({ userId: grantUser.id, points: values.points, remark: values.remark })
    message.success('发放成功')
    setGrantOpen(false)
    form.resetFields()
    fetchMembers()
    fetchOverview()
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">
          <ThunderboltOutlined className="mr-2 text-primary" />
          AI点数管理
        </h1>
        <p className="mt-1 text-xs text-gray-400">管理团队AI点数，为成员发放创作额度</p>
      </div>

      {/* 总览 */}
      <Row gutter={[16, 16]} className="mb-5">
        <Col xs={24} sm={8}>
          <Card className="!rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-500">
            <Statistic
              title={<span className="text-white/80">当前余额</span>}
              value={overview?.balance || 0}
              valueStyle={{ color: '#fff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card className="!rounded-2xl">
            <Statistic title="累计发放" value={overview?.totalEarned || 0} valueStyle={{ color: '#6C5CE7' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card className="!rounded-2xl">
            <Statistic title="累计消耗" value={overview?.totalUsed || 0} valueStyle={{ color: '#f5222d' }} />
          </Card>
        </Col>
      </Row>

      {/* 成员点数列表 */}
      <Card className="!rounded-2xl" title="成员点数">
        <Table
          rowKey="id"
          dataSource={members}
          pagination={{ total, current: pageNum, pageSize, onChange: setPageNum, showTotal: (t) => `共 ${t} 人` }}
          columns={[
            { title: '成员', dataIndex: 'name', render: (name: string, r: any) => (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">
                  {name.slice(0, 1)}
                </div>
                <span className="text-sm">{name}</span>
              </div>
            )},
            { title: '部门', dataIndex: 'department_name', render: (v: string) => v || '-' },
            {
              title: 'AI点数',
              dataIndex: 'ai_points',
              render: (v: number) => (
                <span className={`text-sm font-medium ${v < 100 ? 'text-red-500' : 'text-primary'}`}>
                  {v.toLocaleString()}
                  {v < 100 && <Tag color="red" className="!ml-1 !text-[9px]">不足</Tag>}
                </span>
              ),
            },
            {
              title: '操作',
              render: (_, r: any) => (
                <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => {
                  setGrantUser(r)
                  form.resetFields()
                  setGrantOpen(true)
                }}>
                  发放点数
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {/* 发放弹窗 */}
      <Modal
        open={grantOpen}
        onCancel={() => setGrantOpen(false)}
        onOk={handleGrant}
        title={`给 ${grantUser?.name || ''} 发放点数`}
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="points" label="发放点数" rules={[{ required: true, message: '请输入点数' }]}>
            <InputNumber className="!w-full" min={1} max={1000000} placeholder="例如：5000" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="例如：Q4创作激励" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
