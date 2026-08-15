export type ActionName =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'punch'
  | 'kick'
  /** low sweeping kick from the crouch */
  | 'sweep'
  /** rising punch done in the air */
  | 'uppercut'
  /** diagonal downward kick done in the air */
  | 'divekick'
  | 'sit'
  | 'hit'
  | 'knockdown'
  | 'getup'
  | 'entrance'

export interface CombatInput {
  frame: number
  seq: number
  left: boolean
  right: boolean
  jump: boolean
  punch: boolean
  kick: boolean
  /** held: crouch/sit while on the ground */
  sit: boolean
}

export interface PlayerState {
  playerId: string
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  action: ActionName
  actionFrame: number
  onGround: boolean
  hitstun: number
  impact: number
  lastHitId: number
  invulnFrames: number
}

export type MatchmakingStatus =
  | 'idle'
  | 'queued'
  | 'matched'
  | 'loading'
  | 'ready'
  | 'active'
  | 'leaving'
  | 'ended'
  | 'disconnected'

export interface MatchState {
  matchId: string
  status: MatchmakingStatus
  frame: number
  players: Record<string, PlayerState>
}

export type RealtimeMessageType =
  | 'player_joined'
  | 'assets_loaded'
  | 'player_ready'
  | 'countdown_start'
  | 'input'
  | 'state_snapshot'
  | 'state_hash'
  | 'ping'
  | 'pong'
  | 'player_exit'
  | 'match_end'
  | 'rematch_request'
  | 'error'

export interface RealtimeMessage<T = unknown> {
  matchId: string
  playerId: string
  sequence: number
  timestamp: number
  messageType: RealtimeMessageType
  payload: T
}

export interface StateSnapshot {
  frame: number
  players: PlayerState[]
}
