import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { saveFighter } from '../lib/supabase/fighters'
import { supabaseConfigured } from '../lib/supabase/client'
import { saveLocalFighter } from '../lib/localFighters'
import {
  ALL_PART_TYPES,
  type PartType,
  type FighterManifest,
  type FighterPart,
  type SkinnedBody,
} from '../types/fighter'
import PhaserArena from '../components/PhaserArena'
import { initAudio, playSfx } from '../game/audio/sfx'
import {
  ALL_JOINTS,
  JOINT_EDGES,
  boneDistance,
  detectPose,
  poseFromJoints,
  segmentPerson,
  type JointId,
  type JointPoints,
  type Pt,
} from '../lib/poseDetect'

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

const JOINT_LABELS: Record<JointId, string> = {
  head: 'Head center',
  'shoulder-l': 'L shoulder',
  'shoulder-r': 'R shoulder',
  'elbow-l': 'L elbow',
  'elbow-r': 'R elbow',
  'hand-l': 'L hand',
  'hand-r': 'R hand',
  'hip-l': 'L hip',
  'hip-r': 'R hip',
  'knee-l': 'L knee',
  'knee-r': 'R knee',
  'foot-l': 'L foot',
  'foot-r': 'R foot',
}

interface EraseStroke {
  part: PartType
  points: { x: number; y: number }[]
  radius: number
}

type Action = { kind: 'joint'; joint: JointId; prev: Pt } | { kind: 'stroke'; index: number }

const MAX_DIM = 1024
const MAX_FILE = 10 * 1024 * 1024

