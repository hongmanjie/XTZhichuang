import { useEffect, useState } from 'react'
import { Card, Tag } from 'antd'
import { api } from '../../api/request'

const AUTHORITIES = [
  { key: 'dashboard', name: '创作中心' },
  { key: 'agent', name: 'AI Agent测试' },
  { key: 'asset-library', name: '资产库' },
  { key: 'hot', name: '爆款创作' },
  { key: 'ai-mix', name: '智能剪辑' },
  { key: 'create', name: 'AI创作' },
  { key: 'material_data', name: '投放数据' },
  { key: 'setting', name: '全部设置' },
  { key: 'team', name: '团队管理' },
  { key: 'partner', name: '合作伙伴' },
]

// 只读展示。角色的 permissions 配置后端并未消费（实际访问控制基于管理员/成员身份），
// 因此不提供新增/编辑/删除入口，避免"配置了却不生效"的误导。
export default function RoleManage() {
  const [list, setList] = useState<any[]>([])

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const data = await api.roles()
    setList(data)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">角色管理</h1>
        <p className="mt-1 text-xs text-gray-400">
          查看系统内置角色。功能访问控制当前由管理员/成员身份决定，此处权限配置暂未启用。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.map((role) => (
          <Card key={role.id} className="!rounded-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-medium text-gray-800">{role.name}</h3>
              {role.code === 'super_admin' && <Tag color="purple">系统内置</Tag>}
            </div>
            <p className="mb-3 text-xs text-gray-400">{role.description}</p>
            <div className="flex flex-wrap gap-1">
              {(role.permissions.includes('all') ? AUTHORITIES : AUTHORITIES.filter((a) => role.permissions.includes(a.key))).map((a) => (
                <Tag key={a.key} className="!text-[10px]">{a.name}</Tag>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
