import { Card, Empty } from 'antd'
import { CompassOutlined } from '@ant-design/icons'

export default function DataCompass() {
  return <div className="mx-auto max-w-5xl"><h1 className="mb-2 text-xl font-bold"><CompassOutlined className="mr-2 text-primary" />数据罗盘</h1><p className="mb-6 text-sm text-gray-500">视频平台数据源尚未接入，历史示例数据不会当作实时数据展示。</p><Card><Empty description="接入数据源后可查看真实视频数据" /></Card></div>
}