/** default humanoid joint layout, proportional to image (assumes person roughly centered, full body) */
function defaultJoints(w: number, h: number): JointPoints {
  const cx = w / 2
  const p = (x: number, y: number): Pt => ({ x: Math.round(x), y: Math.round(y) })
  return {
    head: p(cx, h * 0.12),
    'shoulder-l': p(cx - w * 0.14, h * 0.24),
    'shoulder-r': p(cx + w * 0.14, h * 0.24),
    'elbow-l': p(cx - w * 0.2, h * 0.4),
    'elbow-r': p(cx + w * 0.2, h * 0.4),
    'hand-l': p(cx - w * 0.23, h * 0.55),
    'hand-r': p(cx + w * 0.23, h * 0.55),
    'hip-l': p(cx - w * 0.08, h * 0.52),
    'hip-r': p(cx + w * 0.08, h * 0.52),
    'knee-l': p(cx - w * 0.09, h * 0.72),
    'knee-r': p(cx + w * 0.09, h * 0.72),
    'foot-l': p(cx - w * 0.1, h * 0.94),
    'foot-r': p(cx + w * 0.1, h * 0.94),
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
  const [joints, setJoints] = useState<JointPoints | null>(null)
  const [removeBackground, setRemoveBackground] = useState(true)
  const [selectedPart, setSelectedPart] = useState<PartType>('head')
  const [selectedJoint, setSelectedJoint] = useState<JointId | null>(null)
  const [mode, setMode] = useState<'joints' | 'erase'>('joints')
  const [detecting, setDetecting] = useState(false)
  const [brushRadius, setBrushRadius] = useState(14)
  const [strokes, setStrokes] = useState<EraseStroke[]>([])
  const [undoStack, setUndoStack] = useState<Action[]>([])
  const [redoStack, setRedoStack] = useState<Action[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewManifest, setPreviewManifest] = useState<FighterManifest | null>(null)
  const dragRef = useRef<{ joint?: JointId; stroke?: EraseStroke } | null>(null)

  const pose = useMemo(() => (joints ? poseFromJoints(joints) : null), [joints])
  const rects = pose?.boxes ?? null
  const bones = pose?.bones ?? null

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
      setJoints(defaultJoints(canvas.width, canvas.height))
      setStrokes([])
      setUndoStack([])
      setRedoStack([])
      setMask(null)
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
    // faint derived part boxes
    for (const pt of ALL_PART_TYPES) {
      const r = rects[pt]
      const active = mode === 'erase' && pt === selectedPart
      ctx.save()
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
      ctx.rotate(r.angle)
      ctx.strokeStyle = active ? '#ff3d6e' : 'rgba(15,245,224,0.25)'
      ctx.lineWidth = active ? 3 : 1
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h)
      ctx.restore()
    }
    // skeleton edges and joint handles
    if (joints) {
      ctx.strokeStyle = 'rgba(255,210,62,0.9)'
      ctx.lineWidth = 2
      for (const [a, b] of JOINT_EDGES) {
        ctx.beginPath()
        ctx.moveTo(joints[a].x, joints[a].y)
        ctx.lineTo(joints[b].x, joints[b].y)
        ctx.stroke()
      }
      const rad = Math.max(6, photo.width * 0.012)
      for (const id of ALL_JOINTS) {
        const p = joints[id]
        const active = id === selectedJoint
        ctx.beginPath()
        ctx.arc(p.x, p.y, active ? rad * 1.4 : rad, 0, Math.PI * 2)
        ctx.fillStyle = active ? '#ff3d6e' : 'rgba(255,210,62,0.95)'
        ctx.fill()
        ctx.strokeStyle = '#1a1020'
        ctx.stroke()
        if (active) {
          ctx.fillStyle = '#ff3d6e'
          ctx.font = 'bold 16px sans-serif'
          ctx.fillText(JOINT_LABELS[id], p.x + rad * 1.8, p.y - rad)
        }
      }
    }
  }, [photo, rects, joints, selectedJoint, selectedPart, mode, strokes])

  const toImageCoords = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const box = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - box.left) / box.width) * canvas.width,
      y: ((e.clientY - box.top) / box.height) * canvas.height,
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!joints || !photo) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toImageCoords(e)
    if (mode === 'erase') {
      const stroke: EraseStroke = { part: selectedPart, points: [{ x, y }], radius: brushRadius }
      dragRef.current = { stroke }
      setStrokes((s) => [...s, stroke])
      return
    }
    // grab the nearest joint within reach
    const grabDist = Math.max(20, photo.width * 0.035)
    let nearest: JointId | null = null
    let best = grabDist
    for (const id of ALL_JOINTS) {
      const d = Math.hypot(joints[id].x - x, joints[id].y - y)
      if (d < best) {
        best = d
        nearest = id
      }
    }
    if (!nearest) return
    setSelectedJoint(nearest)
    dragRef.current = { joint: nearest }
    setUndoStack((s) => [...s, { kind: 'joint', joint: nearest, prev: { ...joints[nearest] } }])
    setRedoStack([])
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !joints) return
    const { x, y } = toImageCoords(e)
    if (drag.stroke) {
      drag.stroke.points.push({ x, y })
      setStrokes((s) => [...s])
      return
    }
    if (drag.joint) {
      setJoints({ ...joints, [drag.joint]: { x, y } })
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
    if (!action || !joints) return
    setUndoStack((s) => s.slice(0, -1))
    if (action.kind === 'joint') {
      setRedoStack((s) => [...s, { kind: 'joint', joint: action.joint, prev: { ...joints[action.joint] } }])
      setJoints({ ...joints, [action.joint]: action.prev })
    } else {
      setRedoStack((s) => [...s, action])
      setStrokes((s) => s.slice(0, -1))
    }
  }

  const redo = () => {
    const action = redoStack[redoStack.length - 1]
    if (!action || !joints) return
    setRedoStack((s) => s.slice(0, -1))
    if (action.kind === 'joint') {
      setUndoStack((s) => [...s, { kind: 'joint', joint: action.joint, prev: { ...joints[action.joint] } }])
      setJoints({ ...joints, [action.joint]: action.prev })
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

  /**
   * Whole-person export: one background-removed image plus the skeleton joints,
   * rendered in combat via mesh skinning (no per-part cutting).
   */
  const buildBody = (): SkinnedBody | null => {
    if (!photo || !joints) return null
    const full = document.createElement('canvas')
    full.width = photo.width
    full.height = photo.height
    const ctx = full.getContext('2d')!
    ctx.drawImage(photo, 0, 0)
    if (removeBackground && mask) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(mask, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalCompositeOperation = 'destination-out'
    for (const s of strokes) {
      for (const p of s.points) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    // crop to the opaque bounding box (plus padding) so the texture stays small
    const img = ctx.getImageData(0, 0, full.width, full.height).data
    let minX = full.width
    let minY = full.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < full.height; y++) {
      for (let x = 0; x < full.width; x++) {
        if (img[(y * full.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) {
      minX = 0
      minY = 0
      maxX = full.width - 1
      maxY = full.height - 1
    }
    const pad = Math.round(Math.max(full.width, full.height) * 0.02)
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(full.width - 1, maxX + pad)
    maxY = Math.min(full.height - 1, maxY + pad)
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const crop = document.createElement('canvas')
    crop.width = w
    crop.height = h
    crop.getContext('2d')!.drawImage(full, minX, minY, w, h, 0, 0, w, h)
    const shifted: Record<string, Pt> = {}
    for (const id of ALL_JOINTS) {
      shifted[id] = { x: joints[id].x - minX, y: joints[id].y - minY }
    }
    return { url: crop.toDataURL('image/png'), width: w, height: h, joints: shifted }
  }

  const autoDetect = async () => {
    if (!photo) return
    setError(null)
    setDetecting(true)
    try {
      const detected = await detectPose(photo)
      if (!detected) {
        setError('No person detected in the photo. Try a clearer full-body shot, or drag the joint points manually.')
        return
      }
      setJoints(detected.joints)
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
    const body = buildBody()
    if (!body) return
    setPreviewManifest({
      id: `editor-preview-${Date.now()}`,
      ownerId: userId ?? 'me',
      name: name || 'My Fighter',
      parts: [],
      body,
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
      if (!supabaseConfigured || !userId) {
        // local mode: store the whole-person skinned body in the browser
        const body = buildBody()
        if (!body) throw new Error('Nothing to save yet')
        saveLocalFighter({
          id: `local-${Date.now()}`,
          ownerId: 'local',
          name: name.trim(),
          parts: [],
          body,
          scale: 1,
        })
        playSfx('ready')
        navigate('/local-test')
        return
      }
      const built = buildParts()
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
              Drag the yellow joint points onto the body: head center, shoulders, elbows, hands, hips, knees and feet. The part shapes follow the skeleton automatically. Use the Eraser to paint away unwanted pixels (applies to the current part).
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
              {mode === 'erase' ? (
                <>
                  <div className="mb-2 text-sm font-bold text-arcade-cyan">Erase on part</div>
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
                </>
              ) : (
                <div className="text-xs text-gray-400">
                  Joints: head center, L/R shoulder, elbow, hand, hip, knee, foot. Click near a point to grab and drag it.
                </div>
              )}
            </div>

            <div className="panel">
              <div className="mb-2 text-sm font-bold text-arcade-cyan">Tools</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['joints', 'Joints'],
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
                  setJoints(null)
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
