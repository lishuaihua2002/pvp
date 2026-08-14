import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { ArenaScene, type ArenaConfig } from '../game/scenes/ArenaScene'

interface Props {
  config: ArenaConfig
  onSceneReady?: (scene: ArenaScene) => void
}

export default function PhaserArena({ config, onSceneReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: 1280,
      height: 720,
      backgroundColor: '#141126',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: { default: 'arcade' },
    })
    gameRef.current = game
    game.scene.add('ArenaScene', ArenaScene, true, config)
    game.events.once(Phaser.Core.Events.READY, () => {
      const scene = game.scene.getScene('ArenaScene') as ArenaScene
      onSceneReady?.(scene)
    })
    return () => {
      game.destroy(true)
      gameRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={hostRef} className="h-full w-full" />
}
