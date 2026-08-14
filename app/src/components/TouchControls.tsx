import { useEffect, useState } from 'react'
import type { KeyboardInput } from '../game/input/keyboard'

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export default function TouchControls({ keyboard }: { keyboard: KeyboardInput | null }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(isTouchDevice())
  }, [])
  if (!visible || !keyboard) return null

  const hold = (dir: 'left' | 'right') => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault()
      keyboard.virtual[dir] = true
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault()
      keyboard.virtual[dir] = false
    },
  })
  const tap = (act: 'jump' | 'punch' | 'kick') => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault()
      keyboard.virtualBuffer[act] = true
    },
  })

  const btn =
    'flex h-16 w-16 select-none items-center justify-center rounded-full border-2 border-arcade-cyan/60 bg-black/50 text-xl font-black text-arcade-cyan active:bg-arcade-cyan/30'

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-end justify-between px-4">
      <div className="pointer-events-auto flex gap-3">
        <button className={btn} {...hold('left')}>
          ◀
        </button>
        <button className={btn} {...hold('right')}>
          ▶
        </button>
      </div>
      <div className="pointer-events-auto flex gap-3">
        <button className={btn} {...tap('jump')}>
          跳
        </button>
        <button className={`${btn} border-arcade-accent/70 text-arcade-accent`} {...tap('punch')}>
          拳
        </button>
        <button className={`${btn} border-arcade-accent/70 text-arcade-accent`} {...tap('kick')}>
          腿
        </button>
      </div>
    </div>
  )
}
