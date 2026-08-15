import Phaser from 'phaser'
import type { FighterManifest, PartType, SkinnedBody } from '../../types/fighter'
import type { Pose } from '../config/animations'

/**
 * Skeletal 2D fighter. Two render modes:
 * - skinned: the whole person image is bound to the skeleton with a deformable
 *   grid mesh (linear blend skinning), so the body stays one continuous piece.
 * - parts: legacy per-body-part textures (used by presets like Stickman).
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

interface Vec {
  x: number
  y: number
}

interface GameBone {
  ax: number
  ay: number
  bx: number
  by: number
}

interface SkinInfluence {
  bone: number
  w: number
  /** along-bone coordinate (0 at joint A, 1 at joint B) */
  u: number
  /** perpendicular coordinate, normalized by bone length */
  v: number
}

const rot2 = (x: number, y: number, ang: number): Vec => ({
  x: x * Math.cos(ang) - y * Math.sin(ang),
  y: x * Math.sin(ang) + y * Math.cos(ang),
})

/**
 * Bone endpoints in game space for the current pose. Animation rotations are
 * applied on top of the fighter's own bind stance (taken from the photo), so
 * each fighter keeps its natural standing pose.
 */
function posedBones(pose: Pose, bind: GameBone[]): GameBone[] {
  const g = (pt: PartType) => pose[pt]
  const bones: GameBone[] = new Array(SKIN_BONES.length)
  const single = (pt: PartType) => {
    const p = g(pt)
    const b = bind[BONE_INDEX[pt]]
    const a: Vec = { x: b.ax + (p?.dx ?? 0), y: b.ay + (p?.dy ?? 0) }
    const d = rot2(b.bx - b.ax, b.by - b.ay, p?.rot ?? 0)
    bones[BONE_INDEX[pt]] = { ax: a.x, ay: a.y, bx: a.x + d.x, by: a.y + d.y }
  }
  single('torso')
  single('head')
  const chain = (upper: PartType, lower: PartType) => {
    const u = g(upper)
    const l = g(lower)
    const ru = u?.rot ?? 0
    const rl = l?.rot ?? 0
    const bu = bind[BONE_INDEX[upper]]
    const bl = bind[BONE_INDEX[lower]]
    const a1: Vec = { x: bu.ax + (u?.dx ?? 0), y: bu.ay + (u?.dy ?? 0) }
    const d1 = rot2(bu.bx - bu.ax, bu.by - bu.ay, ru)
    const j2 = rot2(bl.ax - bu.ax + (l?.dx ?? 0), bl.ay - bu.ay + (l?.dy ?? 0), ru)
    const a2: Vec = { x: a1.x + j2.x, y: a1.y + j2.y }
    const d2 = rot2(bl.bx - bl.ax, bl.by - bl.ay, ru + rl)
    bones[BONE_INDEX[upper]] = { ax: a1.x, ay: a1.y, bx: a1.x + d1.x, by: a1.y + d1.y }
    bones[BONE_INDEX[lower]] = { ax: a2.x, ay: a2.y, bx: a2.x + d2.x, by: a2.y + d2.y }
  }
  chain('left-upper-arm', 'left-lower-arm')
  chain('right-upper-arm', 'right-lower-arm')
  chain('left-upper-leg', 'left-lower-leg')
  chain('right-upper-leg', 'right-lower-leg')
  return bones
}

const SKIN_BONES: PartType[] = [
  'head',
  'torso',
  'left-upper-arm',
  'left-lower-arm',
  'right-upper-arm',
  'right-lower-arm',
  'left-upper-leg',
  'left-lower-leg',
  'right-upper-leg',
  'right-lower-leg',
]
const BONE_INDEX = Object.fromEntries(SKIN_BONES.map((p, i) => [p, i])) as Record<PartType, number>

