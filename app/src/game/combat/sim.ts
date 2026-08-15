import type { ActionName, CombatInput, PlayerState } from '../../types/combat'
import { ANIMATIONS } from '../config/animations'
import { DEFAULT_COLLIDERS } from '../../types/fighter'

export const SIM_FPS = 60
export const ARENA_WIDTH = 1280
export const GROUND_Y = 620
export const GRAVITY = 0.9
export const WALK_SPEED = 4.2
export const JUMP_VELOCITY = -21
export const KNOCKDOWN_THRESHOLD = 100
export const IMPACT_DECAY = 0.25
export const PUNCH_IMPACT = 22
export const KICK_IMPACT = 34
export const HITSTUN_FRAMES = 14
export const GETUP_INVULN = 45
export const HIT_PROTECT_FRAMES = 8
export const MAX_JUMPS = 2
export const AIR_JUMP_VELOCITY = -15
export const ENERGY_MAX = 100
export const CHARGE_SPEED = 18
export const CHARGE_MAX_FRAMES = 150
export const CHARGE_BOUNCES = 3

export interface HitEvent {
  attackerId: string
  defenderId: string
  kind: 'punch' | 'kick' | 'charge'
  x: number
  y: number
  knockdown: boolean
}

export function createPlayerState(playerId: string, side: 'left' | 'right'): PlayerState {
  return {
    playerId,
    x: side === 'left' ? ARENA_WIDTH * 0.3 : ARENA_WIDTH * 0.7,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: side === 'left' ? 1 : -1,
    action: 'idle',
    actionFrame: 0,
    onGround: true,
    hitstun: 0,
    impact: 0,
    lastHitId: 0,
    invulnFrames: 0,
    jumpsUsed: 0,
    energy: 0,
    bounces: 0,
  }
}

/** attack moves; the ground/air/crouch variants are picked in stepPlayer */
const ATTACKS: ActionName[] = ['punch', 'kick', 'sweep', 'uppercut', 'divekick', 'lowpunch']
const UNCANCELLABLE: ActionName[] = [...ATTACKS, 'hit', 'knockdown', 'getup', 'entrance', 'charge', 'bounce']
/** actions that hold the crouched (low) hurtbox */
const CROUCHED: ActionName[] = ['sit', 'sweep', 'lowpunch']

function isAttack(action: ActionName): boolean {
  return ATTACKS.includes(action)
}

function setAction(p: PlayerState, action: ActionName) {
  if (p.action !== action) {
    p.action = action
    p.actionFrame = 0
  }
}

function actionDone(p: PlayerState): boolean {
  const anim = ANIMATIONS[p.action]
  return !anim.loop && p.actionFrame >= anim.durationFrames
}

function canAct(p: PlayerState): boolean {
  if (!UNCANCELLABLE.includes(p.action)) return true
  const anim = ANIMATIONS[p.action]
  if (anim.cancelFrame !== undefined && p.actionFrame >= anim.cancelFrame) return true
  return actionDone(p)
}

export interface SimState {
  frame: number
  players: [PlayerState, PlayerState]
  nextHitId: number
  /** per-player: id of the attack move instance currently landed (to avoid multi-hit) */
  attackInstance: [number, number]
  attackLanded: [boolean, boolean]
}

export function createSimState(idA: string, idB: string): SimState {
  return {
    frame: 0,
    players: [createPlayerState(idA, 'left'), createPlayerState(idB, 'right')],
    nextHitId: 1,
    attackInstance: [0, 0],
    attackLanded: [false, false],
  }
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
) {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh
}

