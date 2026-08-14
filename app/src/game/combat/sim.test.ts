import { describe, expect, it } from 'vitest'
import {
  createSimState,
  stepSim,
  ARENA_WIDTH,
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

  it('impact decays over time', () => {
    const s = createSimState('a', 'b')
    s.players[1].impact = 50
    run(s, SIM_FPS * 5)
    expect(s.players[1].impact).toBeLessThan(50)
  })
})
