import { create } from 'zustand'
import { supabase } from '../lib/supabase/client'
import type { MatchmakingStatus } from '../types/combat'
import { MatchChannel } from '../game/networking/matchChannel'

export interface MatchInfo {
  matchId: string
  opponentId: string
  opponentName: string
  opponentFighterId: string
  myFighterId: string
  isHost: boolean
  startedAtMs: number | null
}

interface MatchStoreState {
  status: MatchmakingStatus
  error: string | null
  match: MatchInfo | null
  channel: MatchChannel | null
  queueWaitSeconds: number
  startQueue: (userId: string, fighterId: string) => Promise<void>
  cancelQueue: (userId: string) => Promise<void>
  clearMatch: () => Promise<void>
  markActive: () => Promise<void>
  exitMatch: (userId: string, reason: string) => Promise<void>
}

interface MatchRow {
  id: string
  player_one_id: string
  player_two_id: string
  player_one_fighter_id: string
  player_two_fighter_id: string
  host_player_id: string
  status: string
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let waitTimer: ReturnType<typeof setInterval> | null = null

async function buildMatchInfo(row: MatchRow, userId: string): Promise<MatchInfo> {
  const isPlayerOne = row.player_one_id === userId
  const opponentId = isPlayerOne ? row.player_two_id : row.player_one_id
  const { data: opp } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', opponentId)
    .maybeSingle()
  return {
    matchId: row.id,
    opponentId,
    opponentName: (opp?.display_name || opp?.username || '神秘对手') as string,
    opponentFighterId: isPlayerOne ? row.player_two_fighter_id : row.player_one_fighter_id,
    myFighterId: isPlayerOne ? row.player_one_fighter_id : row.player_two_fighter_id,
    isHost: row.host_player_id === userId,
    startedAtMs: null,
  }
}

export const useMatchStore = create<MatchStoreState>((set, get) => ({
  status: 'idle',
  error: null,
  match: null,
  channel: null,
  queueWaitSeconds: 0,

  startQueue: async (userId, fighterId) => {
    set({ status: 'queued', error: null, queueWaitSeconds: 0 })
    waitTimer = setInterval(() => set((s) => ({ queueWaitSeconds: s.queueWaitSeconds + 1 })), 1000)

    const tryMatch = async () => {
      const { data, error } = await supabase.rpc('try_matchmake', {
        p_fighter_id: fighterId,
      })
      if (error) {
        set({ status: 'idle', error: `匹配失败: ${error.message}` })
        stopTimers()
        return
      }
      const rows = data as MatchRow[] | MatchRow | null
      const row = Array.isArray(rows) ? rows[0] : rows
      if (row && row.id) {
        stopTimers()
        const info = await buildMatchInfo(row, userId)
        const channel = new MatchChannel(info.matchId, userId)
        try {
          await channel.join()
        } catch (e) {
          set({ status: 'idle', error: (e as Error).message })
          return
        }
        set({ status: 'matched', match: info, channel })
      }
    }

    await tryMatch()
    if (get().status === 'queued') {
      pollTimer = setInterval(() => {
        if (get().status !== 'queued') {
          stopTimers()
          return
        }
        void tryMatch()
      }, 2500)
    }
  },

  cancelQueue: async (userId) => {
    stopTimers()
    await supabase.from('matchmaking_queue').delete().eq('player_id', userId)
    set({ status: 'idle', queueWaitSeconds: 0 })
  },

  markActive: async () => {
    const m = get().match
    if (!m) return
    set({ status: 'active' })
    if (m.isHost) {
      await supabase.rpc('mark_match_started', { p_match_id: m.matchId })
    }
  },

  exitMatch: async (userId, reason) => {
    const m = get().match
    const ch = get().channel
    set({ status: 'leaving' })
    if (m) {
      await supabase.rpc('end_match', { p_match_id: m.matchId, p_reason: reason }).then(
        () => undefined,
        () => undefined,
      )
    }
    if (ch) await ch.leave()
    await supabase.from('matchmaking_queue').delete().eq('player_id', userId)
    set({ status: 'idle', match: null, channel: null, queueWaitSeconds: 0 })
  },

  clearMatch: async () => {
    const ch = get().channel
    if (ch) await ch.leave()
    stopTimers()
    set({ status: 'idle', match: null, channel: null, queueWaitSeconds: 0 })
  },
}))

function stopTimers() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (waitTimer) {
    clearInterval(waitTimer)
    waitTimer = null
  }
}
