import { create } from 'zustand'

interface UserInfo {
  id: number
  account: string
  name: string
  phone?: string
  avatar?: string
  email?: string
  role_id: number
  roleName?: string
  department_id?: number
  departmentName?: string
  ai_points: number
  vip_level?: string
  vip_expire_at?: string
}

interface UserState {
  token: string | null
  userInfo: UserInfo | null
  setAuth: (token: string, userInfo: UserInfo) => void
  setUserInfo: (userInfo: UserInfo) => void
  logout: () => void
}

// 安全解析：userInfo 被写坏时回退 null，避免启动即白屏
const safeParse = (s: string | null): UserInfo | null => {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

// 唯一存储来源：localStorage（token / userInfo 两个键），避免双层持久化互相复活
export const useUserStore = create<UserState>()((set) => ({
  token: localStorage.getItem('token'),
  userInfo: safeParse(localStorage.getItem('userInfo')),
  setAuth: (token, userInfo) => {
    localStorage.setItem('token', token)
    localStorage.setItem('userInfo', JSON.stringify(userInfo))
    set({ token, userInfo })
  },
  setUserInfo: (userInfo) => {
    localStorage.setItem('userInfo', JSON.stringify(userInfo))
    set({ userInfo })
  },
  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
    set({ token: null, userInfo: null })
  },
}))
