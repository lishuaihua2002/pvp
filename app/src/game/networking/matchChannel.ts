import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase/client'
import type { CombatInput, RealtimeMessage, RealtimeMessageType, StateSnapshot } from '../../types/combat'

export interface MatchChannelHandlers {
  onInput?: (playerId: string, input: CombatInput) => void
  onSnapshot?: (snapshot: StateSnapshot) => void
  onPlayerExit?: (playerId: string) => void
  onPlayerReady?: (playerId: string) => void
  onAssetsLoaded?: (playerId: string) => void
  onCountdownStart?: (startAt: number) => void
  onPresenceLeave?: (playerId: string) => void
  onPresenceJoin?: (playerId: string) => void
  onPing?: (from: string, t: number) => void
  onPong?: (t: number) => void
}

/** Wraps the private Supabase Realtime channel for one match. */
export class MatchChannel {
  private channel: RealtimeChannel
  private seq = 0
  private lastSeqByPlayer = new Map<string, number>()
  joined = false
  matchId: string
  playerId: string
  private handlers: MatchChannelHandlers

  constructor(matchId: string, playerId: string, handlers: MatchChannelHandlers = {}) {
    this.matchId = matchId
    this.playerId = playerId
    this.handlers = handlers
    this.channel = supabase.channel(`match:${matchId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: playerId },
        private: true,
      },
    })
  }

  async join(): Promise<void> {
    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      this.dispatch(payload as RealtimeMessage)
    })
    this.channel.on('presence', { event: 'leave' }, ({ key }) => {
      if (key !== this.playerId) this.handlers.onPresenceLeave?.(key)
    })
    this.channel.on('presence', { event: 'join' }, ({ key }) => {
      if (key !== this.playerId) this.handlers.onPresenceJoin?.(key)
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining match channel')), 10000)
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer)
          this.joined = true
          await this.channel.track({ online_at: Date.now() })
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer)
          reject(new Error(`Channel connection failed: ${status}`))
        }
      })
    })
  }

  setHandlers(handlers: MatchChannelHandlers) {
    Object.assign(this.handlers, handlers)
  }

  private dispatch(msg: RealtimeMessage) {
    if (msg.playerId === this.playerId) return
    // drop duplicate / stale out-of-order control messages per player+type
    const key = `${msg.playerId}:${msg.messageType}`
    const last = this.lastSeqByPlayer.get(key) ?? -1
    if (msg.messageType === 'input' || msg.messageType === 'state_snapshot') {
      if (msg.sequence <= last) return
      this.lastSeqByPlayer.set(key, msg.sequence)
    }
    const h = this.handlers
    switch (msg.messageType) {
      case 'input':
        h.onInput?.(msg.playerId, msg.payload as CombatInput)
        break
      case 'state_snapshot':
        h.onSnapshot?.(msg.payload as StateSnapshot)
        break
      case 'player_exit':
        h.onPlayerExit?.(msg.playerId)
        break
      case 'player_ready':
        h.onPlayerReady?.(msg.playerId)
        break
      case 'assets_loaded':
        h.onAssetsLoaded?.(msg.playerId)
        break
      case 'countdown_start':
        h.onCountdownStart?.((msg.payload as { startAt: number }).startAt)
        break
      case 'ping':
        h.onPing?.(msg.playerId, (msg.payload as { t: number }).t)
        break
      case 'pong':
        h.onPong?.((msg.payload as { t: number }).t)
        break
    }
  }

  send<T>(messageType: RealtimeMessageType, payload: T) {
    if (!this.joined) return
    const msg: RealtimeMessage<T> = {
      matchId: this.matchId,
      playerId: this.playerId,
      sequence: ++this.seq,
      timestamp: Date.now(),
      messageType,
      payload,
    }
    void this.channel.send({ type: 'broadcast', event: 'msg', payload: msg })
  }

  async leave() {
    this.joined = false
    try {
      await this.channel.untrack()
    } catch {
      // ignore
    }
    await supabase.removeChannel(this.channel)
  }
}
