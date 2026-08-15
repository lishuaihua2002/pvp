import type { FighterManifest, FighterPart, PartType } from '../types/fighter'

/** Builtin demo fighters drawn procedurally on canvas (no copyright risk). */

interface PresetTheme {
  id: string
  name: string
  description: string
  skin: string
  outfit: string
  accent: string
  headShape: 'round' | 'square'
}

const THEMES: PresetTheme[] = [
  { id: 'preset-blaze', name: 'Blaze', description: 'Hot-blooded street boxer', skin: '#f2c19b', outfit: '#e6392f', accent: '#ffd23e', headShape: 'round' },
  { id: 'preset-frost', name: 'Frost', description: 'Cool-headed kick master', skin: '#e8d3c0', outfit: '#2f7fe6', accent: '#3edcff', headShape: 'square' },
  { id: 'preset-viper', name: 'Viper', description: 'Agile shadow fighter', skin: '#d9b48f', outfit: '#3fa34d', accent: '#b6ff3e', headShape: 'round' },
  { id: 'preset-volt', name: 'Volt', description: 'Electric warrior from the future', skin: '#c9cdd6', outfit: '#8438e6', accent: '#ffd23e', headShape: 'square' },
]

const PART_SIZES: Record<PartType, { w: number; h: number }> = {
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

function drawPart(theme: PresetTheme, part: PartType): string {
  const { w, h } = PART_SIZES[part]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.lineWidth = 2
  g.strokeStyle = '#1a1020'

  const rounded = (x: number, y: number, ww: number, hh: number, r: number, fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    g.roundRect(x, y, ww, hh, r)
    g.fill()
    g.stroke()
  }

  if (part === 'head') {
    const r = theme.headShape === 'round' ? 22 : 8
    rounded(3, 3, w - 6, h - 6, r, theme.skin)
    // eyes
    g.fillStyle = '#1a1020'
    g.beginPath()
    g.arc(w * 0.38, h * 0.45, 3.4, 0, Math.PI * 2)
    g.arc(w * 0.68, h * 0.45, 3.4, 0, Math.PI * 2)
    g.fill()
    // headband
    g.fillStyle = theme.accent
    g.fillRect(3, 10, w - 6, 8)
    // mouth
    g.strokeStyle = '#1a1020'
    g.beginPath()
    g.moveTo(w * 0.42, h * 0.68)
    g.lineTo(w * 0.66, h * 0.68)
    g.stroke()
  } else if (part === 'torso') {
    rounded(4, 3, w - 8, h - 6, 12, theme.outfit)
    g.fillStyle = theme.accent
    g.fillRect(w / 2 - 4, 6, 8, h - 14)
    // belt
    g.fillStyle = '#1a1020'
    g.fillRect(4, h - 16, w - 8, 8)
  } else if (part.includes('upper-arm')) {
    rounded(2, 2, w - 4, h - 4, 9, theme.outfit)
  } else if (part.includes('lower-arm')) {
    rounded(2, 2, w - 4, h - 18, 8, theme.skin)
    // glove/fist
    rounded(1, h - 20, w - 2, 18, 8, theme.accent)
  } else if (part.includes('upper-leg')) {
    rounded(2, 2, w - 4, h - 4, 9, theme.outfit)
  } else {
    // lower leg + shoe
    rounded(3, 2, w - 6, h - 16, 8, theme.skin)
    rounded(0, h - 16, w, 14, 6, '#1a1020')
  }
  return canvas.toDataURL('image/png')
}

/** Stick-figure fighter: line limbs with shoulder bar, hip bar, hands and feet. */
function drawStickPart(part: PartType): string {
  const { w, h } = PART_SIZES[part]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.strokeStyle = '#f5f5f5'
  g.fillStyle = '#f5f5f5'
  g.lineWidth = 6
  g.lineCap = 'round'

  if (part === 'head') {
    // hollow head with eyes
    g.beginPath()
    g.arc(w / 2, h / 2, Math.min(w, h) / 2 - 5, 0, Math.PI * 2)
    g.stroke()
    g.beginPath()
    g.arc(w * 0.38, h * 0.45, 2.6, 0, Math.PI * 2)
    g.arc(w * 0.66, h * 0.45, 2.6, 0, Math.PI * 2)
    g.fill()
  } else if (part === 'torso') {
    // spine with shoulder bar (top) and hip bar (bottom)
    g.beginPath()
    g.moveTo(w / 2, 6)
    g.lineTo(w / 2, h - 6)
    g.stroke()
    g.beginPath()
    g.moveTo(6, 8)
    g.lineTo(w - 6, 8)
    g.stroke()
    g.beginPath()
    g.moveTo(10, h - 8)
    g.lineTo(w - 10, h - 8)
    g.stroke()
  } else if (part.includes('lower-arm')) {
    // forearm line ending in a hand
    g.beginPath()
    g.moveTo(w / 2, 4)
    g.lineTo(w / 2, h - 12)
    g.stroke()
    g.beginPath()
    g.arc(w / 2, h - 9, 7, 0, Math.PI * 2)
    g.fill()
  } else if (part.includes('lower-leg')) {
    // shin line ending in a foot
    g.beginPath()
    g.moveTo(w / 2, 4)
    g.lineTo(w / 2, h - 8)
    g.stroke()
    g.beginPath()
    g.moveTo(w / 2, h - 5)
    g.lineTo(w - 1, h - 5)
    g.stroke()
  } else {
    // upper arm / thigh: plain line
    g.beginPath()
    g.moveTo(w / 2, 4)
    g.lineTo(w / 2, h - 4)
    g.stroke()
  }
  return canvas.toDataURL('image/png')
}

function buildStickman(): FighterManifest {
  const parts: FighterPart[] = (Object.keys(PART_SIZES) as PartType[]).map((pt, i) => {
    const { w, h } = PART_SIZES[pt]
    return {
      partType: pt,
      url: drawStickPart(pt),
      width: w,
      height: h,
      pivotX: w / 2,
      pivotY: pt === 'head' ? h - 4 : 6,
      sortOrder: i,
    }
  })
  return {
    id: 'preset-stickman',
    ownerId: 'builtin',
    name: 'Stickman',
    description: 'Classic stick figure with shoulders, hips, hands and feet',
    parts,
    scale: 1,
    preset: true,
  }
}

let cache: FighterManifest[] | null = null

export function getPresetFighters(): FighterManifest[] {
  if (cache) return cache
  const themed = THEMES.map((theme) => {
    const parts: FighterPart[] = (Object.keys(PART_SIZES) as PartType[]).map((pt, i) => {
      const { w, h } = PART_SIZES[pt]
      return {
        partType: pt,
        url: drawPart(theme, pt),
        width: w,
        height: h,
        pivotX: w / 2,
        pivotY: pt === 'head' ? h - 4 : 6,
        sortOrder: i,
      }
    })
    return {
      id: theme.id,
      ownerId: 'builtin',
      name: theme.name,
      description: theme.description,
      parts,
      scale: 1,
      preset: true,
    }
  })
  cache = [...themed, buildStickman()]
  return cache
}

export function getPresetById(id: string): FighterManifest | undefined {
  return getPresetFighters().find((f) => f.id === id)
}
