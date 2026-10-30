import { Card, Empty } from 'antd'
import { LineChartOutlined } from '@ant-design/icons'

export default function DataInfo() {
  return <div className="mx-auto max-w-5xl"><h1 className="mb-2 text-xl font-bold text-gray-800"><LineChartOutlined className="mr-2 text-primary" />投放数据</h1><p className="mb-6 text-sm text-gray-500">广告平台的数据接口尚未接入。</p><Card><Empty description="接入并授权广告平台后，这里将显示真实的投放数据" /></Card></div>
}
