import Phaser from 'phaser'
import type { FighterManifest, PartType } from '../../types/fighter'
import type { Pose } from '../config/animations'

/**
 * Skeletal 2D fighter built from body-part textures.
 * Container origin is at the character's feet.
 */

// Standard bind-pose skeleton (px, y negative = up from feet)
const SKELETON = {
  hip: { x: 0, y: -95 },
  torsoTop: { x: 0, y: -172 },
  leftShoulder: { x: -20, y: -160 },
  rightShoulder: { x: 20, y: -160 },
  leftHip: { x: -12, y: -95 },
  rightHip: { x: 12, y: -95 },
  elbowOffset: 44,
  kneeOffset: 46,
}

// Standard display sizes each part is scaled to
const DISPLAY_SIZES: Record<PartType, { w: number; h: number }> = {
  head: { w: 52, h: 56 },
  torso: { w: 64, h: 84 },
  'left-upper-arm': { w: 22, h: 46 },
  'left-lower-arm': { w: 20, h: 46 },
  'right-upper-arm': { w: 22, h: 46 },
  'right-lower-arm': { w: 20, h: 46 },
  'left-upper-leg': { w: 26, h: 50 },
  'left-lower-leg': { w: 22, h: 52 },
  'right-upper-leg': { w: 26, h: 50 },
  'right-lower-leg': { w: 22, h: 52 },
}

export class SkeletalFighter {
  container: Phaser.GameObjects.Container
  private parts = new Map<PartType, Phaser.GameObjects.Container>()
  private inner: Phaser.GameObjects.Container
  private flashOverlay = 0
  private images = new Map<PartType, Phaser.GameObjects.Image>()
  manifest: FighterManifest

  constructor(scene: Phaser.Scene, manifest: FighterManifest, x: number, y: number) {
    this.manifest = manifest
    this.inner = scene.add.container(0, 0)
    this.container = scene.add.container(x, y, [this.inner])

    const mk = (
      pt: PartType,
      jointX: number,
      jointY: number,
      parent: Phaser.GameObjects.Container,
      originY = 0, // 0 = pivot at top of part, 1 = pivot at bottom
    ) => {
      const key = `${manifest.id}:${pt}`
      const img = scene.add.image(0, 0, key)
      const size = DISPLAY_SIZES[pt]
      if (manifest.preset) {
        img.setDisplaySize(size.w, size.h)
      } else {
        // photo fighters: keep the part's own proportions, normalized to standard height
        const src = manifest.parts.find((p) => p.partType === pt)
        const ratio = src && src.height > 0 ? src.width / src.height : size.w / size.h
        img.setDisplaySize(Math.min(size.w * 2.5, size.h * ratio), size.h)
      }
      img.setOrigin(0.5, originY)
      const holder = scene.add.container(jointX, jointY, [img])
      parent.add(holder)
      this.parts.set(pt, holder)
      this.images.set(pt, img)
      return holder
    }

    // draw order: back arm/leg, torso, front leg/arm, head
    mk('left-upper-arm', SKELETON.leftShoulder.x, SKELETON.leftShoulder.y, this.inner)
    mk('left-lower-arm', 0, SKELETON.elbowOffset, this.parts.get('left-upper-arm')!)
    mk('left-upper-leg', SKELETON.leftHip.x, SKELETON.leftHip.y, this.inner)
    mk('left-lower-leg', 0, SKELETON.kneeOffset, this.parts.get('left-upper-leg')!)
    mk('torso', SKELETON.hip.x, SKELETON.hip.y, this.inner, 1)
    mk('right-upper-leg', SKELETON.rightHip.x, SKELETON.rightHip.y, this.inner)
    mk('right-lower-leg', 0, SKELETON.kneeOffset, this.parts.get('right-upper-leg')!)
    mk('right-upper-arm', SKELETON.rightShoulder.x, SKELETON.rightShoulder.y, this.inner)
    mk('right-lower-arm', 0, SKELETON.elbowOffset, this.parts.get('right-upper-arm')!)
    mk('head', SKELETON.torsoTop.x, SKELETON.torsoTop.y, this.inner, 1)

    this.container.setScale(manifest.scale)
  }

  /** Load all part textures for a manifest. Call in scene preload/create. */
  static async loadTextures(scene: Phaser.Scene, manifest: FighterManifest): Promise<void> {
    const loads = manifest.parts.map(
      (part) =>
        new Promise<void>((resolve, reject) => {
          const key = `${manifest.id}:${part.partType}`
          if (scene.textures.exists(key)) return resolve()
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            scene.textures.addImage(key, img)
            resolve()
          }
          img.onerror = () => reject(new Error(`Failed to load part: ${part.partType}`))
          img.src = part.url
        }),
    )
    await Promise.all(loads)
  }

  applyPose(pose: Pose, facing: 1 | -1) {
    this.inner.setScale(facing, 1)
    const root = pose.root
    this.inner.setPosition(root?.dx ?? 0, root?.dy ?? 0)
    for (const [pt, holder] of this.parts) {
      const p = pose[pt]
      holder.setRotation(p?.rot ?? 0)
      // keep base joint positions; dx/dy offsets are additive
      const base = this.basePos(pt)
      holder.setPosition(base.x + (p?.dx ?? 0), base.y + (p?.dy ?? 0))
    }
    if (this.flashOverlay > 0) {
      this.flashOverlay--
      const tint = 0xffffff
      for (const img of this.images.values()) img.setTintFill(tint)
    } else {
      for (const img of this.images.values()) img.clearTint()
    }
  }

  private basePos(pt: PartType): { x: number; y: number } {
    switch (pt) {
      case 'head':
        return SKELETON.torsoTop
      case 'torso':
        return SKELETON.hip
      case 'left-upper-arm':
        return SKELETON.leftShoulder
      case 'right-upper-arm':
        return SKELETON.rightShoulder
      case 'left-upper-leg':
        return SKELETON.leftHip
      case 'right-upper-leg':
        return SKELETON.rightHip
      case 'left-lower-arm':
      case 'right-lower-arm':
        return { x: 0, y: SKELETON.elbowOffset }
      case 'left-lower-leg':
      case 'right-lower-leg':
        return { x: 0, y: SKELETON.kneeOffset }
    }
  }

  flash(frames = 5) {
    this.flashOverlay = frames
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y)
  }

  destroy() {
    this.container.destroy(true)
  }
}
