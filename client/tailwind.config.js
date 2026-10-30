/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#8B5CF6',
        gray1: '#666666',
        gray2: '#999999',
        gray3: '#cccccc',
        // AI素材场 暗夜紫体系
        mf: {
          bg: '#0A0714',        // 页面底色
          card: '#120D20',      // 卡片
          card2: '#0D0918',     // 深卡片/输入区
          panel: '#141021',     // 弹窗/面板
          border: '#2A2140',    // 主边框
          border2: '#221A38',   // 次级边框
          hover: '#3A2F5A',     // 悬停边框
          text: '#E6E1F5',      // 主文本
          sub: '#9D8FD0',       // 次级文本
          dim: '#7D74A3',       // 弱文本
          faint: '#5B5280',     // 占位/最弱
          accent: '#C4B5FD',    // 强调紫
          gold: '#EABB5C',      // VIP金
        },
      },
    },
  },
  plugins: [],
}
