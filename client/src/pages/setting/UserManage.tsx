import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Input, Select, Modal, Form, Popconfirm, message,
} from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function UserManage() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)
  const [departments, setDepartments] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    api.departments().then(setDepartments).catch(() => {})
    api.roles().then(setRoles).catch(() => {})
  }, [])

  useEffect(() => { fetchData() }, [searchValue, pageNum])

  const fetchData = async () => {
    try {
      const data = await api.members({ keyword: searchValue || undefined, pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    await api.saveMember({ id: editing?.id, ...values })
    message.success('保存成功')
    setEditOpen(false)
    form.resetFields()
    fetchData()
  }

  const handleStatus = async (id: number, status: number) => {
    await api.memberStatus({ id, status })
    message.success('操作成功')
    fetchData()
  }

  const handleDelete = async (id: number) => {
    await api.deleteMember({ id })
    message.success('删除成功')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">用户管理</h1>
          <p className="mt-1 text-xs text-gray-400">管理团队成员、部门与角色权限</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null)
            form.resetFields()
            setEditOpen(true)
          }}
        >
          新增成员
        </Button>
      </div>

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <Input.Search
          allowClear
          placeholder="搜索成员姓名/账号"
          enterButton
          onSearch={(v) => { setSearchValue(v); setPageNum(1) }}
          style={{ maxWidth: 360 }}
        />
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <Table
          rowKey="id"
          dataSource={list}
          pagination={{
            total,
            current: pageNum,
            pageSize,
            onChange: setPageNum,
            showTotal: (t) => `共 ${t} 人`,
          }}
          columns={[
            { title: '成员', dataIndex: 'name', render: (name: string, r: any) => (
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                  {name.slice(0, 1)}
                </div>
                <div>
                  <div className="text-sm text-gray-700">{name}</div>
                  <div className="text-[10px] text-gray-400">{r.account}</div>
                </div>
              </div>
            )},
            { title: '部门', dataIndex: 'department_name', render: (v: string) => v || '-' },
            {
              title: '角色',
              dataIndex: 'role_name',
              render: (v: string, r: any) => (
                <Tag color={r.role_id === 1 ? 'purple' : 'blue'}>{v}</Tag>
              ),
            },
            {
              title: 'AI点数',
              dataIndex: 'ai_points',
              render: (v: number) => <span className="text-sm font-medium text-primary">{v.toLocaleString()}</span>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? '正常' : '禁用'}</Tag>,
            },
            { title: '创建时间', dataIndex: 'created_at', render: (v: string) => <span className="text-xs text-gray-400">{v}</span> },
            {
              title: '操作',
              render: (_, r: any) => (
                <Space>
                  <Button size="small" type="link" onClick={() => {
                    setEditing(r)
                    form.setFieldsValue({ name: r.name, account: r.account, phone: r.phone, role_id: r.role_id, department_id: r.department_id })
                    setEditOpen(true)
                  }}>
                    编辑
                  </Button>
                  <Button size="small" type="link" onClick={() => handleStatus(r.id, r.status === 1 ? 0 : 1)}>
                    {r.status === 1 ? '禁用' : '启用'}
                  </Button>
                  <Popconfirm title="确认删除该成员？" onConfirm={() => handleDelete(r.id)}>
                    <Button size="small" type="link" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        title={editing ? '编辑成员' : '新增成员'}
      >
        <Form form={form} layout="vertical" className="pt-2">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input disabled={!!editing} placeholder="手机号" />
            </Form.Item>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="phone" label="手机号">
              <Input />
            </Form.Item>
            <Form.Item name="department_id" label="部门">
              <Select allowClear placeholder="选择部门" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
          </div>
          <Form.Item name="role_id" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="选择角色" options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="初始密码" tooltip="默认123456，成员登录后可自行修改">
              <Input defaultValue="123456" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
