// 子路径部署支持:BASE 为构建时注入的部署前缀(vite base,默认 '/')
// withBase 用于静态资源与接口路径;rewriteDataUrl 不用于业务数据,
// 媒体 URL 的前缀统一在渲染点加,保证发给后端的 URL 始终为根绝对路径。
export const BASE = import.meta.env.BASE_URL

// 静态资源/接口路径补部署前缀;外部地址与数据 URL 原样返回
export function withBase(path: string): string
export function withBase(path: string | undefined): string | undefined
export function withBase(path?: string): string | undefined {
  if (!path || /^(https?:|data:|blob:)/.test(path)) return path
  return BASE + path.replace(/^\//, '')
}

// 去掉部署前缀,还原为根绝对路径(需要把 URL 回传给后端时使用)
export function withoutBase(path: string): string {
  if (BASE !== '/' && path.startsWith(BASE)) return '/' + path.slice(BASE.length)
  return path
}
