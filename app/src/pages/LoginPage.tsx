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
      if (!nickname.trim()) return 'Please enter a temporary nickname'
      return null
    }
    if (mode === 'forgot') {
      if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email'
      return null
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email'
    if (password.length < 6) return 'Password must be at least 6 characters'
    if (mode === 'register') {
      const u = username.trim()
      if (u.length < 3 || u.length > 20) return 'Username must be 3-20 characters'
      if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(u)) return 'Username may only contain letters, numbers, underscores and CJK characters'
    }
    return null
  }

  const submit = async () => {
    initAudio()
    playSfx('click')
    setError(null)
    setNotice(null)
    if (!supabaseConfigured) {
      setError('Supabase is not configured, so accounts and guest play are unavailable. Try Local Versus instead.')
      return
    }
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
          setNotice('Registered! If email confirmation is required, check your inbox and confirm before logging in.')
          setMode('login')
        }
      } else if (mode === 'guest') {
        err = await signInAnonymously(nickname.trim())
        if (!err) navigate('/')
      } else {
        err = await resetPassword(email)
        if (!err) setNotice('Password reset email sent. Check your inbox.')
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
            <span className="text-arcade-accent">PHOTO</span>
            <span className="text-arcade-cyan">FIGHTER</span>
          </div>
          <div className="mt-2 text-sm text-gray-400">Side-scrolling 1v1 PVP</div>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 rounded-lg bg-yellow-900/40 border border-yellow-600 p-3 text-sm text-yellow-200">
            Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) are not configured,
            so login is unavailable. Try <a className="underline" href="/local-test">Local Versus</a> instead.
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
              {m === 'login' ? 'Log in' : m === 'register' ? 'Register' : 'Guest play'}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'guest' ? (
            <>
              <input
                className="input"
                placeholder="Temporary nickname"
                maxLength={20}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
              <div className="text-xs text-gray-500">
                Guest data is for on-site demos only and may not be recoverable after closing the browser.
              </div>
            </>
          ) : (
            <>
              {mode === 'register' && (
                <input
                  className="input"
                  placeholder="Username (3-20 chars, unique)"
                  maxLength={20}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
              <input
                className="input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== 'forgot' && (
                <input
                  className="input"
                  type="password"
                  placeholder="Password (min 6 characters)"
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
              ? 'Please wait...'
              : mode === 'login'
                ? 'Log in'
                : mode === 'register'
                  ? 'Register'
                  : mode === 'guest'
                    ? 'Quick play'
                    : 'Send reset email'}
          </button>

          {mode === 'login' && (
            <button className="text-sm text-gray-400 hover:text-arcade-cyan" onClick={() => setMode('forgot')}>
              Forgot password?
            </button>
          )}
          {mode === 'forgot' && (
            <button className="text-sm text-gray-400 hover:text-arcade-cyan" onClick={() => setMode('login')}>
              Back to login
            </button>
          )}
        </div>

        <div className="mt-6 border-t border-arcade-border pt-4 text-center text-xs text-gray-500">
          Controls: A/D move · W/Space jump · J punch · K kick · Esc quit
        </div>
      </div>
    </div>
  )
}
