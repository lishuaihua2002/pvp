import { describe, expect, it } from 'vitest'
import {
  activeHitbox,
  createSimState,
  stepSim,
  ARENA_WIDTH,
  CHARGE_SPEED,
  ENERGY_MAX,
  GROUND_Y,
  KNOCKDOWN_THRESHOLD,
  EMPTY_INPUT,
  SIM_FPS,
} from './sim'
import type { CombatInput } from '../../types/combat'

const idle = (frame: number): CombatInput => ({ ...EMPTY_INPUT, frame, seq: frame })
const input = (frame: number, over: Partial<CombatInput>): CombatInput => ({ ...idle(frame), ...over })

function run(s = createSimState('a', 'b'), frames: number, a: Partial<CombatInput> = {}, b: Partial<CombatInput> = {}) {
  const events = []
  for (let i = 0; i < frames; i++) {
    events.push(...stepSim(s, input(s.frame, a), input(s.frame, b)))
  }
  return { s, events }
}

describe('combat sim', () => {
  it('sitting while holding sit, back to idle on release', () => {
    const s = createSimState('a', 'b')
    run(s, 5, { sit: true })
    expect(s.players[0].action).toBe('sit')
    expect(s.players[0].vx).toBe(0)
    run(s, 5, { sit: true, right: true })
    expect(s.players[0].action).toBe('sit')
    const x = s.players[0].x
    expect(s.players[0].x).toBe(x)
    run(s, 2)
    expect(s.players[0].action).toBe('idle')
  })


  it('players start on the ground facing each other', () => {
    const s = createSimState('a', 'b')
    expect(s.players[0].y).toBe(GROUND_Y)
    expect(s.players[1].y).toBe(GROUND_Y)
    expect(s.players[0].facing).toBe(1)
    expect(s.players[1].facing).toBe(-1)
  })

  it('walking moves the player and stays inside the arena', () => {
    const s = createSimState('a', 'b')
    const x0 = s.players[0].x
    run(s, 30, { right: true })
    expect(s.players[0].x).toBeGreaterThan(x0)
    run(s, 60 * 20, { left: true })
    expect(s.players[0].x).toBeGreaterThanOrEqual(0)
    expect(s.players[0].x).toBeLessThanOrEqual(ARENA_WIDTH)
  })

  it('jump leaves the ground and lands back', () => {
    const s = createSimState('a', 'b')
    stepSim(s, input(0, { jump: true }), idle(0))
    run(s, 5)
    expect(s.players[0].y).toBeLessThan(GROUND_Y)
    run(s, SIM_FPS * 3)
    expect(s.players[0].y).toBe(GROUND_Y)
  })

  it('an air punch becomes a rising uppercut and lands back to idle', () => {
    const s = createSimState('a', 'b')
    stepSim(s, input(0, { jump: true }), idle(0))
    run(s, 3)
    expect(s.players[0].y).toBeLessThan(GROUND_Y)
    stepSim(s, input(s.frame, { punch: true }), idle(s.frame))
    expect(s.players[0].action).toBe('uppercut')
    expect(s.players[0].vy).toBeLessThan(0)
    expect(s.players[0].y).toBeLessThan(GROUND_Y)
    run(s, SIM_FPS * 3)
    expect(s.players[0].y).toBe(GROUND_Y)
    expect(s.players[0].action).toBe('idle')
  })

  it('air kick dives down and forward, and hits in range', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    s.players[0].y = GROUND_Y - 130
    s.players[0].vy = -2
    s.players[0].onGround = false
    stepSim(s, input(s.frame, { kick: true }), idle(s.frame))
    expect(s.players[0].action).toBe('divekick')
    expect(s.players[0].vy).toBeGreaterThan(0)
    expect(s.players[0].onGround).toBe(false)
    const { events } = run(s, 30, { kick: true })
    expect(events.filter((e) => e.kind === 'kick').length).toBeGreaterThan(0)
  })

  it('punch in range produces a hit event and hitstun', () => {
    const s = createSimState('a', 'b')
    // walk together
    run(s, 120, { right: true }, { left: true })
    const { events } = run(s, 30, { punch: true })
    const hits = events.filter((e) => e.kind === 'punch')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].attackerId).toBe('a')
    expect(hits[0].defenderId).toBe('b')
  })

  it('a single attack cannot hit twice', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    // hold punch pressed only for the very first frame of the attack
    const events = []
    events.push(...stepSim(s, input(s.frame, { punch: true }), idle(s.frame)))
    for (let i = 0; i < 30; i++) events.push(...stepSim(s, idle(s.frame), idle(s.frame)))
    expect(events.filter((e) => e.kind === 'punch').length).toBeLessThanOrEqual(1)
  })

  it('accumulated impact causes knockdown then getup invulnerability', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    let sawKnockdown = false
    for (let round = 0; round < 30 && !sawKnockdown; round++) {
      // reposition attacker next to defender, then kick
      s.players[0].x = s.players[1].x - 70
      const { events } = run(s, 60, { kick: true }, {})
      if (events.some((e) => e.knockdown)) sawKnockdown = true
    }
    expect(sawKnockdown).toBe(true)
    expect(s.players[1].impact).toBeLessThan(KNOCKDOWN_THRESHOLD)
  })

  it('a standing punch whiffs over a crouching opponent', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true, sit: true })
    const { events } = run(s, 40, { punch: true }, { sit: true })
    expect(events.length).toBe(0)
    expect(s.players[1].action).toBe('sit')
  })

  it('kick while crouching sweeps and hits a standing opponent low', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    stepSim(s, input(s.frame, { sit: true }), idle(s.frame))
    stepSim(s, input(s.frame, { sit: true, kick: true }), idle(s.frame))
    expect(s.players[0].action).toBe('sweep')
    const { events } = run(s, 30, { sit: true }, {})
    expect(events.filter((e) => e.kind === 'kick').length).toBeGreaterThan(0)
  })

  it('a second jump is allowed in the air, a third is not, and landing refills them', () => {
    const s = createSimState('a', 'b')
    stepSim(s, input(s.frame, { jump: true }), idle(s.frame))
    run(s, 6)
    expect(s.players[0].jumpsUsed).toBe(1)
    const y1 = s.players[0].y
    stepSim(s, input(s.frame, { jump: true }), idle(s.frame))
    expect(s.players[0].jumpsUsed).toBe(2)
    expect(s.players[0].vy).toBeLessThan(0)
    run(s, 6)
    expect(s.players[0].y).toBeLessThan(y1)
    // a third jump does nothing while airborne
    const vyBefore = s.players[0].vy
    stepSim(s, input(s.frame, { jump: true }), idle(s.frame))
    expect(s.players[0].jumpsUsed).toBe(2)
    expect(s.players[0].vy).toBeGreaterThan(vyBefore)
    run(s, SIM_FPS * 3)
    expect(s.players[0].onGround).toBe(true)
    expect(s.players[0].jumpsUsed).toBe(0)
    stepSim(s, input(s.frame, { jump: true }), idle(s.frame))
    expect(s.players[0].jumpsUsed).toBe(1)
  })

  it('punch while crouching stays low and hits a crouching opponent', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    stepSim(s, input(s.frame, { sit: true }), input(s.frame, { sit: true }))
    stepSim(s, input(s.frame, { sit: true, punch: true }), input(s.frame, { sit: true }))
    expect(s.players[0].action).toBe('lowpunch')
    const box = activeHitbox(s.players[0])
    const { events } = run(s, 30, { sit: true }, { sit: true })
    expect(events.filter((e) => e.kind === 'punch').length).toBeGreaterThan(0)
    if (box) expect(box.y).toBeGreaterThan(GROUND_Y - 100)
  })

  it('knocking the opponent down fills the super meter', () => {
    const s = createSimState('a', 'b')
    run(s, 120, { right: true }, { left: true })
    let sawKnockdown = false
    for (let round = 0; round < 30 && !sawKnockdown; round++) {
      s.players[0].x = s.players[1].x - 70
      const { events } = run(s, 60, { kick: true }, {})
      if (events.some((e) => e.knockdown)) sawKnockdown = true
    }
    expect(sawKnockdown).toBe(true)
    expect(s.players[0].energy).toBe(ENERGY_MAX)
    expect(s.players[1].energy).toBe(0)
  })

  it('the super needs a full meter, then charges at the opponent and launches it', () => {
    const s = createSimState('a', 'b')
    // no energy: the super input is ignored
    run(s, 2, { special: true })
    expect(s.players[0].action).not.toBe('charge')

    s.players[0].energy = ENERGY_MAX
    s.players[0].x = 200
    s.players[1].x = 900
    stepSim(s, input(s.frame, { special: true }), idle(s.frame))
    expect(s.players[0].action).toBe('charge')
    expect(s.players[0].energy).toBe(0)
    expect(s.players[0].facing).toBe(1)

    const { events } = run(s, 90, {}, {})
    const charge = events.filter((e) => e.kind === 'charge')
    expect(charge.length).toBe(1)
    expect(charge[0].knockdown).toBe(false)
    // the super deals no damage, it only launches
    expect(s.players[1].impact).toBe(0)
    expect(s.players[1].action).toBe('bounce')
    expect(s.players[1].bounces).toBeGreaterThan(0)

    // the victim bounces a few times, then gets up
    let bounceLandings = 0
    for (let i = 0; i < SIM_FPS * 6; i++) {
      const airborne = !s.players[1].onGround
      stepSim(s, idle(s.frame), idle(s.frame))
      if (airborne && s.players[1].action === 'bounce' && !s.players[1].onGround && s.players[1].vy < 0) bounceLandings++
      if (s.players[1].action === 'idle') break
    }
    expect(bounceLandings).toBeGreaterThan(1)
    expect(s.players[1].impact).toBe(0)
    expect(s.players[1].action).toBe('idle')
  })

  it('a super that misses keeps charging to the far wall without damaging anyone', () => {
    const s = createSimState('a', 'b')
    s.players[0].energy = ENERGY_MAX
    s.players[0].x = 400
    s.players[1].x = 1100
    s.players[1].y = GROUND_Y - 400 // out of reach above the charge
    s.players[1].onGround = false
    stepSim(s, input(s.frame, { special: true }), idle(s.frame))
    expect(s.players[0].action).toBe('charge')
    const { events } = run(s, 20, {}, {})
    expect(events.length).toBe(0)
    expect(s.players[0].action).toBe('charge')
    expect(s.players[0].x).toBeGreaterThan(400 + CHARGE_SPEED * 10)
  })

  it('impact decays over time', () => {
    const s = createSimState('a', 'b')
    s.players[1].impact = 50
    run(s, SIM_FPS * 5)
    expect(s.players[1].impact).toBeLessThan(50)
  })
})
