import type { CombatInput } from '../../types/combat'
import { EMPTY_INPUT } from '../combat/sim'

export interface VirtualHeld {
  left: boolean
  right: boolean
  sit: boolean
}

export interface VirtualBuffer {
  jump: boolean
  punch: boolean
  kick: boolean
  special: boolean
}

/** On-screen controls write here; the owning input sampler consumes it. */
export interface VirtualPad {
  virtual: VirtualHeld
  virtualBuffer: VirtualBuffer
}

export function clearBuffer(buffer: VirtualBuffer) {
  buffer.jump = false
  buffer.punch = false
  buffer.kick = false
  buffer.special = false
}

/**
 * Keyboard input collector with edge-triggered attack buffering.
 * A / D move, W or Space jump (twice for a double jump), S sit, J punch, K kick, L super.
 */
export class KeyboardInput {
  private held = new Set<string>()
  private buffered = { jump: false, punch: false, kick: false, special: false }
  private seq = 0
  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (['a', 'd', 'w', 's', 'j', 'k', 'l', ' '].includes(k)) e.preventDefault()
    if (!this.held.has(k)) {
      if (k === 'w' || k === ' ') this.buffered.jump = true
      if (k === 'j') this.buffered.punch = true
      if (k === 'k') this.buffered.kick = true
      if (k === 'l') this.buffered.special = true
    }
    this.held.add(k)
  }
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key.toLowerCase())
  }
  private onBlur = () => {
    this.held.clear()
    this.buffered = { jump: false, punch: false, kick: false, special: false }
  }

  // virtual (touch) input state, merged with keyboard
  readonly virtual: VirtualHeld = { left: false, right: false, sit: false }
  readonly virtualBuffer: VirtualBuffer = { jump: false, punch: false, kick: false, special: false }

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
      sit: this.held.has('s') || this.virtual.sit,
      special: this.buffered.special || this.virtualBuffer.special,
    }
    this.buffered = { jump: false, punch: false, kick: false, special: false }
    clearBuffer(this.virtualBuffer)
    return input
  }
}
