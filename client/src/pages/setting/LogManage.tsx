import { useEffect, useState } from 'react'
import { Card, Table, Input, Select, Tag } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

const ACTION_MAP: Record<string, string> = {
  '密码登录': 'primary',
  '登录成功': 'primary',
  'AI生成': 'purple',
}

export default function LogManage() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [pageNum, setPageNum] = useState(1)
  const [pageSize] = useState(10)

  useEffect(() => { fetchData() }, [searchValue, pageNum])

  const fetchData = async () => {
    try {
      const data = await api.logs({ keyword: searchValue || undefined, pageNum, pageSize })
      setList(data.list || [])
      setTotal(data.total || 0)
    } catch (e: any) {
      if (e.message?.includes('权限')) {
        // 非管理员
      }
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">日志管理</h1>
        <p className="mt-1 text-xs text-gray-400">系统操作日志，记录成员关键操作行为</p>
      </div>

      <Card className="!rounded-2xl">
        <div className="mb-4">
          <Input.Search
            allowClear
            placeholder="搜索操作人/动作/详情"
            enterButton
            onSearch={(v) => { setSearchValue(v); setPageNum(1) }}
            style={{ maxWidth: 360 }}
          />
        </div>

        <Table
          rowKey="id"
          dataSource={list}
          pagination={{ total, current: pageNum, pageSize, onChange: setPageNum, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            { title: '时间', dataIndex: 'created_at', render: (v: string) => <span className="text-xs text-gray-500">{v}</span> },
            { title: '操作人', dataIndex: 'user_name', render: (v: string) => v || '系统' },
            {
              title: '模块',
              dataIndex: 'module',
              render: (m: string) => <Tag color="blue">{m}</Tag>,
            },
            { title: '动作', dataIndex: 'action' },
            { title: '详情', dataIndex: 'detail', render: (v: string) => <span className="text-xs text-gray-500">{v || '-'}</span> },
            { title: 'IP', dataIndex: 'ip', render: (v: string) => <span className="text-xs text-gray-400">{v || '-'}</span> },
          ]}
        />
      </Card>
    </div>
  )
}
