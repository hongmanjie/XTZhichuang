import { useEffect, useState } from 'react'
import { Card, Table, Select, DatePicker, Tag } from 'antd'
import { api } from '../../api/request'

const MODULE_MAP: Record<string, string> = {
  charge: '充值',
  replica: '爆款复刻',
  factory: 'AI梦工厂',
  studio: 'AI商拍',
  materialField: 'AI素材场',
  analysis: '视频解析',
  human: '百变数字人',
  mix: '智能剪辑',
  setting: '系统',
}

export default function Consumption() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)
  const [module, setModule] = useState<string>('')

  useEffect(() => { fetchData() }, [pageNum, module])

  const fetchData = async () => {
    try {
      const data = await api.consumption({ pageNum, pageSize, module: module || undefined })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">消费记录</h1>
        <p className="mt-1 text-xs text-gray-400">查看AI点数消费明细</p>
      </div>

      <Card className="!rounded-2xl">
        <div className="mb-4 flex gap-3">
          <Select
            allowClear
            placeholder="全部模块"
            style={{ width: 200 }}
            value={module || undefined}
            onChange={(v) => { setModule(v || ''); setPageNum(1) }}
            options={Object.entries(MODULE_MAP).map(([value, label]) => ({ value, label }))}
          />
        </div>

        <Table
          rowKey="id"
          dataSource={list}
          pagination={{ total, current: pageNum, pageSize, onChange: setPageNum, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            { title: '时间', dataIndex: 'created_at', render: (v: string) => <span className="text-xs text-gray-500">{v}</span> },
            {
              title: '模块',
              dataIndex: 'module',
              render: (m: string) => <Tag color="purple">{MODULE_MAP[m] || m}</Tag>,
            },
            { title: '动作', dataIndex: 'action' },
            { title: '备注', dataIndex: 'remark', render: (v: string) => <span className="text-xs text-gray-500">{v || '-'}</span> },
            {
              title: '点数变动',
              dataIndex: 'points',
              render: (p: number) => (
                <span className={`text-sm font-medium ${p > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {p > 0 ? '+' : ''}{p}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
