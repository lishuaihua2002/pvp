import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PartType } from '../types/fighter'

/** Browser-side body-part detection using MediaPipe Pose (runs fully locally). */

export interface PartBox {
  x: number
  y: number
  w: number
  h: number
  /** rotation around box center, radians (canvas clockwise) */
  angle: number
}

let landmarkerPromise: Promise<PoseLandmarker> | null = null

function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task' },
        runningMode: 'IMAGE',
        numPoses: 1,
      })
    })()
    landmarkerPromise.catch(() => {
      landmarkerPromise = null
    })
  }
  return landmarkerPromise
}

interface Pt {
  x: number
  y: number
}

/** Box spanning joint A (top) to joint B (bottom), rotated so its long axis follows the segment. */
function seg(a: Pt, b: Pt, width: number, lengthPad = 1.2): PartBox {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const len = Math.max(12, Math.hypot(b.x - a.x, b.y - a.y) * lengthPad)
  const angle = Math.atan2(-(b.x - a.x), b.y - a.y)
  return { x: cx - width / 2, y: cy - len / 2, w: width, h: len, angle }
}

/**
 * Detects a person in the photo and returns one oriented box per body part,
 * or null when no person is found.
 */
export async function detectPartBoxes(photo: HTMLCanvasElement): Promise<Record<PartType, PartBox> | null> {
  const landmarker = await getLandmarker()
  const result = landmarker.detect(photo)
  const lm = result.landmarks[0]
  if (!lm) return null
  const W = photo.width
  const H = photo.height
  const p = (i: number): Pt => ({ x: lm[i].x * W, y: lm[i].y * H })
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  // BlazePose indices. MediaPipe "left" is the person's left, which appears on
  // the image's right for a front-facing photo — editor part names follow the image side.
  const nose = p(0)
  const earL = p(7)
  const earR = p(8)
  const shoulderImgL = p(12)
  const shoulderImgR = p(11)
  const elbowImgL = p(14)
  const elbowImgR = p(13)
  const wristImgL = p(16)
  const wristImgR = p(15)
  const hipImgL = p(24)
  const hipImgR = p(23)
  const kneeImgL = p(26)
  const kneeImgR = p(25)
  const ankleImgL = p(28)
  const ankleImgR = p(27)

  const shoulderW = Math.max(24, Math.hypot(shoulderImgL.x - shoulderImgR.x, shoulderImgL.y - shoulderImgR.y))
  const armW = shoulderW * 0.38
  const legW = shoulderW * 0.48
  const midShoulder = mid(shoulderImgL, shoulderImgR)
  const midHip = mid(hipImgL, hipImgR)
  const headCenter = mid(mid(earL, earR), nose)
  const headW = shoulderW * 0.95
  const headH = headW * 1.25

  return {
    head: {
      x: headCenter.x - headW / 2,
      y: headCenter.y - headH / 2,
      w: headW,
      h: headH,
      angle: 0,
    },
    torso: seg(midShoulder, midHip, shoulderW * 1.45, 1.2),
    'left-upper-arm': seg(shoulderImgL, elbowImgL, armW),
    'left-lower-arm': seg(elbowImgL, wristImgL, armW * 0.95, 1.35),
    'right-upper-arm': seg(shoulderImgR, elbowImgR, armW),
    'right-lower-arm': seg(elbowImgR, wristImgR, armW * 0.95, 1.35),
    'left-upper-leg': seg(hipImgL, kneeImgL, legW),
    'left-lower-leg': seg(kneeImgL, ankleImgL, legW * 0.9, 1.3),
    'right-upper-leg': seg(hipImgR, kneeImgR, legW),
    'right-lower-leg': seg(kneeImgR, ankleImgR, legW * 0.9, 1.3),
  }
}