function hurtboxes(p: PlayerState) {
  const c = DEFAULT_COLLIDERS
  if (CROUCHED.includes(p.action)) {
    return [
      { x: p.x + c.crouchHeadHurtbox.x, y: p.y + c.crouchHeadHurtbox.y, w: c.crouchHeadHurtbox.w, h: c.crouchHeadHurtbox.h },
      { x: p.x + c.crouchBodyHurtbox.x, y: p.y + c.crouchBodyHurtbox.y, w: c.crouchBodyHurtbox.w, h: c.crouchBodyHurtbox.h },
    ]
  }
  return [
    { x: p.x + c.headHurtbox.x, y: p.y + c.headHurtbox.y, w: c.headHurtbox.w, h: c.headHurtbox.h },
    { x: p.x + c.torsoHurtbox.x, y: p.y + c.torsoHurtbox.y, w: c.torsoHurtbox.w, h: c.torsoHurtbox.h },
    { x: p.x + c.legsHurtbox.x, y: p.y + c.legsHurtbox.y, w: c.legsHurtbox.w, h: c.legsHurtbox.h },
  ]
}

export function activeHitbox(p: PlayerState): { x: number; y: number; w: number; h: number; kind: 'punch' | 'kick' } | null {
  if (!isAttack(p.action)) return null
  const anim = ANIMATIONS[p.action]
  if (!anim.activeFrames) return null
  const [from, to] = anim.activeFrames
  if (p.actionFrame < from || p.actionFrame > to) return null
  const c = DEFAULT_COLLIDERS
  const boxes: Record<string, { reach: number; y: number; w: number; h: number }> = {
    punch: c.punchHitbox,
    kick: c.kickHitbox,
    sweep: c.sweepHitbox,
    uppercut: c.uppercutHitbox,
    divekick: c.divekickHitbox,
    lowpunch: c.lowpunchHitbox,
  }
  const def = boxes[p.action]
  return {
    x: p.x + p.facing * def.reach,
    y: p.y + def.y,
    w: def.w,
    h: def.h,
    kind: p.action === 'punch' || p.action === 'uppercut' || p.action === 'lowpunch' ? 'punch' : 'kick',
  }
}

/** Spend a full energy bar to start a lock-on charge at the opponent. */
function tryStartCharge(p: PlayerState, opponent: PlayerState, input: CombatInput) {
  if (!input.special || p.energy < ENERGY_MAX) return
  if (p.hitstun > 0 || !canAct(p)) return
  if (p.action === 'charge' || p.action === 'bounce') return
  if (p.action === 'hit' || p.action === 'knockdown' || p.action === 'getup' || p.action === 'entrance') return
  p.energy = 0
  p.facing = opponent.x >= p.x ? 1 : -1
  p.y = GROUND_Y
  p.vy = 0
  p.onGround = true
  p.jumpsUsed = 0
  setAction(p, 'charge')
}

