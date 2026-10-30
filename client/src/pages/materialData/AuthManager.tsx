import { Card, Empty } from 'antd'
import { SafetyOutlined } from '@ant-design/icons'

export default function AuthManager() {
  return <div className="mx-auto max-w-5xl"><h1 className="mb-2 text-xl font-bold text-gray-800"><SafetyOutlined className="mr-2 text-primary" />授权管理</h1><p className="mb-6 text-sm text-gray-500">广告平台授权尚未接入，接通后可在这里管理真实授权。</p><Card><Empty description="暂无已接入的广告平台" /></Card></div>
}
