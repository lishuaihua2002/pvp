import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useMatchStore } from '../stores/matchStore'
import { getPresetFighters } from '../lib/presets'
import type { FighterManifest } from '../types/fighter'
import { listMyFighters, getSelectedFighterId, setSelectedFighterId, deleteFighter } from '../lib/supabase/fighters'
import { initAudio, playSfx, getAudioSettings, setAudioSettings } from '../game/audio/sfx'
import FriendsPanel from '../components/FriendsPanel'
import QRCodePanel from '../components/QRCodePanel'

export default function LobbyPage() {
  const navigate = useNavigate()
  const { session, profile, signOut } = useAuthStore()
  const { status, error, queueWaitSeconds, startQueue, cancelQueue } = useMatchStore()
  const presets = useMemo(() => getPresetFighters(), [])
  const [myFighters, setMyFighters] = useState<FighterManifest[]>([])
  const [selected, setSelected] = useState<string>(presets[0].id)
  const [muted, setMuted] = useState(!getAudioSettings().enabled)
  const [showFriends, setShowFriends] = useState(false)
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    void (async () => {
      try {
        const [fighters, sel] = await Promise.all([
          listMyFighters(userId),
          getSelectedFighterId(userId),
        ])
        setMyFighters(fighters)
        if (sel) setSelected(sel)
      } catch {
        // network / not configured: presets still usable
      }
    })()
  }, [userId])

  useEffect(() => {
    if (status === 'matched') {
      playSfx('match_found')
      navigate('/arena')
    }
  }, [status, navigate])

  const allFighters = [...presets, ...myFighters]
  const displayName = profile?.display_name || profile?.username || '玩家'

  const selectFighter = (id: string) => {
    initAudio()
    playSfx('click')
    setSelected(id)
    if (userId) void setSelectedFighterId(userId, id).catch(() => undefined)
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-4 overflow-y-auto">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-black">
            <span className="text-arcade-accent">照片</span>
            <span className="text-arcade-cyan">格斗</span>
          </div>
          <div className="text-sm text-gray-400">
            {displayName}
            {profile?.is_anonymous && <span className="ml-2 rounded bg-arcade-border px-1.5 py-0.5 text-xs">游客</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() => {
              setAudioSettings({ enabled: muted })
              setMuted(!muted)
            }}
          >
            {muted ? '🔇 音效关' : '🔊 音效开'}
          </button>
          <button className="btn-secondary" onClick={() => setShowFriends((v) => !v)}>
            好友
          </button>
          <button
            className="btn-warn"
            onClick={() => {
              playSfx('click')
              void signOut()
            }}
          >
            登出
          </button>
        </div>
      </header>

      {error && <div className="rounded-lg bg-red-900/40 border border-red-600 p-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-arcade-cyan">选择你的角色</h2>
            <Link className="btn-secondary" to="/editor">
              📷 用照片创建角色
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {allFighters.map((f) => (
              <button
                key={f.id}
                className={`rounded-xl border-2 p-3 text-left transition ${
                  selected === f.id
                    ? 'border-arcade-accent bg-arcade-accent/10'
                    : 'border-arcade-border bg-black/20 hover:border-arcade-cyan'
                }`}
                onClick={() => selectFighter(f.id)}
              >
                {f.thumbnailUrl ? (
                  <img src={f.thumbnailUrl} alt={f.name} className="mb-2 h-24 w-full rounded-lg object-contain bg-black/40" />
                ) : (
                  <div className="mb-2 flex h-24 items-center justify-center rounded-lg bg-black/40 text-3xl">🥊</div>
                )}
                <div className="truncate font-bold">{f.name}</div>
                <div className="text-xs text-gray-500">{f.preset ? '预设角色' : '我的角色'}</div>
                {!f.preset && userId && (
                  <span
                    role="button"
                    className="mt-1 inline-block text-xs text-red-400 hover:text-red-300"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteFighter(f.id, userId).then(() =>
                        setMyFighters((list) => list.filter((x) => x.id !== f.id)),
                      )
                    }}
                  >
                    删除
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {status === 'queued' ? (
              <button
                className="btn-warn flex-1 text-lg"
                onClick={() => {
                  playSfx('click')
                  if (userId) void cancelQueue(userId)
                }}
              >
                匹配中... {queueWaitSeconds}s（点击取消）
              </button>
            ) : (
              <button
                className="btn-primary flex-1 text-lg"
                onClick={() => {
                  initAudio()
                  playSfx('match_start')
                  if (userId) void startQueue(userId, selected)
                }}
              >
                ⚔️ 开始在线匹配
              </button>
            )}
            <Link
              className="btn-secondary flex-1 text-center text-lg"
              to="/local-test"
              onClick={() => {
                initAudio()
                playSfx('click')
              }}
            >
              🕹️ 本地双人试玩
            </Link>
          </div>
          <div className="mt-3 text-center text-xs text-gray-500">
            键位：A/D 移动 · W/空格 跳跃 · J 出拳 · K 扫腿 · Esc 退出
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {showFriends && userId && !profile?.is_anonymous && <FriendsPanel userId={userId} />}
          {showFriends && profile?.is_anonymous && (
            <div className="panel text-sm text-gray-400">游客暂不支持好友功能，注册账号后可用。</div>
          )}
          <QRCodePanel />
        </div>
      </div>
    </div>
  )
}
