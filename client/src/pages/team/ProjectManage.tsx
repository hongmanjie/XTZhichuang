import { useState, useEffect } from 'react'
import { Card, Row, Col, Table, Button, Tabs, Tag, Modal, Form, Input, Select, Statistic, Empty, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined, ApartmentOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function TeamProjectManage() {
  const [tab, setTab] = useState('brand')
  const [projects, setProjects] = useState<any[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()

  const fetchData = async () => {
    setLoading(true)
    try {
      const [p, b, d, m]: any[] = await Promise.all([
        api.myProjects(),
        api.brands(),
        api.departments(),
        api.members(),
      ])
      setProjects(p.list || [])
      setBrands(b || [])
      setDepartments(d || [])
      setMembers(m.list || [])
    } catch {
      /* ignore */
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    try {
      // 编辑需带上 id，否则后端当成新建
      await api.saveBrand(editing ? { id: editing.id, ...values } : values)
      message.success(editing ? '修改成功' : '创建成功')
      setModalOpen(false)
      form.resetFields()
      setEditing(null)
      fetchData()
    } catch {
      /* ignore */
    }
  }

  const handleDelete = async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后不可恢复，确认删除该品牌？',
      okType: 'danger',
      onOk: async () => {
        await api.deleteBrand({ id }).catch(() => {})
        message.success('删除成功')
        fetchData()
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            <TeamOutlined className="mr-2 text-primary" />
            团队管理
          </h2>
          <p className="mt-1 text-sm text-gray-500">管理部门、品牌客户与项目，组织团队高效协作</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true) }}>
          新建品牌
        </Button>
      </div>

      <Row gutter={16}>
        <Col span={8}><Card className="!border-0 shadow-sm"><Statistic title="品牌客户" value={brands.length} suffix="个" /></Card></Col>
        <Col span={8}><Card className="!border-0 shadow-sm"><Statistic title="我的项目" value={projects.length} suffix="个" valueStyle={{ color: '#6C5CE7' }} /></Card></Col>
        <Col span={8}><Card className="!border-0 shadow-sm"><Statistic title="部门" value={departments.length} suffix="个" valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>

      <Card className="!border-0 shadow-sm" loading={loading}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'brand',
              label: '品牌客户',
              children: brands.length ? (
                <Table
                  rowKey="id"
                  dataSource={brands}
                  pagination={false}
                  columns={[
                    { title: '品牌名称', dataIndex: 'name' },
                    { title: '所属行业', dataIndex: 'industry' },
                    { title: '备注', dataIndex: 'remark', render: (r: string) => r || '-' },
                    {
                      title: '操作',
                      render: (_: any, r: any) => (
                        <>
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); form.setFieldsValue(r); setModalOpen(true) }}>编辑</Button>
                          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)}>删除</Button>
                        </>
                      ),
                    },
                  ]}
                />
              ) : (
                <Empty description="暂无品牌，点击右上角创建" className="py-12" />
              ),
            },
            {
              key: 'project',
              label: '我的项目',
              children: projects.length ? (
                <Table
                  rowKey="id"
                  dataSource={projects}
                  pagination={false}
                  columns={[
                    { title: '项目名称', dataIndex: 'name' },
                    { title: '行业', dataIndex: 'industry' },
                    { title: '脚本数', dataIndex: 'script_count' },
                    { title: '创建时间', dataIndex: 'created_at' },
                    {
                      title: '操作',
                      render: (_: any, r: any) => (
                        <Button type="link" size="small" onClick={() => api.myProjectAddScript({ projectId: r.id, title: '新脚本' }).then(() => { message.success('已创建脚本'); fetchData() }).catch(() => {})}>
                          新建脚本
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : (
                <Empty description="暂无项目" className="py-12" />
              ),
            },
            {
              key: 'department',
              label: '部门架构',
              children: departments.length ? (
                <Table
                  rowKey="id"
                  dataSource={departments}
                  pagination={false}
                  columns={[
                    { title: '部门名称', dataIndex: 'name' },
                    { title: '排序', dataIndex: 'sort' },
                  ]}
                />
              ) : (
                <Empty description="暂无部门" className="py-12" />
              ),
            },
            {
              key: 'member',
              label: '成员',
              children: members.length ? (
                <Table
                  rowKey="id"
                  dataSource={members}
                  pagination={false}
                  columns={[
                    { title: '成员', dataIndex: 'name' },
                    { title: '手机号', dataIndex: 'account', render: (a: string) => (a || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') },
                    {
                      title: '角色',
                      dataIndex: 'roleName',
                      render: (r: string) => <Tag color="purple">{r}</Tag>,
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      render: (s: number) => <Tag color={s === 1 ? 'success' : 'default'}>{s === 1 ? '正常' : '禁用'}</Tag>,
                    },
                  ]}
                />
              ) : (
                <Empty description="暂无成员" className="py-12" />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑品牌' : '新建品牌'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="name" label="品牌名称" rules={[{ required: true, message: '请输入品牌名称' }]}>
            <Input placeholder="例如：花西子" />
          </Form.Item>
          <Form.Item name="industry" label="所属行业">
            <Select
              options={[
                { value: '美妆护肤', label: '美妆护肤' },
                { value: '食品饮料', label: '食品饮料' },
                { value: '服装鞋包', label: '服装鞋包' },
                { value: '数码家电', label: '数码家电' },
                { value: '家居日用', label: '家居日用' },
              ]}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="品牌相关备注信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
