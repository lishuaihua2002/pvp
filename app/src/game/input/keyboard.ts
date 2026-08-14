import type { CombatInput } from '../../types/combat'
import { EMPTY_INPUT } from '../combat/sim'

/**
 * Keyboard input collector with edge-triggered attack buffering.
 * A / D move, W or Space jump, J punch, K kick.
 */
export class KeyboardInput {
  private held = new Set<string>()
  private buffered = { jump: false, punch: false, kick: false }
  private seq = 0
  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (['a', 'd', 'w', 'j', 'k', ' '].includes(k)) e.preventDefault()
    if (!this.held.has(k)) {
      if (k === 'w' || k === ' ') this.buffered.jump = true
      if (k === 'j') this.buffered.punch = true
      if (k === 'k') this.buffered.kick = true
    }
    this.held.add(k)
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key.toLowerCase())
  }
  private onBlur = () => {
    this.held.clear()
    this.buffered = { jump: false, punch: false, kick: false }
  }

  // virtual (touch) input state, merged with keyboard
  virtual = { left: false, right: false }
  virtualBuffer = { jump: false, punch: false, kick: false }

  attach() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  /** Sample input for one simulation frame (consumes buffered attacks). */
  sample(frame: number): CombatInput {
    const input: CombatInput = {
      ...EMPTY_INPUT,
      frame,
      seq: ++this.seq,
      left: this.held.has('a') || this.virtual.left,
      right: this.held.has('d') || this.virtual.right,
      jump: this.buffered.jump || this.virtualBuffer.jump,
      punch: this.buffered.punch || this.virtualBuffer.punch,
      kick: this.buffered.kick || this.virtualBuffer.kick,
    }
    this.buffered = { jump: false, punch: false, kick: false }
    this.virtualBuffer = { jump: false, punch: false, kick: false }
    return input
  }
}
