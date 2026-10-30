import { useEffect, useState } from 'react'
import { Card, Table, Tag } from 'antd'
import { api } from '../../api/request'

export default function ChargeRecord() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)

  useEffect(() => { fetchData() }, [pageNum])

  const fetchData = async () => {
    try {
      const data = await api.chargeRecords({ pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch {}
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">充值记录</h1>
        <p className="mt-1 text-xs text-gray-400">查看历史充值与消费记录</p>
      </div>

      <Card className="!rounded-2xl">
        <Table
          rowKey="id"
          dataSource={list}
          locale={{ emptyText: '暂无充值记录' }}
          pagination={{ total, current: pageNum, pageSize, onChange: setPageNum, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            { title: '订单号', dataIndex: 'order_no', render: (v: string) => <span className="text-xs text-gray-500">{v}</span> },
            { title: '套餐', dataIndex: 'package_name', render: (v: string) => v || '-' },
            { title: '点数', dataIndex: 'points', render: (v: number) => <span className="text-primary">+{v?.toLocaleString()}</span> },
            { title: '金额', dataIndex: 'amount', render: (v: number) => <span className="font-medium">¥{v}</span> },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: string) => (
                <Tag color={s === 'paid' ? 'green' : s === 'canceled' ? 'default' : 'orange'}>
                  {s === 'paid' ? '已支付' : s === 'canceled' ? '已取消' : '待支付'}
                </Tag>
              ),
            },
            { title: '创建时间', dataIndex: 'created_at', render: (v: string) => <span className="text-xs text-gray-400">{v}</span> },
            { title: '支付时间', dataIndex: 'paid_at', render: (v: string) => <span className="text-xs text-gray-400">{v || '-'}</span> },
          ]}
        />
      </Card>
    </div>
  )
}
