import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision'
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

let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null

function getFileset() {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks('/mediapipe-wasm')
    filesetPromise.catch(() => {
      filesetPromise = null
    })
  }
  return filesetPromise
}

let landmarkerPromise: Promise<PoseLandmarker> | null = null

function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await getFileset()
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

let segmenterPromise: Promise<ImageSegmenter> | null = null

function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = await getFileset()
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    })()
    segmenterPromise.catch(() => {
      segmenterPromise = null
    })
  }
  return segmenterPromise
}

/**
 * Segments the person out of the photo. Returns a grayscale-alpha mask canvas
 * at the photo's size (opaque = person, transparent = background), or null on failure.
 */
export async function segmentPerson(photo: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  const segmenter = await getSegmenter()
  const result = segmenter.segment(photo)
  const mask = result.confidenceMasks?.[0]
  if (!mask) {
    result.close()
    return null
  }
  try {
    const mw = mask.width
    const mh = mask.height
    const values = mask.getAsFloat32Array()
    const imageData = new ImageData(mw, mh)
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      // soft alpha ramp keeps edges smooth while dropping clear background
      const a = v < 0.25 ? 0 : v > 0.75 ? 255 : Math.round(((v - 0.25) / 0.5) * 255)
      const o = i * 4
      imageData.data[o] = 255
      imageData.data[o + 1] = 255
      imageData.data[o + 2] = 255
      imageData.data[o + 3] = a
    }
    const small = document.createElement('canvas')
    small.width = mw
    small.height = mh
    small.getContext('2d')!.putImageData(imageData, 0, 0)
    const out = document.createElement('canvas')
    out.width = photo.width
    out.height = photo.height
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(small, 0, 0, out.width, out.height)
    return out
  } finally {
    result.close()
  }
}

export interface Pt {
  x: number
  y: number
}

/** Editable skeleton joints (image space, l/r = image side). */
export type JointId =
  | 'head'
  | 'shoulder-l'
  | 'shoulder-r'
  | 'elbow-l'
  | 'elbow-r'
  | 'hand-l'
  | 'hand-r'
  | 'hip-l'
  | 'hip-r'
  | 'knee-l'
  | 'knee-r'
  | 'foot-l'
  | 'foot-r'

export const ALL_JOINTS: JointId[] = [
  'head',
  'shoulder-l',
  'shoulder-r',
  'elbow-l',
  'elbow-r',
  'hand-l',
  'hand-r',
  'hip-l',
  'hip-r',
  'knee-l',
  'knee-r',
  'foot-l',
  'foot-r',
]

export type JointPoints = Record<JointId, Pt>

/** Skeleton edges for drawing (joint pairs). */
export const JOINT_EDGES: [JointId, JointId][] = [
  ['shoulder-l', 'shoulder-r'],
  ['shoulder-l', 'elbow-l'],
  ['elbow-l', 'hand-l'],
  ['shoulder-r', 'elbow-r'],
  ['elbow-r', 'hand-r'],
  ['hip-l', 'hip-r'],
  ['hip-l', 'knee-l'],
  ['knee-l', 'foot-l'],
  ['hip-r', 'knee-r'],
  ['knee-r', 'foot-r'],
]

/** A bone segment in photo coordinates, used to assign person pixels to parts. */
export interface Bone {
  ax: number
  ay: number
  bx: number
  by: number
  /** typical half-width of this limb, used to normalize distances */
  halfW: number
}

export interface PoseResult {
  joints: JointPoints
  boxes: Record<PartType, PartBox>
  bones: Record<PartType, Bone>
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
  const pose = await detectPose(photo)
  return pose ? pose.boxes : null
}

/**
 * Detects a person and returns oriented part boxes plus the underlying bone
 * segments (photo coordinates), or null when no person is found.
 */
