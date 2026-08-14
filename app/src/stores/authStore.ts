import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase/client'

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_anonymous: boolean
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  init: () => Promise<void>
  signUp: (email: string, password: string, username: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  signInAnonymously: (nickname: string) => Promise<string | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<string | null>
  refreshProfile: () => Promise<void>
}

function humanError(message: string): string {
  const map: [RegExp, string][] = [
    [/invalid login credentials/i, '邮箱或密码错误'],
    [/user already registered/i, '该邮箱已注册'],
    [/email not confirmed/i, '请先前往邮箱完成验证'],
    [/password should be at least/i, '密码至少需要6位'],
    [/rate limit/i, '操作过于频繁，请稍后再试'],
    [/anonymous sign-ins are disabled/i, '游客登录未启用，请联系管理员'],
    [/failed to fetch|network/i, '网络连接失败，请检查网络'],
  ]
  for (const [re, msg] of map) if (re.test(message)) return msg
  return message
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  error: null,

  init: async () => {
    const { data } = await supabase.auth.getSession()
    set({ session: data.session, loading: false })
    if (data.session) await get().refreshProfile()
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session })
      if (session) void get().refreshProfile()
      else set({ profile: null })
    })
  },

  refreshProfile: async () => {
    const session = get().session
    if (!session) return
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, is_anonymous')
      .eq('id', session.user.id)
      .maybeSingle()
    if (data) set({ profile: data as Profile })
  },

  signUp: async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    })
    if (error) return humanError(error.message)
    if (data.session) {
      set({ session: data.session })
      await get().refreshProfile()
    }
    return null
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return humanError(error.message)
    set({ session: data.session })
    await get().refreshProfile()
    return null
  },

  signInAnonymously: async (nickname) => {
    const { data, error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: nickname, username: null } },
    })
    if (error) return humanError(error.message)
    set({ session: data.session })
    // profile row is created by trigger; update display name
    if (data.session) {
      await supabase
        .from('profiles')
        .update({ display_name: nickname })
        .eq('id', data.session.user.id)
      await get().refreshProfile()
    }
    return null
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null })
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    return error ? humanError(error.message) : null
  },
}))
