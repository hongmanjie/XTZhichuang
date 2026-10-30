import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#8B5CF6',
          colorInfo: '#8B5CF6',
          colorLink: '#A78BFA',
          colorBgBase: '#0A0714',
          colorBgContainer: '#141021',
          colorBgElevated: '#1A1330',
          colorBorder: '#2A2140',
          colorBorderSecondary: '#221A38',
          colorText: '#E6E1F5',
          colorTextSecondary: '#9D8FD0',
          colorTextTertiary: '#7D74A3',
          colorTextQuaternary: '#5B5280',
          borderRadius: 8,
        },
        components: {
          Table: { headerBg: '#0D0918', rowHoverBg: 'rgba(124,58,237,.08)' },
          Card: { colorBgContainer: '#120D20' },
          Modal: { contentBg: '#141021', headerBg: '#141021' },
          Drawer: { colorBgElevated: '#141021' },
          Tabs: { itemColor: '#7D74A3', itemSelectedColor: '#C4B5FD', inkBarColor: '#8B5CF6' },
          Menu: { darkItemBg: 'transparent' },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
