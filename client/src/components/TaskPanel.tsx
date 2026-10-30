import { useEffect, useState, useRef } from 'react'
import { Button, Spin, Tag, Space, Modal, Image, Tooltip } from 'antd'
import {
  ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ReloadOutlined, VideoCameraOutlined, PictureOutlined, DownloadOutlined,
  RobotOutlined, AudioOutlined, FontSizeOutlined,
} from '@ant-design/icons'
import { api } from '../api/request'

interface TaskPanelProps {
  taskId: number | null
  onClose: () => void
  onRetry: (id: number) => void
  onDelete: (id: number) => void
}

// AI任务进度面板（轮询任务状态）
export default function TaskPanel({ taskId, onClose, onRetry, onDelete }: TaskPanelProps) {
  const [task, setTask] = useState<any>(null)
  const timerRef = useRef<any>(null)

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      return
    }
    const fetch = async () => {
      try {
        const data = await api.taskDetail(taskId)
        setTask(data)
        if (['success', 'failed', 'canceled', 'reconciling'].includes(data.status)) {
          clearInterval(timerRef.current)
        }
      } catch {}
    }
    fetch()
    timerRef.current = setInterval(fetch, 1000)
    return () => clearInterval(timerRef.current)
  }, [taskId])

  // 重试：清旧定时器 → 调接口 → 重置状态 → 重启轮询
  const handleRetry = async (id: number) => {
    try {
      await onRetry(id)
      clearInterval(timerRef.current)
      setTask(null)
      const fetch = async () => {
        try {
          const data = await api.taskDetail(id)
          setTask(data)
          if (['success', 'failed', 'canceled', 'reconciling'].includes(data.status)) {
            clearInterval(timerRef.current)
          }
        } catch {}
      }
      fetch()
      timerRef.current = setInterval(fetch, 1000)
    } catch { /* ignore */ }
  }

  if (!task) return null

  const isDone = task.status === 'success' || task.status === 'failed' || task.status === 'canceled'
  const moduleNames: Record<string, string> = {
    replica: '爆款复刻', factory: 'AI梦工厂', studio: 'AI商拍',
    materialField: 'AI素材场', analysis: '视频解析', human: '百变数字人',
    humanAsset: '数字人创作资产',
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ThunderboltOutlined className="text-primary" />
          <span className="text-sm font-medium text-gray-700">{task.title || moduleNames[task.module]}</span>
          <Tag className="!text-[10px]">{task.task_no}</Tag>
        </div>
        <Space>
          {task.status === 'failed' && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(task.id)}>重试</Button>
          )}
          {isDone && (
            <Button size="small" danger onClick={() => { onDelete(task.id); onClose() }}>删除</Button>
          )}
        </Space>
      </div>

      {/* 进度 */}
      {!isDone && task.status !== 'reconciling' && (
        <div className="py-8 text-center">
          <Spin size="large" />
          <p className="mt-4 text-sm text-gray-500">
            {task.stage || (task.status === 'pending' ? '排队等待中' : 'AI正在生成')}
          </p>
          <p className="mt-1 text-xs text-gray-400">耗时取决于模型排队和生成情况，可以离开页面</p>
        </div>
      )}

      {task.status === 'reconciling' && (
        <div className="py-8 text-center text-sm text-amber-700">
          <p>{task.error || '上游任务状态待核对，请勿重复提交。'}</p>
          {task.provider_task_id && <Button className="mt-4" onClick={() => handleRetry(task.id)}>检查上游结果</Button>}
        </div>
      )}

      {/* 失败 */}
      {task.status === 'failed' && (
        <div className="py-8 text-center">
          <CloseCircleOutlined className="text-5xl text-red-400" />
          <p className="mt-4 text-sm text-gray-500">{task.error || '生成失败'}</p>
          <Button className="mt-4" icon={<ReloadOutlined />} onClick={() => handleRetry(task.id)}>重新生成</Button>
        </div>
      )}

      {/* 成功结果 */}
      {task.status === 'success' && task.result && (
        <div>
          <div className="mb-4 flex items-center gap-2 text-sm text-green-600">
            <CheckCircleOutlined /> 生成完成！
            {task.result.engine && (
              <Tooltip title={task.result.engine === 'real' ? '本任务由真实AI引擎生成' : `真实AI异常，已由本地模拟引擎生成：${task.result.fallbackReason || '未知原因'}`}>
                <Tag icon={task.result.engine === 'real' ? <ThunderboltOutlined /> : <RobotOutlined />}
                  color={task.result.engine === 'real' ? 'geekblue' : 'orange'}
                  className="!cursor-default !text-[10px]">
                  {task.result.engine === 'real' ? '真实AI' : '模拟引擎'}
                </Tag>
              </Tooltip>
            )}
            {task.result.subtitle?.dubbed && (
              <Tooltip title={`已合成 TTS 口播配音${task.result.subtitle.voice ? `（音色 #${task.result.subtitle.voice}）` : ''}`}>
                <Tag icon={<AudioOutlined />} color="green" className="!cursor-default !text-[10px]">已配音</Tag>
              </Tooltip>
            )}
            {task.result.subtitle?.burnedCount > 0 && (
              <Tooltip title={`字幕已二次叠加烧录（${task.result.subtitle.burnedCount} 条成片）`}>
                <Tag icon={<FontSizeOutlined />} color="purple" className="!cursor-default !text-[10px]">艺术字幕</Tag>
              </Tooltip>
            )}
          </div>
          {task.result.warnings?.length > 0 && <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{task.result.warnings.join('；')}</div>}

          {/* 视频结果 */}
          {task.result.videos?.length > 0 && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {task.result.videos.map((v: any, i: number) => (
                <div key={i} className="overflow-hidden rounded-xl border border-gray-100">
                  <video src={v.url} controls className="aspect-video w-full bg-black" poster={v.cover || undefined} preload={v.cover ? 'none' : 'metadata'} />
                  <div className="flex items-center justify-between p-2">
                    <span className="truncate text-xs text-gray-600">{v.name}</span>
                    <Button size="small" type="link" href={v.url} target="_blank" icon={<DownloadOutlined />}>
                      下载
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 图片结果 */}
          {task.result.images?.length > 0 && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {task.result.images.map((img: any, i: number) => (
                <div key={i} className="overflow-hidden rounded-xl border border-gray-100">
                  <Image src={img.url} className="aspect-square w-full object-cover" />
                  <div className="p-2">
                    <p className="truncate text-xs text-gray-600">{img.name}</p>
                    <p className="text-[10px] text-gray-400">{img.scene}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 解析报告 */}
          {task.result.analysis?.structure && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">结构拆解</h4>
                <div className="space-y-1">
                  {task.result.analysis.structure.map((s: any, i: number) => (
                    <div key={i} className="flex gap-3 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                      <Tag color="purple" className="!text-[10px]">{s.phase}</Tag>
                      <span className="text-gray-600">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium text-gray-700">话术脚本</h4>
                <div className="overflow-hidden rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr><th className="px-3 py-2 text-left">时间</th><th className="px-3 py-2 text-left">话术</th><th className="px-3 py-2 text-left">景别</th></tr>
                    </thead>
                    <tbody>
                      {task.result.analysis.script.map((s: any, i: number) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-500">{s.time}</td>
                          <td className="px-3 py-2 text-gray-700">{s.text}</td>
                          <td className="px-3 py-2 text-gray-500">{s.shot}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-lg bg-purple-50 p-3">
                <h4 className="mb-1 text-sm font-medium text-purple-700">BGM建议</h4>
                <p className="text-xs text-purple-600">{task.result.analysis.music.suggestion}（{task.result.analysis.music.style} · {task.result.analysis.music.bpm}BPM）</p>
              </div>
            </div>
          )}

          {task.module === 'videoAnalysis' && task.result.analysis && (
            <div className="space-y-2 text-sm text-gray-600"><p>{task.result.analysis.limitation}</p><p>{task.result.analysis.transcript || '未识别到语音文字'}</p><p>详细结果可在“视频解析”页面查看。</p></div>
          )}

          {/* 场景列表（其他模块） */}
          {task.result.scenes?.length > 0 && !task.result.analysis && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-gray-700">生成场景</h4>
              <div className="flex flex-wrap gap-2">
                {task.result.scenes.map((s: any, i: number) => (
                  <Tag key={i} color="purple" className="!px-3 !py-1">{s.name}</Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
