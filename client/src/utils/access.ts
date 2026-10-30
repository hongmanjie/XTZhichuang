import { useUserStore } from '../stores/userStore'

// 与服务端 adminRequired 对齐：role_id 1=超级管理员，2=管理员。
// 角色的 permissions 配置目前后端并未消费，前端不以它做判定。
export const isAdminRole = (roleId?: number) => roleId === 1 || roleId === 2

export function useIsAdmin() {
  return useUserStore((s) => isAdminRole(s.userInfo?.role_id))
}
