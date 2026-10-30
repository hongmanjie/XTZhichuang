import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Button, Checkbox, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { api } from '../api/request'
import { useUserStore } from '../stores/userStore'
import BrandLogo from '../components/BrandLogo'

export default function Login() {
  const navigate = useNavigate()
  const { setAuth } = useUserStore()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [siteName, setSiteName] = useState('兴图智创')
  const [slogan, setSlogan] = useState('电商广告视频 · AI分镜智创')

  useEffect(() => {
    document.title = '兴图智创 - AIGC视频分镜AI创作平台'
    api.loginInit().then((data: any) => {
      if (data) {
        setSiteName(data.siteName || siteName)
        setSlogan(data.slogan || slogan)
      }
    }).catch(() => {})
  }, [])

  // 已登录跳转
  useEffect(() => {
    if (localStorage.getItem('token')) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate])

  const handleLogin = async () => {
    if (!account.trim()) return message.warning('请输入账号')
    if (!password.trim()) return message.warning('请输入密码')
    setLoading(true)
    try {
      const data = await api.login({ account: account.trim(), password })
      setAuth(data.token, data.userInfo)
      message.success('登录成功')
      navigate('/dashboard', { replace: true })
    } catch (e: any) {
      // 错误提示已在拦截器处理
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[url('/images/login-bg.png')] bg-cover bg-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/20" />

      {/* 登录卡片 */}
      <div className="relative z-10 w-[400px] rounded-2xl border border-mf-border bg-[#120D20]/90 p-8 shadow-[0_0_60px_rgba(124,58,237,0.35)] backdrop-blur">
        {/* Logo与标题 */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo size={48} radius={12} className="shadow-[0_0_20px_rgba(139,92,246,0.5)] rounded-xl" />
          <h1 className="text-2xl font-bold text-mf-text">{siteName}</h1>
          <p className="text-sm text-mf-dim">{slogan}</p>
        </div>

        {/* 登录表单 */}
        <div className="space-y-4">
          <div className="relative">
            <UserOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
            <Input
              size="large"
              placeholder="请输入账号（手机号）"
              className="!pl-9"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onPressEnter={handleLogin}
              maxLength={20}
            />
          </div>
          <div className="relative">
            <LockOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
            <Input.Password
              size="large"
              placeholder="请输入密码"
              className="!pl-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onPressEnter={handleLogin}
            />
          </div>

          <div className="flex items-center justify-between">
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
              <span className="text-xs text-mf-dim">记住我</span>
            </Checkbox>
            <a className="text-xs text-mf-accent hover:opacity-80" href="#">忘记密码？</a>
          </div>

          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={handleLogin}
            className="mf-btn-gradient !h-11 !text-base !font-medium !border-0"
          >
            登 录
          </Button>
        </div>

        {/* 底部提示 */}
        <div className="mt-6 text-center text-xs text-mf-faint">
          <p>请使用管理员分配的账号登录</p>
          <p className="mt-1">AIGC 视频分镜创作平台 · 电商广告智创引擎</p>
        </div>
      </div>

      {/* 底部版权 */}
      <div className="absolute bottom-6 left-0 right-0 text-center text-xs text-white/70">
        © 2026 兴图智创 XingTu Studio · 电商广告视频 AI分镜智创
      </div>
    </div>
  )
}
