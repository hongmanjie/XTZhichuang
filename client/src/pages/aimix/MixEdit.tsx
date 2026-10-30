import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Empty, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { api } from '../../api/request'

type Entry = { id?: number; name?: string; duration?: number }

export default function MixEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [timeline, setTimeline] = useState<Entry[]>([])

  useEffect(() => {
    if (!id) return
    api.mixDetail(Number(id)).then((project: any) => {
      setName(project.name || '')
      try {
        let saved = project.timeline
        if (typeof saved === 'string') saved = JSON.parse(saved)
        if (typeof saved === 'string') saved = JSON.parse(saved)
        setTimeline(Array.isArray(saved) ? saved : [])
      } catch { setTimeline([]) }
    }).catch(() => message.error('项目不存在或无权查看'))
  }, [id])

  return (
    <div className="mx-auto max-w-4xl">
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ai-mix')}>返回项目列表</Button>
      <div className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-800">{name || '历史剪辑项目'}</h1>
        <p className="mt-3 text-sm leading-6 text-amber-700">真实混剪、预览和导出尚未接入，当前仅展示保存过的项目记录。历史片段名称和时长不代表已有可播放的视频素材。</p>
        <h2 className="mb-3 mt-6 font-medium">已保存的片段记录</h2>
        {timeline.length ? <div className="space-y-2">{timeline.map((entry, index) => <div key={`${entry.id || index}-${index}`} className="flex justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600"><span>{entry.name || `片段 ${index + 1}`}</span><span>{typeof entry.duration === 'number' ? `${entry.duration} 秒` : '时长未知'}</span></div>)}</div> : <Empty description="没有保存片段记录" />}
      </div>
    </div>
  )
}