export async function detectPose(photo: HTMLCanvasElement): Promise<PoseResult | null> {
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
  const hipImgL = p(24)
  const hipImgR = p(23)
  const kneeImgL = p(26)
  const kneeImgR = p(25)
  // finger / toe tips so hands and feet are included in the part boxes
  const handImgL = p(20)
  const handImgR = p(19)
  const footImgL = p(32)
  const footImgR = p(31)

  const joints: JointPoints = {
    head: mid(mid(earL, earR), nose),
    'shoulder-l': shoulderImgL,
    'shoulder-r': shoulderImgR,
    'elbow-l': elbowImgL,
    'elbow-r': elbowImgR,
    'hand-l': handImgL,
    'hand-r': handImgR,
    'hip-l': hipImgL,
    'hip-r': hipImgR,
    'knee-l': kneeImgL,
    'knee-r': kneeImgR,
    'foot-l': footImgL,
    'foot-r': footImgR,
  }
  return poseFromJoints(joints)
}

/** Builds oriented part boxes and cutting bones from editable joint points. */
export function poseFromJoints(j: JointPoints): PoseResult {
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const shoulderW = Math.max(24, Math.hypot(j['shoulder-l'].x - j['shoulder-r'].x, j['shoulder-l'].y - j['shoulder-r'].y))
  const armW = shoulderW * 0.38
  const legW = shoulderW * 0.48
  const midShoulder = mid(j['shoulder-l'], j['shoulder-r'])
  const midHip = mid(j['hip-l'], j['hip-r'])
  const headCenter = j.head
  const headW = shoulderW * 0.95
  const headH = headW * 1.25

  const boxes: Record<PartType, PartBox> = {
    head: {
      x: headCenter.x - headW / 2,
      y: headCenter.y - headH / 2,
      w: headW,
      h: headH,
      angle: 0,
    },
    torso: seg(midShoulder, midHip, shoulderW * 1.45, 1.2),
    'left-upper-arm': seg(j['shoulder-l'], j['elbow-l'], armW),
    'left-lower-arm': seg(j['elbow-l'], j['hand-l'], armW * 0.95, 1.25),
    'right-upper-arm': seg(j['shoulder-r'], j['elbow-r'], armW),
    'right-lower-arm': seg(j['elbow-r'], j['hand-r'], armW * 0.95, 1.25),
    'left-upper-leg': seg(j['hip-l'], j['knee-l'], legW),
    'left-lower-leg': seg(j['knee-l'], j['foot-l'], legW * 1.1, 1.2),
    'right-upper-leg': seg(j['hip-r'], j['knee-r'], legW),
    'right-lower-leg': seg(j['knee-r'], j['foot-r'], legW * 1.1, 1.2),
  }

  const bone = (a: Pt, b: Pt, halfW: number): Bone => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y, halfW })
  const crown: Pt = { x: headCenter.x, y: headCenter.y - headH * 0.4 }
  const bones: Record<PartType, Bone> = {
    head: bone(crown, midShoulder, headW * 0.55),
    torso: bone(midShoulder, midHip, shoulderW * 0.72),
    'left-upper-arm': bone(j['shoulder-l'], j['elbow-l'], armW / 2),
    'left-lower-arm': bone(j['elbow-l'], j['hand-l'], armW / 2),
    'right-upper-arm': bone(j['shoulder-r'], j['elbow-r'], armW / 2),
    'right-lower-arm': bone(j['elbow-r'], j['hand-r'], armW / 2),
    'left-upper-leg': bone(j['hip-l'], j['knee-l'], legW / 2),
    'left-lower-leg': bone(j['knee-l'], j['foot-l'], legW / 2),
    'right-upper-leg': bone(j['hip-r'], j['knee-r'], legW / 2),
    'right-lower-leg': bone(j['knee-r'], j['foot-r'], legW / 2),
  }

  return { joints: j, boxes, bones }
}

/** Normalized distance from a photo point to a bone (distance to segment / limb half-width). */
export function boneDistance(x: number, y: number, b: Bone): number {
  const dx = b.bx - b.ax
  const dy = b.by - b.ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((x - b.ax) * dx + (y - b.ay) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const px = b.ax + t * dx
  const py = b.ay + t * dy
  return Math.hypot(x - px, y - py) / Math.max(1, b.halfW)
}
