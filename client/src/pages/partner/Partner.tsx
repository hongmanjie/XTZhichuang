import { useEffect, useState } from 'react'
import { Card, Row, Col, Button, Tabs, Table, Tag, Statistic, Modal, Form, Input, InputNumber, Empty, message } from 'antd'
import { TeamOutlined, WalletOutlined, UserAddOutlined, AccountBookOutlined, CopyOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function Partner() {
  const [tab, setTab] = useState('invite')
  const [init, setInit] = useState<any>({})
  const [invitees, setInvitees] = useState<any[]>([])
  const [recharges, setRecharges] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [form] = Form.useForm()
  const [bindForm] = Form.useForm()

  const fetchAll = async () => {
    try {
      const [i, p, r, l]: any[] = await Promise.all([
        api.withdrawInit(),
        api.withdrawPage(),
        api.withdrawFriendRecharge(),
        api.withdrawLogs({ pageSize: 20 }),
      ])
      setInit(i)
      setInvitees(p.list || [])
      setRecharges(r.list || [])
      setLogs(l.list || [])
    } catch {
      /* ignore */
    }
  }

  useEffect(() => { fetchAll() }, [])

  const handleWithdraw = async () => {
    const values = await form.validateFields()
    try {
      await api.withdrawSubmit(values)
      message.success('提现申请已提交，预计 1-3 个工作日到账')
      setWithdrawOpen(false)
      fetchAll()
    } catch {
      /* ignore */
    }
  }

  const copyInviteCode = () => {
    navigator.clipboard?.writeText(init.inviteCode || '').then(() => message.success('邀请码已复制')).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          <TeamOutlined className="mr-2 text-primary" />
          合作伙伴
        </h2>
        <p className="mt-1 text-sm text-gray-500">邀请好友注册消费，赚取返利奖励，随时提现</p>
      </div>

      <Row gutter={16}>
        <Col span={6}>
          <Card className="!border-0 shadow-sm">
            <Statistic title="可提现余额" value={init.balance || 0} precision={2} prefix="¥" valueStyle={{ color: '#6C5CE7' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="!border-0 shadow-sm">
            <Statistic title="累计提现" value={init.totalWithdrawn || 0} precision={2} prefix="¥" />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="!border-0 shadow-sm">
            <Statistic title="成功邀请" value={init.inviteCount || 0} suffix="人" />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="!border-0 shadow-sm">
            <Statistic title="我的邀请码" value={init.inviteCode || '-'} valueStyle={{ fontSize: 20 }} />
            <Button type="link" size="small" className="!p-0" onClick={copyInviteCode}>复制邀请码</Button>
          </Card>
        </Col>
      </Row>

      <Card className="!border-0 shadow-sm" title="返利规则">
        <p className="text-sm text-gray-500">{init.rule || '邀请好友注册并消费，可获得消费金额10%的返利奖励'}</p>
        <div className="mt-3 flex gap-3">
          <Button type="primary" icon={<WalletOutlined />} onClick={() => setWithdrawOpen(true)}>申请提现</Button>
          <Button icon={<AccountBookOutlined />} onClick={() => setBindOpen(true)}>绑定提现账户</Button>
          <Button icon={<UserAddOutlined />} onClick={copyInviteCode}>邀请好友</Button>
        </div>
      </Card>

      <Card className="!border-0 shadow-sm">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'invite',
              label: '邀请记录',
              children: invitees.length ? (
                <Table
                  rowKey="id"
                  dataSource={invitees}
                  pagination={false}
                  columns={[
                    { title: '用户', dataIndex: 'name' },
                    { title: '手机号', dataIndex: 'phone', render: (p: string) => (p || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') },
                    { title: '注册时间', dataIndex: 'created_at' },
                  ]}
                />
              ) : (
                <Empty description="暂无邀请记录，快去分享你的邀请链接吧" className="py-12" />
              ),
            },
            {
              key: 'recharge',
              label: '好友充值',
              children: recharges.length ? (
                <Table
                  rowKey="id"
                  dataSource={recharges}
                  pagination={false}
                  columns={[
                    { title: '用户', dataIndex: 'name' },
                    { title: '充值金额', dataIndex: 'amount', render: (a: number) => `¥${a}` },
                    { title: '充值时间', dataIndex: 'created_at' },
                  ]}
                />
              ) : (
                <Empty description="暂无好友充值记录" className="py-12" />
              ),
            },
            {
              key: 'log',
              label: '提现记录',
              children: logs.length ? (
                <Table
                  rowKey="id"
                  dataSource={logs}
                  pagination={false}
                  columns={[
                    { title: '提现金额', dataIndex: 'amount', render: (a: number) => `¥${a}` },
                    { title: '账户', dataIndex: 'account' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      render: (s: string) => (
                        <Tag color={s === 'success' ? 'success' : s === 'failed' ? 'error' : 'processing'}>
                          {s === 'success' ? '已到账' : s === 'failed' ? '已驳回' : '审核中'}
                        </Tag>
                      ),
                    },
                    { title: '申请时间', dataIndex: 'created_at' },
                  ]}
                />
              ) : (
                <Empty description="暂无提现记录" className="py-12" />
              ),
            },
          ]}
        />
      </Card>

      <Modal title="申请提现" open={withdrawOpen} onCancel={() => setWithdrawOpen(false)} onOk={handleWithdraw} okText="提交申请">
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="amount" label="提现金额（元）" rules={[{ required: true, message: '请输入提现金额' }]}>
            <InputNumber min={100} precision={2} style={{ width: '100%' }} placeholder={`最低 ${init.minWithdraw || 100} 元`} />
          </Form.Item>
          <Form.Item name="account" label="提现账户" rules={[{ required: true, message: '请输入提现账户' }]}>
            <Input placeholder="支付宝/微信/银行卡账号" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="绑定提现账户"
        open={bindOpen}
        onCancel={() => setBindOpen(false)}
        onOk={async () => {
          try {
            const values = await bindForm.validateFields()
            await api.withdrawBind(values)
            message.success('绑定成功')
            setBindOpen(false)
            bindForm.resetFields()
          } catch { /* ignore */ }
        }}
      >
        <Form form={bindForm} layout="vertical" className="mt-4">
          <Form.Item name="bindAccount" label="账户信息" rules={[{ required: true, message: '请输入账户信息' }]}>
            <Input placeholder="支付宝/微信/银行卡账号" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
