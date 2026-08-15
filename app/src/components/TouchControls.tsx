import { useEffect, useState } from 'react'
import type { VirtualBuffer, VirtualHeld, VirtualPad } from '../game/input/keyboard'

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

const BTN =
  'flex select-none touch-none items-center justify-center rounded-full border-2 bg-black/55 font-black backdrop-blur-sm active:scale-95'

function holdProps(held: VirtualHeld, key: keyof VirtualHeld) {
  const set = (value: boolean) => () => {
    held[key] = value
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      held[key] = true
    },
    onPointerUp: set(false),
    onPointerCancel: set(false),
    onLostPointerCapture: set(false),
  }
}

function tapProps(buffer: VirtualBuffer, key: keyof VirtualBuffer) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      buffer[key] = true
    },
  }
}

function Pad({ pad }: { pad: VirtualPad }) {
  const move = `${BTN} h-16 w-16 text-xl border-arcade-cyan/60 text-arcade-cyan`
  const act = `${BTN} h-16 w-16 text-xl border-arcade-accent/70 text-arcade-accent`
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1">
      <div className="flex items-end gap-3">
        <button className={move} {...holdProps(pad.virtual, 'left')}>
          ◀
        </button>
        <button className={move} {...holdProps(pad.virtual, 'right')}>
          ▶
        </button>
        <button className={move} {...holdProps(pad.virtual, 'sit')}>
          ▼
        </button>
        <button className={act} {...tapProps(pad.virtualBuffer, 'jump')}>
          ▲
        </button>
        <button className={act} {...tapProps(pad.virtualBuffer, 'punch')}>
          P
        </button>
        <button className={act} {...tapProps(pad.virtualBuffer, 'kick')}>
          K
        </button>
      </div>
    </div>
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
          className="absolute left-2 top-2 z-20 rounded bg-black/60 px-3 py-1 text-xs font-bold text-gray-300"
          onClick={onQuit}
        >
          Quit
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex touch-none items-end justify-center px-3">
        <Pad pad={pad} />
      </div>
    </>
  )
}
