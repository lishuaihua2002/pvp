import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { saveFighter } from '../lib/supabase/fighters'
import { supabaseConfigured } from '../lib/supabase/client'
import { saveLocalFighter } from '../lib/localFighters'
import { ALL_PART_TYPES, type PartType, type FighterManifest, type FighterPart } from '../types/fighter'
import PhaserArena from '../components/PhaserArena'
import { initAudio, playSfx } from '../game/audio/sfx'
import { boneDistance, detectPose, segmentPerson, type Bone } from '../lib/poseDetect'

const PART_LABELS: Record<PartType, string> = {
  head: 'Head',
  torso: 'Torso',
  'left-upper-arm': 'L Upper Arm',
  'left-lower-arm': 'L Forearm',
  'right-upper-arm': 'R Upper Arm',
  'right-lower-arm': 'R Forearm',
  'left-upper-leg': 'L Thigh',
  'left-lower-leg': 'L Shin',
  'right-upper-leg': 'R Thigh',
  'right-lower-leg': 'R Shin',
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** rotation around box center, radians (canvas clockwise) */
  angle: number
}

interface EraseStroke {
  part: PartType
  points: { x: number; y: number }[]
  radius: number
}

type Action = { kind: 'rect'; part: PartType; prev: Rect } | { kind: 'stroke'; index: number }

const MAX_DIM = 1024
const MAX_FILE = 10 * 1024 * 1024

/** default humanoid layout, proportional to image (assumes person roughly centered, full body) */
function defaultRects(w: number, h: number): Record<PartType, Rect> {
  const cx = w / 2
  const r = (x: number, y: number, rw: number, rh: number): Rect => ({
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(rw),
    h: Math.round(rh),
    angle: 0,
  })
  return {
    head: r(cx - w * 0.11, h * 0.02, w * 0.22, h * 0.2),
    torso: r(cx - w * 0.14, h * 0.22, w * 0.28, h * 0.28),
    'left-upper-arm': r(cx - w * 0.26, h * 0.24, w * 0.11, h * 0.16),
    'left-lower-arm': r(cx - w * 0.28, h * 0.4, w * 0.11, h * 0.16),
    'right-upper-arm': r(cx + w * 0.15, h * 0.24, w * 0.11, h * 0.16),
    'right-lower-arm': r(cx + w * 0.17, h * 0.4, w * 0.11, h * 0.16),
    'left-upper-leg': r(cx - w * 0.14, h * 0.5, w * 0.13, h * 0.2),
    'left-lower-leg': r(cx - w * 0.14, h * 0.7, w * 0.13, h * 0.24),
    'right-upper-leg': r(cx + w * 0.01, h * 0.5, w * 0.13, h * 0.2),
    'right-lower-leg': r(cx + w * 0.01, h * 0.7, w * 0.13, h * 0.24),
  }
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Failed to decode image'))
      i.src = url
    })
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    // drawImage re-encodes pixels: EXIF and metadata are stripped
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to export image'))), 'image/webp', quality)
  })
}

