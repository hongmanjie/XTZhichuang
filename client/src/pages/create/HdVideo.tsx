import { useState, useEffect } from 'react'
import { Button, Card, Upload, Tag, Divider, message, Select, Table, Tabs, Empty, Progress, Radio } from 'antd'
import { ThunderboltOutlined, InboxOutlined, VideoCameraOutlined, HistoryOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

export default function HdVideo() {
  const [fileUrl, setFileUrl] = useState('')
  const [mode, setMode] = useState('standard')
  const [modes, setModes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('create')
  const [records, setRecords] = useState<any[]>([])

  useEffect(() => {
    api.superResInit().then((d: any) => setModes(d.modes || [])).catch(() => {})
    api.superResTasks().then((d: any) => setRecords(d.list || [])).catch(() => {})
  }, [])

  // 上传源视频（真实上传到服务端，避免 blob: URL 后端无法访问）
  const handleUpload = async (file: File) => {
    const hide = message.loading('上传中...', 0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', '高清视频')
      const data = await api.uploadMaterial(fd)
      setFileUrl(data.url)
      message.success('视频已上传')
    } catch {
      message.error('上传失败')
    } finally {
      hide()
    }
    return false
  }

  const handleEnhance = async () => {
    if (!fileUrl) return message.warning('请先上传视频')
    setLoading(true)
    try {
      await api.superResCreate({ name: '高清修复任务', sourceUrl: fileUrl, mode })
      message.success('修复任务已创建，处理完成后可在「修复记录」查看')
      api.superResTasks().then((d: any) => setRecords(d.list || [])).catch(() => {})
      setTab('record')
    } catch {
      /* ignore */
    }
    setLoading(false)
  }

  const currentMode = modes.find((m) => m.key === mode)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          <VideoCameraOutlined className="mr-2 text-primary" />
          高清视频
        </h2>
        <p className="mt-1 text-sm text-gray-500">视频高清修复与增强：画质提升、智能补帧、去噪锐化</p>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'create',
            label: '高清修复',
            children: (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card title="上传视频" className="!border-0 shadow-sm">
                  <Upload.Dragger beforeUpload={handleUpload} showUploadList={false} accept="video/*" className="!border-0">
                    {fileUrl ? (
                      <div>
                        <video src={fileUrl} className="mx-auto max-h-48 rounded-lg" controls />
                        <p className="mt-2 text-xs text-primary">点击更换视频</p>
                      </div>
                    ) : (
                      <div className="py-8">
                        <InboxOutlined className="text-4xl text-gray-300" />
                        <p className="mt-2 text-sm text-gray-500">点击或拖拽上传视频</p>
                        <p className="mt-1 text-xs text-gray-300">支持 MP4/MOV 格式，最大 500MB</p>
                      </div>
                    )}
                  </Upload.Dragger>
                </Card>

                <Card title="增强设置" className="!border-0 shadow-sm">
                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-xs font-medium text-gray-600">修复模式</label>
                      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} className="w-full">
                        {modes.length ? (
                          modes.map((m) => (
                            <Radio.Button key={m.key} value={m.key} className="!w-1/2 !text-center">
                              {m.name}
                              <span className="ml-1 text-[10px] text-gray-400">{m.desc}</span>
                            </Radio.Button>
                          ))
                        ) : (
                          <>
                            <Radio.Button value="standard" className="!w-1/2 !text-center">标清修复</Radio.Button>
                            <Radio.Button value="pro" className="!w-1/2 !text-center">高清修复</Radio.Button>
                          </>
                        )}
                      </Radio.Group>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                      <p>增强功能包括：智能降噪、细节锐化、色彩优化、智能补帧</p>
                    </div>
                    <Divider className="!my-2" />
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>预计消耗</span>
                      <Tag color="purple">{currentMode?.cost || 20} 点/次</Tag>
                    </div>
                    <Button type="primary" size="large" block loading={loading} onClick={handleEnhance} icon={<ThunderboltOutlined />}>
                      开始修复
                    </Button>
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: 'record',
            label: <span><HistoryOutlined /> 修复记录 ({records.length})</span>,
            children: (
              <Card className="!border-0 shadow-sm">
                {records.length ? (
                  <Table
                    rowKey="id"
                    dataSource={records}
                    pagination={false}
                    columns={[
                      { title: '任务名称', dataIndex: 'name' },
                      { title: '模式', dataIndex: 'mode', render: (m: string) => <Tag>{m === 'pro' ? '高清修复' : '标清修复'}</Tag> },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        render: (s: string, r: any) =>
                          s === 'success' ? (
                            <Tag color="success">已完成</Tag>
                          ) : s === 'pending' ? (
                            <Progress percent={r.progress || 50} size="small" style={{ width: 80, margin: 0 }} />
                          ) : (
                            <Tag color="error">失败</Tag>
                          ),
                      },
                      { title: '创建时间', dataIndex: 'created_at' },
                    ]}
                  />
                ) : (
                  <Empty description="暂无修复记录" className="py-12" />
                )}
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
