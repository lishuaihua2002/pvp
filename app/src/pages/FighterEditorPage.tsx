import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { saveFighter } from '../lib/supabase/fighters'
import { ALL_PART_TYPES, type PartType, type FighterManifest, type FighterPart } from '../types/fighter'
import PhaserArena from '../components/PhaserArena'
import { initAudio, playSfx } from '../game/audio/sfx'

const PART_LABELS: Record<PartType, string> = {
  head: '头',
  torso: '躯干',
  'left-upper-arm': '左上臂',
  'left-lower-arm': '左前臂',
  'right-upper-arm': '右上臂',
  'right-lower-arm': '右前臂',
  'left-upper-leg': '左大腿',
  'left-lower-leg': '左小腿',
  'right-upper-leg': '右大腿',
  'right-lower-leg': '右小腿',
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
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
      i.onerror = () => reject(new Error('图片解析失败'))
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片导出失败'))), 'image/webp', quality)
  })
}

export default function FighterEditorPage() {
  const navigate = useNavigate()
  const { session, profile } = useAuthStore()
  const userId = session?.user.id
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [rects, setRects] = useState<Record<PartType, Rect> | null>(null)
  const [selectedPart, setSelectedPart] = useState<PartType>('head')
  const [mode, setMode] = useState<'move' | 'resize' | 'erase'>('move')
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
      setError('只支持 JPG / PNG / WEBP 格式')
      return
    }
    if (file.size > MAX_FILE) {
      setError('图片不能超过10MB')
      return
    }
    try {
      const canvas = await fileToCanvas(file)
      setPhoto(canvas)
      setRects(defaultRects(canvas.width, canvas.height))
      setStrokes([])
      setUndoStack([])
      setRedoStack([])
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
      ctx.strokeStyle = active ? '#ff3d6e' : 'rgba(15,245,224,0.45)'
      ctx.lineWidth = active ? 3 : 1.5
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      if (active) {
        ctx.fillStyle = '#ff3d6e'
        ctx.font = 'bold 16px sans-serif'
        ctx.fillText(PART_LABELS[pt], r.x + 4, r.y + 18)
        ctx.fillRect(r.x + r.w - 8, r.y + r.h - 8, 8, 8)
      }
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
    // click inside another part selects it
    const hit = [...ALL_PART_TYPES]
      .reverse()
      .find((pt) => x >= rects[pt].x && x <= rects[pt].x + rects[pt].w && y >= rects[pt].y && y <= rects[pt].y + rects[pt].h)
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
      ctx.drawImage(photo, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
      ctx.globalCompositeOperation = 'destination-out'
      for (const s of strokes) {
        if (s.part !== pt) continue
        for (const p of s.points) {
          ctx.beginPath()
          ctx.arc(p.x - r.x, p.y - r.y, s.radius, 0, Math.PI * 2)
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

  const preview = () => {
    initAudio()
    playSfx('click')
    const parts = buildParts()
    if (!parts.length) return
    setPreviewManifest({
      id: 'editor-preview',
      ownerId: userId ?? 'me',
      name: name || '我的角色',
      parts: parts.map((p) => p.part),
      scale: 1,
    })
  }

  const save = async () => {
    setError(null)
    if (!userId || !photo) return
    if (!name.trim()) {
      setError('请给角色起个名字')
      return
    }
    setSaving(true)
    try {
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
          ← 返回编辑
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-arcade-cyan">📷 照片角色编辑器</h1>
        <Link className="btn-secondary" to="/">
          返回大厅
        </Link>
      </header>

      {profile?.is_anonymous && (
        <div className="rounded-lg bg-yellow-900/40 border border-yellow-600 p-3 text-sm text-yellow-200">
          游客创建的角色在退出后可能无法恢复，建议注册账号。
        </div>
      )}

      {error && <div className="rounded-lg bg-red-900/40 border border-red-600 p-3 text-sm text-red-200">{error}</div>}

      {!photo ? (
        <label className="panel flex h-64 cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed border-arcade-border hover:border-arcade-cyan">
          <div className="text-4xl">📤</div>
          <div className="font-bold">点击上传全身照片</div>
          <div className="text-xs text-gray-500">JPG / PNG / WEBP，最大10MB · 建议正面站立全身照 · 图片会在浏览器内压缩并去除EXIF信息</div>
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
              选中部位后拖动移动框；「调整大小」模式拖动改变宽高；「橡皮擦」在照片上涂抹去除背景（作用于当前部位）。
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="panel">
              <div className="mb-2 text-sm font-bold text-arcade-cyan">身体部位</div>
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
              <div className="mb-2 text-sm font-bold text-arcade-cyan">工具</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['move', '移动'],
                    ['resize', '调整大小'],
                    ['erase', '橡皮擦'],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={`${mode === m ? 'btn-primary' : 'btn-secondary'} text-xs`} onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
              {mode === 'erase' && (
                <div className="mt-2">
                  <label className="text-xs text-gray-400">笔刷大小: {brushRadius}px</label>
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
                  ↩ 撤销
                </button>
                <button className="btn-secondary text-xs" disabled={redoStack.length === 0} onClick={redo}>
                  ↪ 重做
                </button>
              </div>
            </div>

            <div className="panel flex flex-col gap-2">
              <input
                className="input"
                placeholder="角色名字"
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="btn-secondary" onClick={preview}>
                👀 动画预览
              </button>
              <button className="btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? '保存中...' : '💾 保存角色'}
              </button>
              <button
                className="btn-warn text-xs"
                onClick={() => {
                  setPhoto(null)
                  setRects(null)
                  setStrokes([])
                }}
              >
                重新上传照片
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
