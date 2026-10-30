/**
 * 品牌 Logo（横版 SVG 标志，宽高比约 2.1:1，资源位于 public/images/logo.svg）
 * size 控制高度，宽度按原始比例自适应
 */
import { withBase } from '../utils/base'

export default function BrandLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={withBase('/images/logo.svg')}
      alt="兴图AI视频创作平台"
      height={size}
      style={{ height: size, width: 'auto' }}
      className={className}
      draggable={false}
    />
  )
}
