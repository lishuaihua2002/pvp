export type PartType =
  | 'head'
  | 'torso'
  | 'left-upper-arm'
  | 'left-lower-arm'
  | 'right-upper-arm'
  | 'right-lower-arm'
  | 'left-upper-leg'
  | 'left-lower-leg'
  | 'right-upper-leg'
  | 'right-lower-leg'

export const ALL_PART_TYPES: PartType[] = [
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

export interface RigJoint {
  /** joint name, e.g. neck, left-shoulder */
  name: string
  /** attachment position in parent-part local coordinates (0..1 of part size) */
  x: number
  y: number
}

export interface FighterPart {
  partType: PartType
  /** storage path or data URL / builtin asset URL */
  url: string
  width: number
  height: number
  /** rotation pivot in local pixels */
  pivotX: number
  pivotY: number
  sortOrder: number
}

export interface FighterManifest {
  id: string
  ownerId: string
  name: string
  description?: string
  thumbnailUrl?: string
  parts: FighterPart[]
  /** overall render scale so fighters are roughly same height */
  scale: number
  /** whether this is a builtin preset fighter */
  preset?: boolean
}

export interface ColliderDefinition {
  bodyWidth: number
  bodyHeight: number
  headHurtbox: { x: number; y: number; w: number; h: number }
  torsoHurtbox: { x: number; y: number; w: number; h: number }
  legsHurtbox: { x: number; y: number; w: number; h: number }
  punchHitbox: { reach: number; y: number; w: number; h: number }
  kickHitbox: { reach: number; y: number; w: number; h: number }
}

export const DEFAULT_COLLIDERS: ColliderDefinition = {
  bodyWidth: 60,
  bodyHeight: 170,
  headHurtbox: { x: 0, y: -150, w: 46, h: 46 },
  torsoHurtbox: { x: 0, y: -100, w: 60, h: 70 },
  legsHurtbox: { x: 0, y: -35, w: 55, h: 70 },
  punchHitbox: { reach: 70, y: -105, w: 55, h: 35 },
  kickHitbox: { reach: 95, y: -30, w: 75, h: 35 },
}