/** Bone endpoints in image space, derived from the body's joint points. */
function imageBones(body: SkinnedBody): { bones: GameBone[]; halfW: number[] } {
  const j = (id: string): Vec => body.joints[id] ?? { x: body.width / 2, y: body.height / 2 }
  const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const midShoulder = mid(j('shoulder-l'), j('shoulder-r'))
  const midHip = mid(j('hip-l'), j('hip-r'))
  const head = j('head')
  const shoulderW = Math.max(24, Math.hypot(j('shoulder-l').x - j('shoulder-r').x, j('shoulder-l').y - j('shoulder-r').y))
  const seg = (a: Vec, b: Vec): GameBone => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y })
  const bones: GameBone[] = new Array(SKIN_BONES.length)
  const halfW: number[] = new Array(SKIN_BONES.length)
  // matches the game head bone: torsoTop (40% shoulder->head) to above the head center (160%)
  bones[BONE_INDEX.head] = seg(lerp(midShoulder, head, 0.4), lerp(midShoulder, head, 1.6))
  halfW[BONE_INDEX.head] = shoulderW * 0.55
  bones[BONE_INDEX.torso] = seg(midHip, midShoulder)
  halfW[BONE_INDEX.torso] = shoulderW * 0.72
  const limb = (upper: PartType, lower: PartType, a: string, m: string, b: string, hw: number) => {
    bones[BONE_INDEX[upper]] = seg(j(a), j(m))
    bones[BONE_INDEX[lower]] = seg(j(m), j(b))
    halfW[BONE_INDEX[upper]] = hw
    halfW[BONE_INDEX[lower]] = hw
  }
  limb('left-upper-arm', 'left-lower-arm', 'shoulder-l', 'elbow-l', 'hand-l', shoulderW * 0.19)
  limb('right-upper-arm', 'right-lower-arm', 'shoulder-r', 'elbow-r', 'hand-r', shoulderW * 0.19)
  limb('left-upper-leg', 'left-lower-leg', 'hip-l', 'knee-l', 'foot-l', shoulderW * 0.24)
  limb('right-upper-leg', 'right-lower-leg', 'hip-r', 'knee-r', 'foot-r', shoulderW * 0.24)
  return { bones, halfW }
}

/** Along / perpendicular coordinates of point p in a bone's local frame. */
function boneLocal(px: number, py: number, b: GameBone): { u: number; v: number } {
  const dx = b.bx - b.ax
  const dy = b.by - b.ay
  const lenSq = Math.max(1e-6, dx * dx + dy * dy)
  const rx = px - b.ax
  const ry = py - b.ay
  return { u: (rx * dx + ry * dy) / lenSq, v: (rx * dy - ry * dx) / lenSq }
}

/**
 * The fighter's game-space bind skeleton: the photo's own joint layout,
 * uniformly scaled to standard fighter height with feet on the ground.
 */
function bindBonesFromBody(body: SkinnedBody, imgBones: GameBone[]): GameBone[] {
  const j = (id: string): Vec => body.joints[id] ?? { x: body.width / 2, y: body.height / 2 }
  const footY = Math.max(j('foot-l').y, j('foot-r').y)
  const headY = j('head').y
  const cx = (j('hip-l').x + j('hip-r').x) / 2
  const s = 190 / Math.max(40, footY - headY)
  return imgBones.map((b) => ({
    ax: (b.ax - cx) * s,
    ay: (b.ay - footY) * s,
    bx: (b.bx - cx) * s,
    by: (b.by - footY) * s,
  }))
}

function segDist(px: number, py: number, b: GameBone): number {
  const dx = b.bx - b.ax
  const dy = b.by - b.ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - b.ax) * dx + (py - b.ay) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (b.ax + t * dx), py - (b.ay + t * dy))
}

export class SkeletalFighter {
  container: Phaser.GameObjects.Container
  private parts = new Map<PartType, Phaser.GameObjects.Container>()
  private inner: Phaser.GameObjects.Container
  private flashOverlay = 0
  private images = new Map<PartType, Phaser.GameObjects.Image>()
  manifest: FighterManifest
  private mesh: Phaser.GameObjects.Mesh | null = null
  /** one entry per grid point: its skin influences */
  private skin: SkinInfluence[][] = []
  /** mesh vertex index -> grid point index */
  private vertGrid: number[] = []
  /** game-space bind skeleton (from the photo's own stance) */
  private bindBones: GameBone[] = []