export default function FighterEditorPage() {
  const navigate = useNavigate()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null)
  const [bones, setBones] = useState<Record<PartType, Bone> | null>(null)
  const [removeBackground, setRemoveBackground] = useState(true)
  const [rects, setRects] = useState<Record<PartType, Rect> | null>(null)
  const [selectedPart, setSelectedPart] = useState<PartType>('head')
  const [mode, setMode] = useState<'move' | 'resize' | 'rotate' | 'erase'>('move')
  const [detecting, setDetecting] = useState(false)
  const [brushRadius, setBrushRadius] = useState(14)
  const [strokes, setStrokes] = useState<EraseStroke[]>([])
  const [undoStack, setUndoStack] = useState<Action[]>([])
  const [redoStack, setRedoStack] = useState<Action[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewManifest, setPreviewManifest] = useState<FighterManifest | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origin: Rect; stroke?: EraseStroke } | null>(null)

  const onFile = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    if (!/image\/(jpeg|png|webp)/.test(file.type)) {
      setError('Only JPG / PNG / WEBP formats are supported')
      return
    }
    if (file.size > MAX_FILE) {
      setError('Image must be under 10MB')
      return
    }
    try {
      const canvas = await fileToCanvas(file)
      setPhoto(canvas)
      setRects(defaultRects(canvas.width, canvas.height))
      setStrokes([])
      setUndoStack([])
      setRedoStack([])
      setMask(null)
      setBones(null)
      // best-effort: segment the person in the background so parts get smooth cutouts
      segmentPerson(canvas).then(setMask, () => setMask(null))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // redraw overlay
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !photo || !rects) return
    canvas.width = photo.width
    canvas.height = photo.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(photo, 0, 0)
    // erase strokes preview
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#141126'
    for (const s of strokes) {
      for (const p of s.points) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
    for (const pt of ALL_PART_TYPES) {
      const r = rects[pt]
      const active = pt === selectedPart
      ctx.save()
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
      ctx.rotate(r.angle)
      ctx.strokeStyle = active ? '#ff3d6e' : 'rgba(15,245,224,0.45)'
      ctx.lineWidth = active ? 3 : 1.5
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h)
      if (active) {
        ctx.fillStyle = '#ff3d6e'
        ctx.font = 'bold 16px sans-serif'
        ctx.fillText(PART_LABELS[pt], -r.w / 2 + 4, -r.h / 2 + 18)
        ctx.fillRect(r.w / 2 - 8, r.h / 2 - 8, 8, 8)
      }
      ctx.restore()
    }
  }, [photo, rects, selectedPart, strokes])

  const toImageCoords = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const box = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - box.left) / box.width) * canvas.width,
      y: ((e.clientY - box.top) / box.height) * canvas.height,
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!rects) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toImageCoords(e)
    if (mode === 'erase') {
      const stroke: EraseStroke = { part: selectedPart, points: [{ x, y }], radius: brushRadius }
      dragRef.current = { startX: x, startY: y, origin: rects[selectedPart], stroke }
      setStrokes((s) => [...s, stroke])
      return
    }
    // click inside another part selects it (accounting for box rotation)
    const inRect = (r: Rect) => {
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const cos = Math.cos(-r.angle)
      const sin = Math.sin(-r.angle)
      const lx = (x - cx) * cos - (y - cy) * sin
      const ly = (x - cx) * sin + (y - cy) * cos
      return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2
    }
    const hit = [...ALL_PART_TYPES].reverse().find((pt) => inRect(rects[pt]))
    if (hit && hit !== selectedPart) setSelectedPart(hit)
    const part = hit ?? selectedPart
    dragRef.current = { startX: x, startY: y, origin: { ...rects[part] } }
    setUndoStack((s) => [...s, { kind: 'rect', part, prev: { ...rects[part] } }])
    setRedoStack([])
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !rects) return
    const { x, y } = toImageCoords(e)
    if (mode === 'erase' && drag.stroke) {
      drag.stroke.points.push({ x, y })
      setStrokes((s) => [...s])
      return
    }
    const dx = x - drag.startX
    const dy = y - drag.startY
    const part = selectedPart
    if (mode === 'resize') {
      setRects({
        ...rects,
        [part]: {
          ...drag.origin,
          w: Math.max(12, drag.origin.w + dx),
          h: Math.max(12, drag.origin.h + dy),
        },
      })
    } else if (mode === 'rotate') {
      const cx = drag.origin.x + drag.origin.w / 2
      const cy = drag.origin.y + drag.origin.h / 2
      const a0 = Math.atan2(drag.startY - cy, drag.startX - cx)
      const a1 = Math.atan2(y - cy, x - cx)
      setRects({ ...rects, [part]: { ...drag.origin, angle: drag.origin.angle + (a1 - a0) } })
    } else {
      setRects({ ...rects, [part]: { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy } })
    }
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    if (drag?.stroke) {
      setUndoStack((s) => [...s, { kind: 'stroke', index: strokes.length - 1 }])
      setRedoStack([])
    }
    dragRef.current = null
  }

  const undo = () => {
    const action = undoStack[undoStack.length - 1]
    if (!action || !rects) return
    setUndoStack((s) => s.slice(0, -1))
    if (action.kind === 'rect') {
      setRedoStack((s) => [...s, { kind: 'rect', part: action.part, prev: { ...rects[action.part] } }])
      setRects({ ...rects, [action.part]: action.prev })
    } else {
      setRedoStack((s) => [...s, action])
      setStrokes((s) => s.slice(0, -1))
    }
  }

  const redo = () => {
    const action = redoStack[redoStack.length - 1]
    if (!action || !rects) return
    setRedoStack((s) => s.slice(0, -1))
    if (action.kind === 'rect') {
      setUndoStack((s) => [...s, { kind: 'rect', part: action.part, prev: { ...rects[action.part] } }])
      setRects({ ...rects, [action.part]: action.prev })
    }
  }

  const buildParts = (): { part: FighterPart; canvas: HTMLCanvasElement }[] => {
    if (!photo || !rects) return []
    return ALL_PART_TYPES.map((pt, i) => {
      const r = rects[pt]
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(r.w))
      c.height = Math.max(1, Math.round(r.h))
      const ctx = c.getContext('2d')!
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      // sample the rotated box from the photo into an upright part image
      ctx.save()
      ctx.translate(c.width / 2, c.height / 2)
      ctx.rotate(-r.angle)
      ctx.drawImage(photo, -cx, -cy)
      ctx.restore()
      if (removeBackground && mask) {
        // keep only person pixels (same rotated sampling as the photo)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.save()
        ctx.translate(c.width / 2, c.height / 2)
        ctx.rotate(-r.angle)
        ctx.drawImage(mask, -cx, -cy)
        ctx.restore()
        ctx.globalCompositeOperation = 'source-over'
      }
      if (removeBackground && mask && bones) {
        // skeleton-guided cut: each person pixel belongs to its nearest bone,
        // with a soft blend band so joints overlap slightly instead of leaving gaps
        const img = ctx.getImageData(0, 0, c.width, c.height)
        const data = img.data
        const cosA = Math.cos(r.angle)
        const sinA = Math.sin(r.angle)
        const boneList = ALL_PART_TYPES.map((t) => bones[t])
        const myBone = bones[pt]
        for (let py = 0; py < c.height; py++) {
          for (let px = 0; px < c.width; px++) {
            const o = (py * c.width + px) * 4 + 3
            if (data[o] === 0) continue
            const lx = px - c.width / 2
            const ly = py - c.height / 2
            const X = cx + lx * cosA - ly * sinA
            const Y = cy + lx * sinA + ly * cosA
            let best = Infinity
            for (const b of boneList) {
              const d = boneDistance(X, Y, b)
              if (d < best) best = d
            }
            const mine = boneDistance(X, Y, myBone)
            const band = best * 0.5 + 0.35
            const t = (mine - best) / band
            if (t > 1) data[o] = 0
            else if (t > 0) data[o] = Math.round(data[o] * (1 - t))
          }
        }
        ctx.putImageData(img, 0, 0)
      } else if (removeBackground && mask) {
        // person outline comes from segmentation; only soften the joint cut lines
        const feather = Math.max(2, c.height * 0.06)
        const grad = ctx.createLinearGradient(0, 0, 0, c.height)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(feather / c.height, 'rgba(255,255,255,1)')
        grad.addColorStop(1 - feather / c.height, 'rgba(255,255,255,1)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.globalCompositeOperation = 'destination-in'
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, c.width, c.height)
      } else {
        // no segmentation: feathered rounded-rect mask removes hard box corners
        const feather = Math.max(2, Math.min(c.width, c.height) * 0.08)
        const radius = Math.min(c.width, c.height) * 0.25
        const fm = document.createElement('canvas')
        fm.width = c.width
        fm.height = c.height
        const fctx = fm.getContext('2d')!
        fctx.filter = `blur(${feather}px)`
        fctx.fillStyle = '#fff'
        fctx.beginPath()
        fctx.roundRect(feather, feather, c.width - feather * 2, c.height - feather * 2, radius)
        fctx.fill()
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(fm, 0, 0)
      }
      ctx.globalCompositeOperation = 'destination-out'
      const cos = Math.cos(-r.angle)
      const sin = Math.sin(-r.angle)
      for (const s of strokes) {
        if (s.part !== pt) continue
        for (const p of s.points) {
          const lx = (p.x - cx) * cos - (p.y - cy) * sin + c.width / 2
          const ly = (p.x - cx) * sin + (p.y - cy) * cos + c.height / 2
          ctx.beginPath()
          ctx.arc(lx, ly, s.radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      const part: FighterPart = {
        partType: pt,
        url: c.toDataURL('image/png'),
        width: c.width,
        height: c.height,
        pivotX: c.width / 2,
        pivotY: pt === 'head' ? c.height - 4 : 6,
        sortOrder: i,
      }
      return { part, canvas: c }
    })
  }

  const autoDetect = async () => {
    if (!photo) return
    setError(null)
    setDetecting(true)
    try {
      const pose = await detectPose(photo)
      if (!pose) {
        setError('No person detected in the photo. Try a clearer full-body shot, or adjust the boxes manually.')
        return
      }
      setRects(pose.boxes)
      setBones(pose.bones)
      setUndoStack([])
      setRedoStack([])
      playSfx('ready')
    } catch (e) {
      setError(`Auto-detect failed: ${(e as Error).message}`)
    } finally {
      setDetecting(false)
    }
  }

  const preview = () => {
    initAudio()
    playSfx('click')
    const parts = buildParts()
    if (!parts.length) return
    setPreviewManifest({
      id: 'editor-preview',
      ownerId: userId ?? 'me',
      name: name || 'My Fighter',
      parts: parts.map((p) => p.part),
      scale: 1,
    })
  }

  const save = async () => {
    setError(null)
    if (!photo) return
    if (!name.trim()) {
      setError('Please give your fighter a name')
      return
    }
    setSaving(true)
    try {
      const built = buildParts()
      if (!supabaseConfigured || !userId) {
        // local mode: store in the browser
        saveLocalFighter({
          id: `local-${Date.now()}`,
          ownerId: 'local',
          name: name.trim(),
          parts: built.map(({ part }) => part),
          scale: 1,
        })
        playSfx('ready')
        navigate('/local-test')
        return
      }
      const partBlobs = await Promise.all(
        built.map(async ({ part, canvas }) => ({
          partType: part.partType,
          blob: await canvasToBlob(canvas),
          width: part.width,
          height: part.height,
          pivotX: part.pivotX,
          pivotY: part.pivotY,
        })),
      )
      const thumbCanvas = document.createElement('canvas')
      const ts = 256 / Math.max(photo.width, photo.height)
      thumbCanvas.width = Math.round(photo.width * ts)
      thumbCanvas.height = Math.round(photo.height * ts)
      thumbCanvas.getContext('2d')!.drawImage(photo, 0, 0, thumbCanvas.width, thumbCanvas.height)
      await saveFighter(userId, {
        name: name.trim(),
        description: '',
        parts: partBlobs,
        thumbnail: await canvasToBlob(thumbCanvas),
        original: await canvasToBlob(photo),
        scale: 1,
      })
      playSfx('ready')
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (previewManifest) {
    return (
      <div className="relative h-full w-full bg-black">
        <PhaserArena
          config={{
            mode: 'preview',
            localPlayerId: 'preview',
            remotePlayerId: 'dummy',
            localFighter: previewManifest,
            remoteFighter: previewManifest,
            localName: previewManifest.name,
            remoteName: '',
            isHost: true,
            onExit: () => setPreviewManifest(null),
          }}
        />
        <button
          className="btn-secondary absolute left-3 top-3 z-10"
          onClick={() => setPreviewManifest(null)}
        >
          ← Back to editor
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-arcade-cyan">📷 Photo Fighter Editor</h1>
        <Link className="btn-secondary" to={supabaseConfigured && session ? '/' : '/local-test'}>
          Back
        </Link>
      </header>

      {profile?.is_anonymous && (
        <div className="rounded-lg bg-yellow-900/40 border border-yellow-600 p-3 text-sm text-yellow-200">
          Fighters created as a guest may not be recoverable after you leave. Consider registering an account.
        </div>
      )}
      {(!supabaseConfigured || !session) && (
        <div className="rounded-lg bg-blue-900/40 border border-blue-600 p-3 text-sm text-blue-200">
          Local mode: your fighter will be saved in this browser and usable in Local Versus.
        </div>
      )}

      {error && <div className="rounded-lg bg-red-900/40 border border-red-600 p-3 text-sm text-red-200">{error}</div>}

      {!photo ? (
        <label className="panel flex h-64 cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed border-arcade-border hover:border-arcade-cyan">
          <div className="text-4xl">📤</div>
          <div className="font-bold">Click to upload a full-body photo</div>
          <div className="text-xs text-gray-500">JPG / PNG / WEBP, max 10MB · A front-facing standing full-body photo works best · The image is compressed in your browser and EXIF data is removed</div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="panel lg:col-span-2">
            <canvas
              ref={canvasRef}
              className="w-full touch-none rounded-lg"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            <div className="mt-2 text-xs text-gray-500">
              Drag to move the selected part box. In Resize mode, drag to change its size; in Rotate mode, drag around the box to tilt it. Use the Eraser to paint away the background (applies to the current part).
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="panel">
              <button
                className="btn-primary mb-3 w-full"
                disabled={detecting}
                onClick={() => void autoDetect()}
              >
                {detecting ? 'Detecting...' : '\u2728 Auto-detect body parts'}
              </button>
              <label className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={removeBackground}
                  onChange={(e) => setRemoveBackground(e.target.checked)}
                  disabled={!mask}
                />
                Smooth cutout (auto-remove background{mask ? '' : ' — unavailable for this photo'})
              </label>
              <div className="mb-2 text-sm font-bold text-arcade-cyan">Body parts</div>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_PART_TYPES.map((pt) => (
                  <button
                    key={pt}
                    className={`${selectedPart === pt ? 'btn-primary' : 'btn-secondary'} text-xs`}
                    onClick={() => setSelectedPart(pt)}
                  >
                    {PART_LABELS[pt]}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="mb-2 text-sm font-bold text-arcade-cyan">Tools</div>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ['move', 'Move'],
                    ['resize', 'Resize'],
                    ['rotate', 'Rotate'],
                    ['erase', 'Eraser'],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={`${mode === m ? 'btn-primary' : 'btn-secondary'} text-xs`} onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              {mode === 'erase' && (
                <div className="mt-2">
                  <label className="text-xs text-gray-400">Brush size: {brushRadius}px</label>
                  <input
                    type="range"
                    min={4}
                    max={40}
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button className="btn-secondary text-xs" disabled={undoStack.length === 0} onClick={undo}>
                  ↩ Undo
                </button>
                <button className="btn-secondary text-xs" disabled={redoStack.length === 0} onClick={redo}>
                  ↪ Redo
                </button>
              </div>
            </div>

            <div className="panel flex flex-col gap-2">
              <input
                className="input"
                placeholder="Fighter name"
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn-secondary" onClick={preview}>
                👀 Animation preview
              </button>
              <button className="btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving...' : '💾 Save fighter'}
              </button>
              <button
                className="btn-warn text-xs"
                onClick={() => {
                  setPhoto(null)
                  setRects(null)
                  setStrokes([])
                }}
              >
                Upload a different photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