/** Advance one player by one frame given its input. */
function stepPlayer(p: PlayerState, input: CombatInput) {
  p.actionFrame++
  if (p.hitstun > 0) p.hitstun--
  if (p.invulnFrames > 0) p.invulnFrames--
  p.impact = Math.max(0, p.impact - IMPACT_DECAY)

  // finish knockdown -> getup
  if (p.action === 'knockdown' && actionDone(p)) {
    setAction(p, 'getup')
    p.invulnFrames = GETUP_INVULN
    p.impact = Math.min(p.impact, 20)
  }
  if (p.action === 'getup' && actionDone(p)) setAction(p, 'idle')
  if (p.action === 'hit' && actionDone(p)) setAction(p, 'idle')
  if (isAttack(p.action) && actionDone(p)) setAction(p, 'idle')
  if (p.action === 'entrance' && actionDone(p)) setAction(p, 'idle')

  const locked =
    p.hitstun > 0 ||
    p.action === 'hit' ||
    p.action === 'knockdown' ||
    p.action === 'getup' ||
    p.action === 'entrance' ||
    p.action === 'charge' ||
    p.action === 'bounce'

  if (p.action === 'charge') {
    // the super keeps rushing forward until it connects or runs out of arena
    p.vx = p.facing * CHARGE_SPEED
  }

  if (!locked) {
    // attacks (allowed both on the ground and in the air)
    if (input.punch && canAct(p)) {
      // crouching punches low, airborne punches become a rising uppercut
      if (!p.onGround) {
        setAction(p, 'uppercut')
        p.vy = Math.min(p.vy, -6)
      } else {
        setAction(p, input.sit ? 'lowpunch' : 'punch')
      }
    } else if (input.kick && canAct(p)) {
      if (!p.onGround) {
        // air kick dives diagonally down and forward
        setAction(p, 'divekick')
        p.vx = p.facing * WALK_SPEED * 1.9
        p.vy = Math.max(p.vy, 9)
      } else if (input.sit) {
        setAction(p, 'sweep')
        p.vx = 0
      } else {
        setAction(p, 'kick')
      }
    }

    const attacking = isAttack(p.action)

    // movement
    if (!attacking) {
      if (input.sit && p.onGround) {
        setAction(p, 'sit')
        p.vx = 0
      } else {
        if (p.action === 'sit') setAction(p, 'idle')
        let dir = 0
        if (input.left) dir -= 1
        if (input.right) dir += 1
        p.vx = dir * WALK_SPEED
        if (dir !== 0) {
          p.facing = dir > 0 ? 1 : -1
          if (p.onGround && p.action !== 'jump') setAction(p, 'walk')
        } else if (p.onGround && (p.action === 'walk')) {
          setAction(p, 'idle')
        }
        if (input.jump && p.jumpsUsed < MAX_JUMPS) {
          p.vy = p.onGround ? JUMP_VELOCITY : AIR_JUMP_VELOCITY
          p.jumpsUsed++
          p.onGround = false
          // restart the animation so the second jump reads as a new hop
          p.action = 'jump'
          p.actionFrame = 0
        }
      }
    } else if (p.onGround) {
      // limited drift while attacking on the ground; keep air momentum
      p.vx *= 0.8
    }
  } else {
    // knockback friction during hitstun
    p.vx *= 0.9
  }

  // physics
  p.x += p.vx
  p.y += p.vy
  if (!p.onGround) p.vy += GRAVITY
  if (p.y >= GROUND_Y) {
    const wasAirborne = !p.onGround
    const landingVy = p.vy
    p.y = GROUND_Y
    if (p.action === 'bounce' && p.bounces > 0 && landingVy > 3) {
      // launched by a super: bounce back up instead of landing
      p.bounces--
      p.vy = -Math.max(7, landingVy * 0.55)
      p.vx *= 0.7
      p.onGround = false
    } else {
      p.vy = 0
      p.onGround = true
      p.jumpsUsed = 0
      if (p.action === 'bounce') {
        setAction(p, 'getup')
        p.vx = 0
      } else if (wasAirborne && (p.action === 'jump' || p.action === 'divekick' || (isAttack(p.action) && actionDone(p)))) {
        setAction(p, 'idle')
      }
    }
  }

  // the charge ends when it runs out of arena or time
  if (p.action === 'charge') {
    const half = DEFAULT_COLLIDERS.bodyWidth / 2
    const atWall = p.x <= half + 21 || p.x >= ARENA_WIDTH - half - 21
    if (atWall || p.actionFrame >= CHARGE_MAX_FRAMES) {
      setAction(p, 'idle')
      p.vx = 0
    }
  }

  // bounds
  const half = DEFAULT_COLLIDERS.bodyWidth / 2
  p.x = Math.min(ARENA_WIDTH - half - 20, Math.max(half + 20, p.x))
}

