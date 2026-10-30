import { useEffect, useState } from 'react'
import { Card, Descriptions, Avatar, Button, Form, Input, message, Tabs, Tag } from 'antd'
import { UserOutlined, EditOutlined } from '@ant-design/icons'
import { api } from '../api/request'
import { useUserStore } from '../stores/userStore'
import { withBase } from "../utils/base"

export default function UserInfoPage() {
  const { userInfo, setUserInfo } = useUserStore()
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    if (editing && userInfo) {
      form.setFieldsValue({ name: userInfo.name, email: userInfo.email, phone: userInfo.phone })
    }
  }, [editing])

  const handleSave = async () => {
    const values = await form.validateFields()
    await api.updateUser(values)
    const userData = await api.userInfo()
    setUserInfo(userData)
    setEditing(false)
    message.success('保存成功')
  }

  if (!userInfo) return null

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">个人中心</h1>
      </div>

      <Card className="!rounded-2xl">
        <div className="mb-6 flex items-center gap-4">
          <Avatar size={72} src={withBase(userInfo.avatar)} icon={<UserOutlined />} className="bg-primary" />
          <div>
            <h2 className="text-lg font-bold text-gray-800">{userInfo.name}</h2>
            <p className="text-xs text-gray-400">{userInfo.account}</p>
            <div className="mt-1 flex gap-2">
              <Tag color="purple">{userInfo.roleName}</Tag>
              {userInfo.departmentName && <Tag color="blue">{userInfo.departmentName}</Tag>}
            </div>
          </div>
        </div>

        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="姓名">{userInfo.name}</Descriptions.Item>
          <Descriptions.Item label="手机号">{userInfo.phone || userInfo.account}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{userInfo.email || '未设置'}</Descriptions.Item>
          <Descriptions.Item label="角色">{userInfo.roleName}</Descriptions.Item>
          <Descriptions.Item label="部门">{userInfo.departmentName || '未分配'}</Descriptions.Item>
          <Descriptions.Item label="AI点数">
            <span className="font-bold text-primary">{userInfo.ai_points?.toLocaleString()}</span>
          </Descriptions.Item>
        </Descriptions>

        <div className="mt-4">
          <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(!editing)}>
            {editing ? '取消编辑' : '编辑资料'}
          </Button>
        </div>

        {editing && (
          <Card size="small" className="mt-4" title="编辑资料">
            <Form form={form} layout="vertical" onFinish={handleSave}>
              <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="phone" label="手机号">
                <Input />
              </Form.Item>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
              <Button type="primary" htmlType="submit">保存</Button>
            </Form>
          </Card>
        )}
      </Card>
    </div>
  )
}
