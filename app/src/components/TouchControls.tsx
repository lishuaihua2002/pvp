import { useEffect, useRef, useState } from 'react'
import type { VirtualBuffer, VirtualPad } from '../game/input/keyboard'

/** Touch phones/tablets get on-screen controls; desktops keep the keyboard. */
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

interface Props {
  /** pad for the player controlling this device */
  pad: VirtualPad | null
  /** touch devices have no Esc key, so quitting needs a button */
  onQuit?: () => void
}

const STICK_SIZE = 120
const KNOB_SIZE = 52
const DEAD_ZONE = 0.28

/** Analog-ish stick: left/right move, down crouches, up triggers a jump. */
function Joystick({ pad }: { pad: VirtualPad }) {
  const base = useRef<HTMLDivElement | null>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const upLatched = useRef(false)

  const reset = () => {
    pad.virtual.left = false
    pad.virtual.right = false
    pad.virtual.sit = false
    upLatched.current = false
    setKnob({ x: 0, y: 0 })
  }

  const apply = (clientX: number, clientY: number) => {
    const el = base.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const radius = r.width / 2
    let dx = clientX - (r.left + radius)
    let dy = clientY - (r.top + radius)
    const dist = Math.hypot(dx, dy)
    if (dist > radius) {
      dx = (dx / dist) * radius
      dy = (dy / dist) * radius
    }
    setKnob({ x: dx, y: dy })
    const nx = dx / radius
    const ny = dy / radius
    pad.virtual.left = nx < -DEAD_ZONE
    pad.virtual.right = nx > DEAD_ZONE
    pad.virtual.sit = ny > DEAD_ZONE * 1.5
    const up = ny < -DEAD_ZONE * 1.5
    if (up && !upLatched.current) pad.virtualBuffer.jump = true
    upLatched.current = up
  }

  return (
    <div
      ref={base}
      className="pointer-events-auto relative touch-none rounded-full border-2 border-arcade-cyan/50 bg-black/45 backdrop-blur-sm"
      style={{ width: STICK_SIZE, height: STICK_SIZE }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        apply(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(e.clientX, e.clientY)
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
    >
      <span className="absolute inset-0 flex items-start justify-center pt-1 text-xs text-arcade-cyan/60">▲</span>
      <span className="absolute inset-0 flex items-end justify-center pb-1 text-xs text-arcade-cyan/60">▼</span>
      <div
        className="absolute rounded-full border-2 border-arcade-cyan bg-arcade-cyan/25"
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          left: (STICK_SIZE - KNOB_SIZE) / 2 + knob.x,
          top: (STICK_SIZE - KNOB_SIZE) / 2 + knob.y,
        }}
      />
    </div>
  )
}

function ActionButton({ buffer, action, label }: { buffer: VirtualBuffer; action: keyof VirtualBuffer; label: string }) {
  return (
    <button
      className="pointer-events-auto flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border-2 border-arcade-accent/70 bg-black/50 text-lg font-black text-arcade-accent backdrop-blur-sm active:scale-95"
      onPointerDown={(e) => {
        e.preventDefault()
        buffer[action] = true
      }}
    >
      {label}
    </button>
  )
}

export default function TouchControls({ pad, onQuit }: Props) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(isTouchDevice())
  }, [])
  if (!visible || !pad) return null

  return (
    <>
      {onQuit && (
        <button
          className="pointer-events-auto absolute left-3 top-3 z-30 rounded bg-black/60 px-3 py-1 text-xs font-bold text-gray-300"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
          onClick={onQuit}
        >
          Quit
        </button>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between px-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Joystick pad={pad} />
        <div className="flex flex-col items-end gap-2">
          <ActionButton buffer={pad.virtualBuffer} action="jump" label="▲" />
          <div className="flex gap-2">
            <ActionButton buffer={pad.virtualBuffer} action="punch" label="P" />
            <ActionButton buffer={pad.virtualBuffer} action="kick" label="K" />
          </div>
        </div>
      </div>
    </>
  )
}
