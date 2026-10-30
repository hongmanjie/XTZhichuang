/**
 * 兴图智创品牌 Logo（SVG 渐变兴字标）
 * 紫罗兰渐变圆角方块 + 白色「兴」字 + 光效，融合全局暗夜紫主题
 */
export default function BrandLogo({ size = 28, radius = 8, className = '' }: { size?: number; radius?: number; className?: string }) {
  const id = `xtg${size}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="兴图智创">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* 底板 */}
      <rect x="1" y="1" width="62" height="62" rx={radius + 4} fill={`url(#${id}-bg)`} />
      <rect x="1" y="1" width="62" height="34" rx={radius + 4} fill={`url(#${id}-sheen)`} />
      {/* 分镜框（电商广告视频分镜意象：底部三条渐暗分格） */}
      <g opacity="0.5" fill="#ffffff">
        <rect x="10" y="52" width="12" height="3" rx="1.5" />
        <rect x="26" y="52" width="12" height="3" rx="1.5" opacity="0.7" />
        <rect x="42" y="52" width="12" height="3" rx="1.5" opacity="0.4" />
      </g>
      {/* 兴字（下部两点化作創作星火） */}
      <g fill="#ffffff" filter={`url(#${id}-glow)`}>
        {/* 三横 */}
        <rect x="16" y="14" width="32" height="5" rx="2.5" />
        <rect x="19" y="24" width="26" height="5" rx="2.5" />
        <rect x="22" y="34" width="20" height="5" rx="2.5" />
        {/* 八部两点 */}
        <path d="M18 42 L24 46 L22.5 50 L16.5 46 Z" />
        <path d="M46 42 L40 46 L41.5 50 L47.5 46 Z" />
      </g>
    </svg>
  )
}
