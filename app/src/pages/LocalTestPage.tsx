import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PhaserArena from '../components/PhaserArena'
import { getPresetFighters } from '../lib/presets'
import { getLocalFighters, deleteLocalFighter } from '../lib/localFighters'
import { initAudio, playSfx } from '../game/audio/sfx'

export default function LocalTestPage() {
  const presets = useMemo(() => getPresetFighters(), [])
  const [custom, setCustom] = useState(() => getLocalFighters())
  const fighters = useMemo(() => [...presets, ...custom], [presets, custom])
  const [started, setStarted] = useState(false)
  const [p1, setP1] = useState(0)
  const [p2, setP2] = useState(1)

  const config = useMemo(
    () => ({
      mode: 'local' as const,
      localPlayerId: 'p1',
      remotePlayerId: 'p2',
      localFighter: fighters[p1],
      remoteFighter: fighters[p2],
      localName: 'Player 1',
      remoteName: 'Player 2',
      isHost: true,
      onExit: () => setStarted(false),
    }),
    [p1, p2, fighters],
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
        <h1 className="mb-2 text-2xl font-black text-arcade-cyan">Local Versus</h1>
        <p className="mb-4 text-sm text-gray-400">
          Two players on one keyboard: P1 uses A/D/W/J/K, P2 uses Arrow keys + 1 (punch) 2 (kick). Esc to quit.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-4">
          {[
            { label: 'Player 1 fighter', value: p1, set: setP1 },
            { label: 'Player 2 fighter', value: p2, set: setP2 },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <div className="mb-2 text-sm text-gray-300">{label}</div>
              <div className="flex flex-col gap-2">
                {fighters.map((f, i) => (
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

        {custom.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-400">
            Your fighters:
            {custom.map((f) => (
              <button
                key={f.id}
                className="text-red-400 underline hover:text-red-300"
                onClick={() => {
                  deleteLocalFighter(f.id)
                  setP1(0)
                  setP2(1)
                  setCustom(getLocalFighters())
                }}
              >
                delete {f.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="btn-primary flex-1 text-lg"
            onClick={() => {
              initAudio()
              playSfx('match_start')
              setStarted(true)
            }}
          >
            Start Fight
          </button>
          <Link className="btn-secondary" to="/editor">
            📷 Create fighter from photo
          </Link>
          <Link className="btn-secondary" to="/login">
            Login
          </Link>
        </div>
      </div>
    </div>
  )
}
