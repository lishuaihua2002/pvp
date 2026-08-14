import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { initAudio, playSfx } from '../game/audio/sfx'
import { supabaseConfigured } from '../lib/supabase/client'

type Mode = 'login' | 'register' | 'guest' | 'forgot'

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn, signUp, signInAnonymously, resetPassword, session } = useAuthStore()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  const validate = (): string | null => {
    if (mode === 'guest') {
      if (!nickname.trim()) return '请输入临时昵称'
      return null
    }
    if (mode === 'forgot') {
      if (!/^\S+@\S+\.\S+$/.test(email)) return '请输入有效邮箱'
      return null
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return '请输入有效邮箱'
    if (password.length < 6) return '密码至少6位'
    if (mode === 'register') {
      const u = username.trim()
      if (u.length < 3 || u.length > 20) return '用户名长度需为3~20个字符'
      if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(u)) return '用户名只能包含中文、字母、数字和下划线'
    }
    return null
  }

  const submit = async () => {
    initAudio()
    playSfx('click')
    setError(null)
    setNotice(null)
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setBusy(true)
    try {
      let err: string | null = null
      if (mode === 'login') {
        err = await signIn(email, password)
        if (!err) navigate('/')
      } else if (mode === 'register') {
        err = await signUp(email, password, username.trim())
        if (!err) {
          setNotice('注册成功！如果需要邮箱验证，请前往邮箱点击确认链接后登录。')
          setMode('login')
        }
      } else if (mode === 'guest') {
        err = await signInAnonymously(nickname.trim())
        if (!err) navigate('/')
      } else {
        err = await resetPassword(email)
        if (!err) setNotice('重置密码邮件已发送，请查收')
      }
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="panel w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-5xl font-black tracking-widest">
            <span className="text-arcade-accent">照片</span>
            <span className="text-arcade-cyan">格斗</span>
          </div>
          <div className="mt-2 text-sm text-gray-400">PHOTO FIGHTER · 横版1v1 PVP</div>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 rounded-lg bg-yellow-900/40 border border-yellow-600 p-3 text-sm text-yellow-200">
            尚未配置Supabase环境变量（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY），
            登录功能不可用。可以先进入 <a className="underline" href="/local-test">本地双人试玩</a>。
          </div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-2">
          {(['login', 'register', 'guest'] as Mode[]).map((m) => (
            <button
              key={m}
              className={m === mode ? 'btn-primary' : 'btn-secondary'}
              onClick={() => {
                initAudio()
                playSfx('click')
                setMode(m)
                setError(null)
              }}
            >
              {m === 'login' ? '登录' : m === 'register' ? '注册' : '游客试玩'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'guest' ? (
            <>
              <input
                className="input"
                placeholder="临时昵称（现场试玩）"
                maxLength={20}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
              <div className="text-xs text-gray-500">
                游客数据仅用于现场试玩，关闭浏览器后可能无法恢复。
              </div>
            </>
          ) : (
            <>
              {mode === 'register' && (
                <input
                  className="input"
                  placeholder="用户名（3~20字符，唯一）"
                  maxLength={20}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
              <input
                className="input"
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== 'forgot' && (
                <input
                  className="input"
                  type="password"
                  placeholder="密码（至少6位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
              )}
            </>
          )}

          {error && <div className="rounded-lg bg-red-900/40 border border-red-600 p-2.5 text-sm text-red-200">{error}</div>}
          {notice && <div className="rounded-lg bg-green-900/40 border border-green-600 p-2.5 text-sm text-green-200">{notice}</div>}

          <button className="btn-primary text-lg" disabled={busy} onClick={() => void submit()}>
            {busy
              ? '请稍候...'
              : mode === 'login'
                ? '登录'
                : mode === 'register'
                  ? '注册'
                  : mode === 'guest'
                    ? '快速进入游戏'
                    : '发送重置邮件'}
          </button>

          {mode === 'login' && (
            <button className="text-sm text-gray-400 hover:text-arcade-cyan" onClick={() => setMode('forgot')}>
              忘记密码？
            </button>
          )}
          {mode === 'forgot' && (
            <button className="text-sm text-gray-400 hover:text-arcade-cyan" onClick={() => setMode('login')}>
              返回登录
            </button>
          )}
        </div>

        <div className="mt-6 border-t border-arcade-border pt-4 text-center text-xs text-gray-500">
          键位：A/D 移动 · W/空格 跳跃 · J 出拳 · K 扫腿 · Esc 退出
        </div>
      </div>
    </div>
  )
}
