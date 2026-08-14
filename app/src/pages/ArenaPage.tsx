import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PhaserArena from '../components/PhaserArena'
import TouchControls from '../components/TouchControls'
import { useAuthStore } from '../stores/authStore'
import { useMatchStore } from '../stores/matchStore'
import { getPresetById } from '../lib/presets'
import { loadFighterById } from '../lib/supabase/fighters'
import { supabase } from '../lib/supabase/client'
import type { FighterManifest } from '../types/fighter'
import type { ArenaScene } from '../game/scenes/ArenaScene'
import type { KeyboardInput } from '../game/input/keyboard'
import { playSfx } from '../game/audio/sfx'

async function resolveFighter(id: string): Promise<FighterManifest> {
  const preset = getPresetById(id)
  if (preset) return preset
  return loadFighterById(id)
}

export default function ArenaPage() {
  const navigate = useNavigate()
  const { session, profile } = useAuthStore()
  const { match, channel, markActive, exitMatch } = useMatchStore()
  const [fighters, setFighters] = useState<{ mine: FighterManifest; theirs: FighterManifest } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ping, setPing] = useState<number | null>(null)
  const [exitReason, setExitReason] = useState<'self' | 'opponent' | 'disconnect' | null>(null)
  const [keyboard, setKeyboard] = useState<KeyboardInput | null>(null)
  const autoFriendTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    if (!match) {
      navigate('/')
      return
    }
    void (async () => {
      try {
        const [mine, theirs] = await Promise.all([
          resolveFighter(match.myFighterId),
          resolveFighter(match.opponentFighterId),
        ])
        setFighters({ mine, theirs })
      } catch (e) {
        setLoadError(`Failed to load fighter assets: ${(e as Error).message}`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.matchId])

  useEffect(
    () => () => {
      if (autoFriendTimer.current) clearTimeout(autoFriendTimer.current)
    },
    [],
  )

  const config = useMemo(() => {
    if (!match || !fighters || !userId) return null
    return {
      mode: 'online' as const,
      localPlayerId: userId,
      remotePlayerId: match.opponentId,
      localFighter: fighters.mine,
      remoteFighter: fighters.theirs,
      localName: profile?.display_name || profile?.username || 'Me',
      remoteName: match.opponentName,
      isHost: match.isHost,
      channel: channel ?? undefined,
      onPing: (ms: number) => setPing(ms),
      onActiveStart: () => {
        void markActive()
        // after 60s of active fighting, ask server to auto-friend (server re-verifies)
        if (!profile?.is_anonymous) {
          autoFriendTimer.current = setTimeout(() => {
            void supabase
              .rpc('auto_friend_from_match', { p_match_id: match.matchId })
              .then(({ data }) => {
                if (data === true) playSfx('match_found')
              })
          }, 61_000)
        }
      },
      onExit: (reason: 'self' | 'opponent' | 'disconnect') => {
        setExitReason(reason)
        if (userId) void exitMatch(userId, reason)
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.matchId, fighters, userId])

  if (exitReason) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="panel w-full max-w-md text-center">
          <div className="mb-3 text-3xl font-black text-arcade-cyan">Match over</div>
          <div className="mb-4 text-sm text-gray-400">
            {exitReason === 'self' && 'You left the match'}
            {exitReason === 'opponent' && 'Your opponent left the match'}
            {exitReason === 'disconnect' && 'Connection lost, match ended'}
          </div>
          <button
            className="btn-primary w-full text-lg"
            onClick={() => {
              playSfx('click')
              navigate('/')
            }}
          >
            Back to lobby
          </button>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="panel w-full max-w-md text-center">
          <div className="mb-3 text-red-300">{loadError}</div>
          <button
            className="btn-primary w-full"
            onClick={() => {
              if (userId) void exitMatch(userId, 'load_error')
              navigate('/')
            }}
          >
            Back to lobby
          </button>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-2xl font-black text-arcade-cyan animate-pulse">Loading match...</div>
        <div className="text-sm text-gray-500">Loading fighter assets</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black">
      <PhaserArena config={config} onSceneReady={(scene: ArenaScene) => setKeyboard(scene.keyboard)} />
      <TouchControls keyboard={keyboard} />
      <div className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-black/60 px-2 py-1 text-xs text-gray-400">
        {ping !== null ? `Ping ${ping}ms` : 'Connecting...'}
      </div>
    </div>
  )
}
