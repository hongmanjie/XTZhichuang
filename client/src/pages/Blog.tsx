import { Card, Empty } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'

export default function Blog() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">
          <FileTextOutlined className="mr-2 text-primary" />
          创作学院
        </h1>
        <p className="mt-1 text-xs text-gray-400">创作技巧、平台动态与最佳实践</p>
      </div>

      <Card className="!rounded-2xl">
        <Empty description="内容即将上线，敬请期待" />
      </Card>
    </div>
  )
}
