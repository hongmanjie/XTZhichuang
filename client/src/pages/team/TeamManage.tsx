import { useEffect, useState } from 'react'
import { Card, Tabs, Table, Button, Space, Tag, Modal, Form, Input, Popconfirm, message, Tree } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined, ShopOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function TeamManage() {
  const [tab, setTab] = useState('members')
  const [members, setMembers] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [departments, setDepartments] = useState<any[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)
  const [deptOpen, setDeptOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [deptForm] = Form.useForm()
  const [brandForm] = Form.useForm()
  const [editingDept, setEditingDept] = useState<any>(null)
  const [editingBrand, setEditingBrand] = useState<any>(null)

  useEffect(() => {
    api.departments().then(setDepartments).catch(() => {})
    api.brands().then(setBrands).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'members') {
      api.members({ pageNum, pageSize }).then((d) => {
        setMembers(d.list || [])
        setTotal(d.total || 0)
      }).catch(() => {})
    }
  }, [tab, pageNum])

  const handleDeptSave = async () => {
    try {
      const values = await deptForm.validateFields()
      await api.saveDepartment(editingDept ? { id: editingDept.id, ...values } : values)
      message.success('保存成功')
      setDeptOpen(false)
      setEditingDept(null)
      deptForm.resetFields()
      api.departments().then(setDepartments).catch(() => {})
    } catch { /* ignore */ }
  }

  const handleDeptDelete = async (id: number) => {
    await api.deleteDepartment({ id })
    message.success('删除成功')
    api.departments().then(setDepartments).catch(() => {})
  }

  const handleBrandSave = async () => {
    try {
      const values = await brandForm.validateFields()
      await api.saveBrand(editingBrand ? { id: editingBrand.id, ...values } : values)
      message.success('保存成功')
      setBrandOpen(false)
      setEditingBrand(null)
      brandForm.resetFields()
      api.brands().then(setBrands).catch(() => {})
    } catch { /* ignore */ }
  }

  const handleBrandDelete = async (id: number) => {
    await api.deleteBrand({ id })
    message.success('删除成功')
    api.brands().then(setBrands).catch(() => {})
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
            <TeamOutlined className="mr-2 text-primary" />
            团队管理
          </h1>
          <p className="mt-1 text-xs text-gray-400">管理部门架构、团队成员与品牌客户</p>
        </div>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'members', label: '团队成员' },
          { key: 'departments', label: '部门架构' },
          { key: 'brands', label: '品牌客户' },
        ]}
      />

      {/* 团队成员 */}
      {tab === 'members' && (
        <Card className="!rounded-2xl">
          <Table
            rowKey="id"
            dataSource={members}
            pagination={{ total, current: pageNum, pageSize, onChange: setPageNum, showTotal: (t) => `共 ${t} 人` }}
            columns={[
              { title: '成员', dataIndex: 'name', render: (name: string, r: any) => (
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{name.slice(0, 1)}</div>
                  <div>
                    <div className="text-sm">{name}</div>
                    <div className="text-[10px] text-gray-400">{r.account}</div>
                  </div>
                </div>
              )},
              { title: '部门', dataIndex: 'department_name', render: (v: string) => v || '-' },
              { title: '角色', dataIndex: 'role_name', render: (v: string) => <Tag color="blue">{v}</Tag> },
              { title: 'AI点数', dataIndex: 'ai_points', render: (v: number) => <span className="text-primary">{v.toLocaleString()}</span> },
              { title: '状态', dataIndex: 'status', render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? '正常' : '禁用'}</Tag> },
            ]}
          />
        </Card>
      )}

      {/* 部门架构 */}
      {tab === 'departments' && (
        <Card
          className="!rounded-2xl"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingDept(null); deptForm.resetFields(); setDeptOpen(true) }}>新增部门</Button>}
        >
          <Table
            rowKey="id"
            dataSource={departments}
            pagination={false}
            columns={[
              { title: '部门名称', dataIndex: 'name', render: (name: string) => (
                <span className="flex items-center gap-2"><TeamOutlined className="text-gray-400" />{name}</span>
              )},
              { title: '排序', dataIndex: 'sort' },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Space>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
                      setEditingDept(r)
                      deptForm.setFieldsValue(r)
                      setDeptOpen(true)
                    }}>编辑</Button>
                    <Popconfirm title="确认删除？" onConfirm={() => handleDeptDelete(r.id)}>
                      <Button size="small" type="link" danger>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* 品牌客户 */}
      {tab === 'brands' && (
        <Card
          className="!rounded-2xl"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingBrand(null); brandForm.resetFields(); setBrandOpen(true) }}>新增品牌</Button>}
        >
          <Table
            rowKey="id"
            dataSource={brands}
            pagination={false}
            columns={[
              { title: '品牌名称', dataIndex: 'name', render: (name: string, r: any) => (
                <span className="flex items-center gap-2">
                  <ShopOutlined className="text-gray-400" />
                  {name}
                </span>
              )},
              { title: '行业', dataIndex: 'industry' },
              { title: '素材数', dataIndex: 'material_count', render: (v: number) => v || 0 },
              { title: '备注', dataIndex: 'remark', render: (v: string) => <span className="text-xs text-gray-400">{v || '-'}</span> },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Space>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
                      setEditingBrand(r)
                      brandForm.setFieldsValue(r)
                      setBrandOpen(true)
                    }}>编辑</Button>
                    <Popconfirm title="确认删除？" onConfirm={() => handleBrandDelete(r.id)}>
                      <Button size="small" type="link" danger>删除</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* 部门弹窗 */}
      <Modal open={deptOpen} onCancel={() => setDeptOpen(false)} onOk={handleDeptSave} title="部门信息">
        <Form form={deptForm} layout="vertical" className="pt-2">
          <Form.Item name="name" label="部门名称" rules={[{ required: true, message: '请输入部门名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <Input type="number" defaultValue={0} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 品牌弹窗 */}
      <Modal open={brandOpen} onCancel={() => setBrandOpen(false)} onOk={handleBrandSave} title="品牌信息">
        <Form form={brandForm} layout="vertical" className="pt-2">
          <Form.Item name="name" label="品牌名称" rules={[{ required: true, message: '请输入品牌名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="industry" label="所属行业">
            <Input placeholder="例如：美妆护肤" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
