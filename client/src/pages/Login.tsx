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
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nickname, setNickname] = useState('')
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

  const handleRegister = async () => {
    const phone = account.trim()
    if (!/^1[3-9]\d{9}$/.test(phone)) return message.warning('请输入正确的 11 位手机号')
    if (password.length < 6 || password.length > 32) return message.warning('密码长度为 6-32 位')
    if (password !== confirm) return message.warning('两次输入的密码不一致')
    setLoading(true)
    try {
      const data = await api.register({ phone, password, name: nickname.trim() || undefined })
      setAuth(data.token, data.userInfo)
      message.success('注册成功，新用户赠送 500 AI 点数')
      navigate('/dashboard', { replace: true })
    } catch (e: any) {
      // 错误提示已在拦截器处理
    } finally {
      setLoading(false)
    }
  }

  const isRegister = mode === 'register'
  const submit = () => (isRegister ? handleRegister() : handleLogin())

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[url('/images/login-bg.png')] bg-cover bg-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/20" />

      {/* 登录/注册卡片 */}
      <div className="relative z-10 w-[400px] rounded-2xl border border-mf-border bg-[#120D20]/90 p-8 shadow-[0_0_60px_rgba(124,58,237,0.35)] backdrop-blur">
        {/* Logo与标题 */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo size={48} radius={12} className="shadow-[0_0_20px_rgba(139,92,246,0.5)] rounded-xl" />
          <h1 className="text-2xl font-bold text-mf-text">{siteName}</h1>
          <p className="text-sm text-mf-dim">{slogan}</p>
        </div>

        {/* 表单 */}
        <div className="space-y-4">
          <div className="relative">
            <UserOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
            <Input
              size="large"
              placeholder={isRegister ? '请输入手机号' : '请输入账号（手机号）'}
              className="!pl-9"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onPressEnter={submit}
              maxLength={11}
            />
          </div>
          <div className="relative">
            <LockOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
            <Input.Password
              size="large"
              placeholder={isRegister ? '设置密码（6-32 位）' : '请输入密码'}
              className="!pl-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onPressEnter={submit}
              maxLength={32}
            />
          </div>
          {isRegister && (
            <>
              <div className="relative">
                <LockOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
                <Input.Password
                  size="large"
                  placeholder="确认密码"
                  className="!pl-9"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onPressEnter={submit}
                  maxLength={32}
                />
              </div>
              <div className="relative">
                <UserOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-faint z-10" />
                <Input
                  size="large"
                  placeholder="昵称（选填）"
                  className="!pl-9"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onPressEnter={submit}
                  maxLength={20}
                />
              </div>
            </>
          )}

          {!isRegister && (
            <div className="flex items-center justify-between">
              <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
                <span className="text-xs text-mf-dim">记住我</span>
              </Checkbox>
              <a className="text-xs text-mf-accent hover:opacity-80" href="#">忘记密码？</a>
            </div>
          )}

          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={submit}
            className="mf-btn-gradient !h-11 !text-base !font-medium !border-0"
          >
            {isRegister ? '注 册' : '登 录'}
          </Button>

          <div className="text-center">
            <a
              className="text-xs text-mf-accent hover:opacity-80"
              onClick={() => { setMode(isRegister ? 'login' : 'register'); setConfirm('') }}
            >
              {isRegister ? '已有账号？直接登录' : '没有账号？立即注册'}
            </a>
          </div>
        </div>

        {/* 底部提示 */}
        <div className="mt-6 text-center text-xs text-mf-faint">
          {isRegister ? (
            <p>注册即赠送 500 AI 点数，注册表示同意平台使用条款</p>
          ) : (
            <>
              <p>请使用管理员分配的账号登录</p>
              <p className="mt-1">AIGC 视频分镜创作平台 · 电商广告智创引擎</p>
            </>
          )}
        </div>
      </div>

      {/* 底部版权 */}
      <div className="absolute bottom-6 left-0 right-0 text-center text-xs text-white/70">
        © 2026 兴图智创 XingTu Studio · 电商广告视频 AI分镜智创
      </div>
    </div>
  )
}
