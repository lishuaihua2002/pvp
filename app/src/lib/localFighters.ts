import type { FighterManifest } from '../types/fighter'

/** Fighters created in the editor and stored in the browser (no Supabase needed). */

const KEY = 'pvp.localFighters'

export function getLocalFighters(): FighterManifest[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as FighterManifest[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveLocalFighter(manifest: FighterManifest): void {
  const list = getLocalFighters().filter((f) => f.id !== manifest.id)
  list.push(manifest)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    throw new Error('Browser storage is full. Delete some local fighters and try again.')
  }
}

export function deleteLocalFighter(id: string): void {
  const list = getLocalFighters().filter((f) => f.id !== id)
  localStorage.setItem(KEY, JSON.stringify(list))
}
