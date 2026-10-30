import { useEffect, useState } from 'react'
import { Tag, Tooltip } from 'antd'
import { CloudOutlined, DisconnectOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { withBase } from '../utils/base'

// ES连接 + AI引擎状态徽标
export function ESStatusBadge() {
  const [esOk, setEsOk] = useState<boolean | null>(null)
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const data = await fetch(withBase('/api/es/status')).then((r) => r.json())
        setEsOk(data?.data?.available === true)
      } catch {
        setEsOk(false)
      }
      try {
        const data = await fetch(withBase('/api/ai/status')).then((r) => r.json())
        setAiEnabled(data?.data?.enabled === true)
      } catch {
        setAiEnabled(false)
      }
    }
    check()
    const timer = setInterval(check, 15000)
    return () => clearInterval(timer)
  }, [])

  if (esOk === null && aiEnabled === null) return null

  return (
    <span className="flex items-center gap-1">
      <Tooltip title={esOk ? 'Elasticsearch已连接：关键词+语义向量混合检索' : 'Elasticsearch未连接，搜索降级为关键词匹配'}>
        <Tag
          icon={esOk ? <CloudOutlined /> : <DisconnectOutlined />}
          color={esOk ? 'green' : 'orange'}
          className="!cursor-default"
        >
          {esOk ? 'ES已连接' : 'ES未连接'}
        </Tag>
      </Tooltip>
      {aiEnabled !== null && (
        <Tooltip title={aiEnabled ? '真实AI引擎已启用（ModelGate 兴图自建算力：Qwen3.6对话/Qwen图像/MiniMax H3音视频/向量/重排），异常时自动降级本地模拟' : '真实AI未启用，当前使用本地模拟引擎'}>
          <Tag
            icon={aiEnabled ? <ThunderboltOutlined /> : <RobotOutlined />}
            color={aiEnabled ? 'geekblue' : 'default'}
            className="!cursor-default"
          >
            {aiEnabled ? '真实AI引擎' : '模拟引擎'}
          </Tag>
        </Tooltip>
      )}
    </span>
  )
}
