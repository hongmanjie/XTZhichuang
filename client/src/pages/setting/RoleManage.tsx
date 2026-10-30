import { useEffect, useState } from 'react'
import { Card, Table, Button, Space, Tag, Modal, Form, Input, Popconfirm, message, Checkbox } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

const AUTHORITIES = [
  { key: 'dashboard', name: '创作中心' },
  { key: 'agent', name: 'AI Agent测试' },
  { key: 'asset-library', name: '资产库' },
  { key: 'hot', name: '爆款创作' },
  { key: 'ai-mix', name: '智能剪辑' },
  { key: 'create', name: 'AI创作' },
  { key: 'material_data', name: '投放数据' },
  { key: 'setting', name: '全部设置' },
  { key: 'team', name: '团队管理' },
  { key: 'partner', name: '合作伙伴' },
]

export default function RoleManage() {
  const [list, setList] = useState<any[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const data = await api.roles()
    setList(data)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    await api.saveRole({ id: editing?.id, ...values })
    message.success('保存成功')
    setEditOpen(false)
    form.resetFields()
    fetchData()
  }

  const handleDelete = async (id: number) => {
    await api.deleteRole({ id })
    message.success('删除成功')
    fetchData()
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">角色管理</h1>
          <p className="mt-1 text-xs text-gray-400">配置角色与功能权限，控制成员可访问的模块</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setEditing(null)
          form.resetFields()
          setEditOpen(true)
        }}>
          新增角色
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.map((role) => (
          <Card
            key={role.id}
            className="!rounded-2xl"
            actions={[
              <Button key="edit" type="link" size="small" onClick={() => {
                setEditing(role)
                form.setFieldsValue({ name: role.name, description: role.description, permissions: role.permissions })
                setEditOpen(true)
              }}>
                编辑
              </Button>,
              <Popconfirm key="del" title="确认删除该角色？" onConfirm={() => handleDelete(role.id)}>
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>,
            ]}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-medium text-gray-800">{role.name}</h3>
              {role.code === 'super_admin' && <Tag color="purple">系统内置</Tag>}
            </div>
            <p className="mb-3 text-xs text-gray-400">{role.description}</p>
            <div className="flex flex-wrap gap-1">
              {(role.permissions.includes('all') ? AUTHORITIES : AUTHORITIES.filter((a) => role.permissions.includes(a.key))).map((a) => (
                <Tag key={a.key} className="!text-[10px]">{a.name}</Tag>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        title={editing ? '编辑角色' : '新增角色'}
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="角色描述">
            <Input placeholder="简要描述该角色的职责" />
          </Form.Item>
          <Form.Item name="permissions" label="功能权限">
            <Checkbox.Group className="grid grid-cols-2 gap-2">
              {AUTHORITIES.map((a) => (
                <Checkbox key={a.key} value={a.key}>{a.name}</Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
