import { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Table, Tag, Button, Space, DatePicker, Select, message } from 'antd'
import {
  RiseOutlined, FallOutlined, EyeOutlined, AimOutlined,
  ShoppingCartOutlined, DollarOutlined, ReloadOutlined,
} from '@ant-design/icons'
import { api } from '../../api/request'

const { RangePicker } = DatePicker

// 平台图标映射
const PLATFORM_ICONS: Record<string, string> = {
  qianchuan: '/images/addata/icon_qianchuan.png',
  gdt: '/images/addata/icon_gdt.png',
  kuaishou: '/images/addata/icon_kuaishou.png',
  juliang: '/images/addata/icon_juliang.png',
}

const PLATFORM_NAMES: Record<string, string> = {
  qianchuan: '巨量千川',
  gdt: '腾讯广告',
  kuaishou: '磁力金牛',
  juliang: '聚量引擎',
}

export default function AdsVideoData() {
  const [overview, setOverview] = useState<any>(null)
  const [advertisers, setAdvertisers] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchData()
  }, [days])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [overviewData, advData, groupData] = await Promise.all([
        api.adOverview({ days }),
        api.advertisers({ pageSize: 20 }),
        api.adGroups({ pageSize: 20 }),
      ])
      setOverview(overviewData)
      setAdvertisers(advData.list || [])
      setGroups(groupData.list || [])
    } catch {} finally { setLoading(false) }
  }

  // 趋势图数据（用SVG绘制）
  const renderTrendChart = () => {
    const trend = overview?.trend || []
    if (trend.length === 0) return null
    const maxCost = Math.max(...trend.map((t: any) => t.cost), 1)
    const width = 100 / trend.length

    return (
      <div className="relative h-40 w-full">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
          {/* 网格线 */}
          {[0, 10, 20, 30, 40].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#f0f0f0" strokeWidth="0.2" />
          ))}
          {/* 柱状图 - 消耗 */}
          {trend.map((t: any, i: number) => {
            const h = (t.cost / maxCost) * 38
            return (
              <rect
                key={i}
                x={i * width + width * 0.15}
                y={40 - h}
                width={width * 0.7}
                height={h}
                fill="#6C5CE7"
                opacity="0.85"
                rx="0.3"
              />
            )
          })}
        </svg>
        {/* X轴日期 */}
        <div className="mt-1 flex justify-between text-[9px] text-gray-400">
          {trend.map((t: any, i: number) => (
            <span key={i}>{t.date.slice(5)}</span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* 头部 */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">投放数据</h1>
          <p className="mt-1 text-xs text-gray-400">全平台广告投放数据总览与素材管理</p>
        </div>
        <Space>
          <Select
            value={days}
            onChange={setDays}
            style={{ width: 120 }}
            options={[
              { value: 7, label: '近7天' },
              { value: 14, label: '近14天' },
              { value: 30, label: '近30天' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* 核心指标 */}
      <Row gutter={[16, 16]} className="mb-5">
        <Col xs={12} sm={6}>
          <Card className="!rounded-2xl">
            <Statistic
              title="总消耗"
              value={overview?.total?.cost || 0}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#6C5CE7' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="!rounded-2xl">
            <Statistic title="总曝光" value={overview?.total?.impression || 0} prefix={<EyeOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="!rounded-2xl">
            <Statistic title="总点击" value={overview?.total?.click || 0} prefix={<AimOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card className="!rounded-2xl">
            <Statistic
              title="点击率 CTR"
              value={overview?.total?.ctr || 0}
              precision={2}
              suffix="%"
              valueStyle={{ color: (overview?.total?.ctr || 0) > 3 ? '#f5222d' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="mb-5">
        <Col xs={12} sm={8}>
          <Card className="!rounded-2xl">
            <Statistic title="总转化" value={overview?.total?.conversion || 0} prefix={<ShoppingCartOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card className="!rounded-2xl">
            <Statistic
              title="ROI"
              value={overview?.total?.roi || 0}
              precision={2}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card className="!rounded-2xl">
            <Statistic title="广告账户" value={advertisers.length} suffix="个" />
          </Card>
        </Col>
      </Row>

      {/* 消耗趋势 */}
      <Card className="mb-5 !rounded-2xl" title={`消耗趋势（近${days}天）`}>
        {renderTrendChart()}
      </Card>

      {/* 广告账户列表 */}
      <Card className="mb-5 !rounded-2xl" title="广告账户">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={advertisers}
          pagination={false}
          columns={[
            {
              title: '账户名称',
              dataIndex: 'name',
              render: (name: string, record: any) => (
                <div className="flex items-center gap-2">
                  <img src={PLATFORM_ICONS[record.platform]} alt="" className="h-5 w-5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <span className="text-sm">{name}</span>
                </div>
              ),
            },
            {
              title: '平台',
              dataIndex: 'platform',
              render: (p: string) => <Tag>{PLATFORM_NAMES[p] || p}</Tag>,
            },
            {
              title: '账户ID',
              dataIndex: 'advertiser_id',
              render: (id: string) => <span className="text-xs text-gray-400">{id}</span>,
            },
            {
              title: '余额',
              dataIndex: 'balance',
              render: (b: number) => <span className="text-sm font-medium">¥{b.toLocaleString()}</span>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: number) => <Tag color={s === 1 ? 'green' : 'default'}>{s === 1 ? '正常' : '异常'}</Tag>,
            },
          ]}
        />
      </Card>

      {/* 广告组列表 */}
      <Card className="!rounded-2xl" title="广告组">
        <Table
          rowKey="id"
          dataSource={groups}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '广告组名称', dataIndex: 'name' },
            {
              title: '所属账户',
              dataIndex: 'advertiser_name',
              render: (name: string) => name || '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: string) => (
                <Tag color={s === 'running' ? 'green' : 'default'}>{s === 'running' ? '投放中' : '已暂停'}</Tag>
              ),
            },
            {
              title: '预算',
              dataIndex: 'budget',
              render: (b: number) => `¥${b.toLocaleString()}`,
            },
            {
              title: '消耗',
              dataIndex: 'cost',
              render: (c: number) => <span className="text-primary">¥{c.toLocaleString()}</span>,
            },
            {
              title: '曝光',
              dataIndex: 'impression',
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: '点击',
              dataIndex: 'click',
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: '转化',
              dataIndex: 'conversion',
              render: (v: number) => (
                <span>
                  {v.toLocaleString()}
                  {v > 500 && <RiseOutlined className="ml-1 text-red-500" />}
                  {v < 50 && <FallOutlined className="ml-1 text-green-500" />}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