  constructor(scene: Phaser.Scene, manifest: FighterManifest, x: number, y: number) {
    this.manifest = manifest
    this.inner = scene.add.container(0, 0)
    this.container = scene.add.container(x, y, [this.inner])

    if (manifest.body) {
      this.buildSkinnedMesh(scene, manifest.body)
      this.container.setScale(manifest.scale)
      return
    }

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

  /** Builds the whole-person deformable grid mesh bound to the skeleton. */
  private buildSkinnedMesh(scene: Phaser.Scene, body: SkinnedBody) {
    const { bones: imgBones, halfW } = imageBones(body)
    const bindBones = bindBonesFromBody(body, imgBones)
    this.bindBones = bindBones

    const cell = Math.max(10, Math.max(body.width, body.height) / 26)
    const nx = Math.max(6, Math.min(28, Math.round(body.width / cell)))
    const ny = Math.max(6, Math.min(36, Math.round(body.height / cell)))

    const gridPos: Vec[] = []
    for (let gy = 0; gy <= ny; gy++) {
      for (let gx = 0; gx <= nx; gx++) {
        const px = (gx / nx) * body.width
        const py = (gy / ny) * body.height
        // top-3 nearest bones, inverse-distance weighted for a soft blend at joints
        const scored = imgBones.map((b, i) => ({
          i,
          d: segDist(px, py, b) / Math.max(1, halfW[i]),
        }))
        scored.sort((a, b) => a.d - b.d)
        const top = scored.slice(0, 3)
        let total = 0
        const infs: SkinInfluence[] = top.map(({ i, d }) => {
          const w = 1 / Math.pow(d + 0.35, 4)
          total += w
          const { u, v } = boneLocal(px, py, imgBones[i])
          return { bone: i, w, u, v }
        })
        for (const inf of infs) inf.w /= total
        this.skin.push(infs)
        // bind-pose game position
        let bx = 0
        let by = 0
        for (const inf of infs) {
          const b = bindBones[inf.bone]
          const dx = b.bx - b.ax
          const dy = b.by - b.ay
          bx += inf.w * (b.ax + inf.u * dx + inf.v * dy)
          by += inf.w * (b.ay + inf.u * dy - inf.v * dx)
        }
        gridPos.push({ x: bx, y: by })
      }
    }

    const key = `${this.manifest.id}:body`
    const mesh = scene.add.mesh(0, 0, key)
    mesh.hideCCW = false
    mesh.ignoreDirtyCache = true
    const verts: number[] = []
    const uvs: number[] = []
    const pIdx = (gx: number, gy: number) => gy * (nx + 1) + gx
    const pushVert = (gi: number) => {
      const p = gridPos[gi]
      verts.push(p.x, -p.y)
      const gx = gi % (nx + 1)
      const gy = Math.floor(gi / (nx + 1))
      uvs.push(gx / nx, gy / ny)
      this.vertGrid.push(gi)
    }
    for (let gy = 0; gy < ny; gy++) {
      for (let gx = 0; gx < nx; gx++) {
        const p00 = pIdx(gx, gy)
        const p10 = pIdx(gx + 1, gy)
        const p01 = pIdx(gx, gy + 1)
        const p11 = pIdx(gx + 1, gy + 1)
        pushVert(p00)
        pushVert(p01)
        pushVert(p10)
        pushVert(p10)
        pushVert(p01)
        pushVert(p11)
      }
    }
    mesh.addVertices(verts, uvs)
    mesh.setOrtho(mesh.width, mesh.height)
    this.inner.add(mesh)
    this.mesh = mesh
  }

  /** Load textures for a manifest (whole-body image or per-part images). Call in scene preload/create. */
  static async loadTextures(scene: Phaser.Scene, manifest: FighterManifest): Promise<void> {
    const load = (key: string, url: string, what: string) =>
      new Promise<void>((resolve, reject) => {
        if (scene.textures.exists(key)) return resolve()
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          scene.textures.addImage(key, img)
          resolve()
        }
        img.onerror = () => reject(new Error(`Failed to load ${what}`))
        img.src = url
      })
    if (manifest.body) {
      await load(`${manifest.id}:body`, manifest.body.url, 'body image')
      return
    }
    await Promise.all(
      manifest.parts.map((part) => load(`${manifest.id}:${part.partType}`, part.url, `part: ${part.partType}`)),
    )
  }

  applyPose(pose: Pose, facing: 1 | -1) {
    this.inner.setScale(facing, 1)
    const root = pose.root
    this.inner.setPosition(root?.dx ?? 0, root?.dy ?? 0)
    if (this.mesh) {
      const bones = posedBones(pose, this.bindBones)
      const verts = this.mesh.vertices
      const n = this.skin.length
      const gx = new Float32Array(n)
      const gy = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let x = 0
        let y = 0
        for (const inf of this.skin[i]) {
          const b = bones[inf.bone]
          const dx = b.bx - b.ax
          const dy = b.by - b.ay
          x += inf.w * (b.ax + inf.u * dx + inf.v * dy)
          y += inf.w * (b.ay + inf.u * dy - inf.v * dx)
        }
        gx[i] = x
        gy[i] = y
      }
      for (let k = 0; k < verts.length; k++) {
        const gi = this.vertGrid[k]
        verts[k].x = gx[gi]
        verts[k].y = -gy[gi]
      }
      if (this.flashOverlay > 0) {
        this.flashOverlay--
        this.mesh.setAlpha(0.45)
      } else {
        this.mesh.setAlpha(1)
      }
      return
    }
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
