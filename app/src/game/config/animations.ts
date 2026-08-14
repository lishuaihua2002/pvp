import type { ActionName } from '../../types/combat'
import type { PartType } from '../../types/fighter'

/** Pose: per-part rotation (radians) and offset (px, relative to bind pose) */
export type Pose = Partial<Record<PartType, { rot?: number; dx?: number; dy?: number }>> & {
  /** whole-body offset */
  root?: { dx?: number; dy?: number }
}

export interface Keyframe {
  /** time 0..1 of the action duration */
  t: number
  pose: Pose
}

export interface AnimationDefinition {
  name: ActionName
  /** duration in simulation frames (60fps) */
  durationFrames: number
  loop: boolean
  keyframes: Keyframe[]
  /** frames within which the attack hitbox is active */
  activeFrames?: [number, number]
  /** frame from which the action can be cancelled into another */
  cancelFrame?: number
}

const D = Math.PI / 180

export const ANIMATIONS: Record<ActionName, AnimationDefinition> = {
  idle: {
    name: 'idle',
    durationFrames: 90,
    loop: true,
    keyframes: [
      { t: 0, pose: { root: { dy: 0 }, head: { rot: 0 }, 'left-upper-arm': { rot: 8 * D }, 'right-upper-arm': { rot: -8 * D }, 'left-lower-arm': { rot: 10 * D }, 'right-lower-arm': { rot: -10 * D } } },
      { t: 0.5, pose: { root: { dy: 4 }, head: { rot: 2 * D }, 'left-upper-arm': { rot: 12 * D }, 'right-upper-arm': { rot: -12 * D }, 'left-lower-arm': { rot: 14 * D }, 'right-lower-arm': { rot: -14 * D } } },
      { t: 1, pose: { root: { dy: 0 }, head: { rot: 0 }, 'left-upper-arm': { rot: 8 * D }, 'right-upper-arm': { rot: -8 * D }, 'left-lower-arm': { rot: 10 * D }, 'right-lower-arm': { rot: -10 * D } } },
    ],
  },
  walk: {
    name: 'walk',
    durationFrames: 36,
    loop: true,
    keyframes: [
      { t: 0, pose: { torso: { rot: 4 * D }, 'left-upper-leg': { rot: 25 * D }, 'right-upper-leg': { rot: -25 * D }, 'left-lower-leg': { rot: -15 * D }, 'right-lower-leg': { rot: 20 * D }, 'left-upper-arm': { rot: -20 * D }, 'right-upper-arm': { rot: 20 * D } } },
      { t: 0.5, pose: { torso: { rot: 4 * D }, 'left-upper-leg': { rot: -25 * D }, 'right-upper-leg': { rot: 25 * D }, 'left-lower-leg': { rot: 20 * D }, 'right-lower-leg': { rot: -15 * D }, 'left-upper-arm': { rot: 20 * D }, 'right-upper-arm': { rot: -20 * D } } },
      { t: 1, pose: { torso: { rot: 4 * D }, 'left-upper-leg': { rot: 25 * D }, 'right-upper-leg': { rot: -25 * D }, 'left-lower-leg': { rot: -15 * D }, 'right-lower-leg': { rot: 20 * D }, 'left-upper-arm': { rot: -20 * D }, 'right-upper-arm': { rot: 20 * D } } },
    ],
  },
  jump: {
    name: 'jump',
    durationFrames: 48,
    loop: false,
    keyframes: [
      { t: 0, pose: { root: { dy: 6 }, 'left-upper-leg': { rot: 20 * D }, 'right-upper-leg': { rot: -20 * D }, 'left-lower-leg': { rot: -35 * D }, 'right-lower-leg': { rot: 35 * D } } },
      { t: 0.25, pose: { root: { dy: -4 }, 'left-upper-arm': { rot: -60 * D }, 'right-upper-arm': { rot: 60 * D }, 'left-upper-leg': { rot: 35 * D }, 'right-upper-leg': { rot: -35 * D }, 'left-lower-leg': { rot: -60 * D }, 'right-lower-leg': { rot: 60 * D } } },
      { t: 0.7, pose: { 'left-upper-arm': { rot: -30 * D }, 'right-upper-arm': { rot: 30 * D }, 'left-upper-leg': { rot: 15 * D }, 'right-upper-leg': { rot: -15 * D } } },
      { t: 1, pose: { root: { dy: 4 }, 'left-upper-leg': { rot: 20 * D }, 'right-upper-leg': { rot: -20 * D }, 'left-lower-leg': { rot: -25 * D }, 'right-lower-leg': { rot: 25 * D } } },
    ],
  },
  punch: {
    name: 'punch',
    durationFrames: 22,
    loop: false,
    activeFrames: [6, 12],
    cancelFrame: 18,
    keyframes: [
      { t: 0, pose: { torso: { rot: -5 * D }, 'right-upper-arm': { rot: -30 * D }, 'right-lower-arm': { rot: -80 * D } } },
      { t: 0.28, pose: { torso: { rot: 12 * D }, 'right-upper-arm': { rot: -95 * D }, 'right-lower-arm': { rot: 5 * D }, root: { dx: 6 } } },
      { t: 0.55, pose: { torso: { rot: 12 * D }, 'right-upper-arm': { rot: -95 * D }, 'right-lower-arm': { rot: 0 }, root: { dx: 6 } } },
      { t: 1, pose: { torso: { rot: 0 }, 'right-upper-arm': { rot: -8 * D }, 'right-lower-arm': { rot: -10 * D } } },
    ],
  },
  kick: {
    name: 'kick',
    durationFrames: 34,
    loop: false,
    activeFrames: [12, 20],
    keyframes: [
      { t: 0, pose: { root: { dy: 8 }, torso: { rot: -8 * D }, 'left-upper-leg': { rot: 15 * D }, 'left-lower-leg': { rot: -40 * D } } },
      { t: 0.35, pose: { root: { dy: 14 }, torso: { rot: -18 * D }, 'right-upper-leg': { rot: -80 * D }, 'right-lower-leg': { rot: 10 * D }, 'left-upper-leg': { rot: 25 * D }, 'left-lower-leg': { rot: -50 * D } } },
      { t: 0.6, pose: { root: { dy: 12 }, torso: { rot: -14 * D }, 'right-upper-leg': { rot: -70 * D }, 'right-lower-leg': { rot: 5 * D } } },
      { t: 1, pose: { root: { dy: 0 } } },
    ],
  },
  hit: {
    name: 'hit',
    durationFrames: 18,
    loop: false,
    keyframes: [
      { t: 0, pose: { torso: { rot: -18 * D }, head: { rot: -25 * D }, 'left-upper-arm': { rot: 30 * D }, 'right-upper-arm': { rot: -35 * D }, root: { dx: -6 } } },
      { t: 0.5, pose: { torso: { rot: -12 * D }, head: { rot: -12 * D }, root: { dx: -3 } } },
      { t: 1, pose: {} },
    ],
  },
  knockdown: {
    name: 'knockdown',
    durationFrames: 80,
    loop: false,
    keyframes: [
      { t: 0, pose: { torso: { rot: -30 * D }, head: { rot: -30 * D }, root: { dx: -10 } } },
      { t: 0.3, pose: { torso: { rot: -85 * D }, head: { rot: -40 * D }, root: { dx: -30, dy: 90 }, 'left-upper-leg': { rot: 30 * D }, 'right-upper-leg': { rot: 40 * D } } },
      { t: 0.8, pose: { torso: { rot: -85 * D }, head: { rot: -40 * D }, root: { dx: -30, dy: 90 }, 'left-upper-leg': { rot: 30 * D }, 'right-upper-leg': { rot: 40 * D } } },
      { t: 1, pose: { torso: { rot: -85 * D }, root: { dx: -30, dy: 90 } } },
    ],
  },
  getup: {
    name: 'getup',
    durationFrames: 40,
    loop: false,
    keyframes: [
      { t: 0, pose: { torso: { rot: -85 * D }, root: { dx: -30, dy: 90 } } },
      { t: 0.5, pose: { torso: { rot: -35 * D }, root: { dx: -12, dy: 40 }, 'left-upper-leg': { rot: 30 * D }, 'left-lower-leg': { rot: -50 * D } } },
      { t: 1, pose: {} },
    ],
  },
  entrance: {
    name: 'entrance',
    durationFrames: 120,
    loop: false,
    keyframes: [
      { t: 0, pose: { torso: { rot: 4 * D }, 'left-upper-leg': { rot: 20 * D }, 'right-upper-leg': { rot: -20 * D } } },
      { t: 0.6, pose: { torso: { rot: 4 * D }, 'left-upper-leg': { rot: -20 * D }, 'right-upper-leg': { rot: 20 * D } } },
      { t: 0.8, pose: { 'left-upper-arm': { rot: -160 * D }, 'right-upper-arm': { rot: 160 * D }, root: { dy: -6 } } },
      { t: 1, pose: { 'left-upper-arm': { rot: -160 * D }, 'right-upper-arm': { rot: 160 * D } } },
    ],
  },
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** ease in-out */
function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Sample the pose of an animation at a given action frame. */
export function samplePose(anim: AnimationDefinition, frame: number): Pose {
  const t = Math.min(1, Math.max(0, frame / anim.durationFrames))
  const kfs = anim.keyframes
  let i = 0
  while (i < kfs.length - 1 && kfs[i + 1].t < t) i++
  const a = kfs[i]
  const b = kfs[Math.min(i + 1, kfs.length - 1)]
  const span = b.t - a.t
  const lt = span <= 0 ? 0 : ease((t - a.t) / span)

  const pose: Pose = {}
  const keys = new Set<string>([...Object.keys(a.pose), ...Object.keys(b.pose)])
  for (const key of keys) {
    const pa = a.pose[key as PartType] ?? {}
    const pb = b.pose[key as PartType] ?? {}
    pose[key as PartType] = {
      rot: lerp(pa.rot ?? 0, pb.rot ?? 0, lt),
      dx: lerp(pa.dx ?? 0, pb.dx ?? 0, lt),
      dy: lerp(pa.dy ?? 0, pb.dy ?? 0, lt),
    }
  }
  return pose
}
