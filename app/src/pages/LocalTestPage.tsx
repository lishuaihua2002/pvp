import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PhaserArena from '../components/PhaserArena'
import { getPresetFighters } from '../lib/presets'
import { initAudio, playSfx } from '../game/audio/sfx'

export default function LocalTestPage() {
  const presets = useMemo(() => getPresetFighters(), [])
  const [started, setStarted] = useState(false)
  const [p1, setP1] = useState(0)
  const [p2, setP2] = useState(1)

  const config = useMemo(
    () => ({
      mode: 'local' as const,
      localPlayerId: 'p1',
      remotePlayerId: 'p2',
      localFighter: presets[p1],
      remoteFighter: presets[p2],
      localName: '玩家1',
      remoteName: '玩家2',
      isHost: true,
      onExit: () => setStarted(false),
    }),
    [p1, p2, presets],
  )

  if (started) {
    return (
      <div className="h-full w-full bg-black">
        <PhaserArena config={config} />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="panel w-full max-w-2xl">
        <h1 className="mb-2 text-2xl font-black text-arcade-cyan">本地双人试玩</h1>
        <p className="mb-4 text-sm text-gray-400">
          同一键盘双人对战：P1 使用 A/D/W/J/K，P2 使用 方向键 + 1(拳) 2(腿)。Esc 退出。
        </p>
        <div className="mb-4 grid grid-cols-2 gap-4">
          {[
            { label: '玩家1角色', value: p1, set: setP1 },
            { label: '玩家2角色', value: p2, set: setP2 },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <div className="mb-2 text-sm text-gray-300">{label}</div>
              <div className="flex flex-col gap-2">
                {presets.map((f, i) => (
                  <button
                    key={f.id}
                    className={i === value ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => {
                      initAudio()
                      playSfx('click')
                      set(i)
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            className="btn-primary flex-1 text-lg"
            onClick={() => {
              initAudio()
              playSfx('match_start')
              setStarted(true)
            }}
          >
            开始对战
          </button>
          <Link className="btn-secondary" to="/login">
            返回登录
          </Link>
        </div>
      </div>
    </div>
  )
}
