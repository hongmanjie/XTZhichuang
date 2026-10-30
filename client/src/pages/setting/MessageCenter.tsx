import { useState, useEffect } from 'react'
import { Card, List, Tabs, Badge, Button, Empty, Tag, Modal, Space } from 'antd'
import { CheckOutlined, DeleteOutlined, BellOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function MessageCenter() {
  const [type, setType] = useState('all')
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<any>(null)

  const fetchList = async () => {
    setLoading(true)
    try {
      const d: any = await api.messages({ type, pageNum, pageSize: 10 })
      setList(d.list || [])
      setTotal(d.total || 0)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }

  const fetchUnread = async () => {
    try {
      const d: any = await api.unreadMessages()
      setUnread(d.unread || 0)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => { fetchUnread() }, [])
  useEffect(() => { fetchList() }, [type, pageNum])

  const handleRead = async (msg: any) => {
    setDetail(msg)
    if (!msg.isRead) {
      await api.readMessages({ ids: [msg.id] }).catch(() => {})
      fetchList()
      fetchUnread()
    }
  }

  const handleReadAll = async () => {
    const ids = list.filter((m) => !m.isRead).map((m) => m.id)
    if (!ids.length) return
    await api.readMessages({ ids }).catch(() => {})
    fetchList()
    fetchUnread()
  }

  const typeTag = (t: string) => {
    const map: Record<string, { color: string; text: string }> = {
      system: { color: 'blue', text: '系统通知' },
      task: { color: 'green', text: '任务消息' },
      marketing: { color: 'orange', text: '优惠活动' },
    }
    const cfg = map[t] || { color: 'default', text: t }
    return <Tag color={cfg.color} className="!mr-0">{cfg.text}</Tag>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-800">
            <Badge count={unread} offset={[8, -6]}>
              <BellOutlined className="mr-2" />
            </Badge>
            消息中心
          </h2>
          <span className="text-sm text-gray-400">{unread} 条未读</span>
        </div>
        <Space>
          <Button icon={<CheckOutlined />} onClick={handleReadAll} disabled={!unread}>全部已读</Button>
        </Space>
      </div>

      <Card className="!border-0 shadow-sm">
        <Tabs
          activeKey={type}
          onChange={(k) => { setType(k); setPageNum(1) }}
          items={[
            { key: 'all', label: '全部' },
            { key: 'system', label: '系统通知' },
            { key: 'task', label: '任务消息' },
            { key: 'marketing', label: '优惠活动' },
          ]}
        />

        <List
          loading={loading}
          dataSource={list}
          locale={{ emptyText: <Empty description="暂无消息" className="py-12" /> }}
          renderItem={(item: any) => (
            <List.Item
              className={`cursor-pointer rounded-lg px-4 transition-colors hover:bg-purple-50 ${item.isRead ? '' : 'bg-blue-50/40'}`}
              onClick={() => handleRead(item)}
            >
              <List.Item.Meta
                title={
                  <div className="flex items-center gap-2">
                    {!item.isRead && <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                    <span className={`text-sm ${item.isRead ? 'text-gray-600' : 'font-medium text-gray-800'}`}>{item.title}</span>
                    {typeTag(item.type)}
                  </div>
                }
                description={<div className="mt-1 line-clamp-1 text-xs text-gray-400">{item.content}</div>}
              />
              <div className="shrink-0 text-xs text-gray-400">{item.created_at}</div>
            </List.Item>
          )}
        />

        {total > 10 && (
          <div className="mt-4 flex justify-center gap-2">
            <Button size="small" disabled={pageNum <= 1} onClick={() => setPageNum(pageNum - 1)}>上一页</Button>
            <Button size="small" disabled={list.length < 10} onClick={() => setPageNum(pageNum + 1)}>下一页</Button>
          </div>
        )}
      </Card>

      <Modal
        title={detail?.title}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button type="primary" onClick={() => setDetail(null)}>知道了</Button>}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {detail && typeTag(detail.type)}
            <span>{detail?.created_at}</span>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">{detail?.content}</p>
        </div>
      </Modal>
    </div>
  )
}