/** Advance whole sim one frame. Returns hit events that occurred. */
export function stepSim(s: SimState, inputA: CombatInput, inputB: CombatInput): HitEvent[] {
  s.frame++
  const [a, b] = s.players

  // super activation needs both players (it locks on to the opponent)
  for (let i = 0; i < 2; i++) {
    tryStartCharge(s.players[i], s.players[1 - i], i === 0 ? inputA : inputB)
  }

  // track attack instances for one-hit-per-move
  for (let i = 0; i < 2; i++) {
    const p = s.players[i]
    const wasAttack = isAttack(p.action)
    stepPlayer(p, i === 0 ? inputA : inputB)
    if (isAttack(p.action) && (!wasAttack || p.actionFrame === 1)) {
      s.attackInstance[i]++
      s.attackLanded[i] = false
    }
  }

  // body push-apart (no full overlap); a super charge and its victim pass through
  const minDist = DEFAULT_COLLIDERS.bodyWidth * 0.9
  const dx = b.x - a.x
  const bodiesPass = [a, b].some((p) => p.action === 'charge' || p.action === 'bounce')
  if (!bodiesPass && Math.abs(dx) < minDist && Math.abs(a.y - b.y) < DEFAULT_COLLIDERS.bodyHeight * 0.8) {
    const push = (minDist - Math.abs(dx)) / 2
    const dir = dx >= 0 ? 1 : -1
    a.x -= push * dir
    b.x += push * dir
  }

  // face each other when idle/walking
  for (const [p, q] of [[a, b], [b, a]] as const) {
    if (p.action === 'idle' || p.action === 'walk') {
      if (p.vx === 0) p.facing = q.x >= p.x ? 1 : -1
    }
  }

  const events: HitEvent[] = []

  // super charge collision: launches the opponent without dealing damage
  for (let i = 0; i < 2; i++) {
    const charger = s.players[i]
    const victim = s.players[1 - i]
    if (charger.action !== 'charge' || victim.action === 'bounce') continue
    const c = DEFAULT_COLLIDERS
    const hit =
      Math.abs(charger.x - victim.x) < c.bodyWidth * 1.15 &&
      Math.abs(charger.y - victim.y) < c.bodyHeight
    if (!hit) continue
    victim.action = 'bounce'
    victim.actionFrame = 0
    victim.bounces = CHARGE_BOUNCES
    victim.vx = charger.facing * 20
    victim.vy = -15
    victim.onGround = false
    victim.hitstun = 0
    setAction(charger, 'idle')
    charger.vx = 0
    events.push({
      attackerId: charger.playerId,
      defenderId: victim.playerId,
      kind: 'charge',
      x: victim.x,
      y: victim.y - c.bodyHeight / 2,
      knockdown: false,
    })
  }

  // hit detection
  for (let i = 0; i < 2; i++) {
    const attacker = s.players[i]
    const defender = s.players[1 - i]
    if (s.attackLanded[i]) continue
    if (defender.invulnFrames > 0) continue
    if (defender.action === 'knockdown' || defender.action === 'getup' || defender.action === 'bounce') continue
    const hb = activeHitbox(attacker)
    if (!hb) continue
    const landed = hurtboxes(defender).some((hurt) =>
      rectsOverlap(hb.x, hb.y, hb.w, hb.h, hurt.x, hurt.y, hurt.w, hurt.h),
    )
    if (!landed) continue

    s.attackLanded[i] = true
    const impact = hb.kind === 'punch' ? PUNCH_IMPACT : KICK_IMPACT
    defender.impact += impact
    defender.hitstun = HITSTUN_FRAMES
    defender.lastHitId = s.nextHitId++
    defender.invulnFrames = HIT_PROTECT_FRAMES
    const knockdown = defender.impact >= KNOCKDOWN_THRESHOLD
    const knockbackScale = 1 + defender.impact / 60
    defender.vx = attacker.facing * (hb.kind === 'punch' ? 6 : 9) * knockbackScale
    if (knockdown) {
      // knocking the opponent down fills the super meter
      attacker.energy = ENERGY_MAX
      setAction(defender, 'knockdown')
      defender.impact = 0
      defender.vx = attacker.facing * 12
    } else {
      setAction(defender, 'hit')
    }
    events.push({
      attackerId: attacker.playerId,
      defenderId: defender.playerId,
      kind: hb.kind,
      x: hb.x,
      y: hb.y,
      knockdown,
    })
  }
  return events
}

export const EMPTY_INPUT: CombatInput = {
  frame: 0,
  seq: 0,
  left: false,
  right: false,
  jump: false,
  punch: false,
  kick: false,
  sit: false,
  special: false,
}
