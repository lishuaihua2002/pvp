import { supabase } from './client'
import type { FighterManifest, FighterPart, PartType } from '../../types/fighter'
import { getPresetById } from '../presets'

interface FighterRow {
  id: string
  owner_id: string
  name: string
  description: string | null
  thumbnail_path: string | null
  rig_manifest: { scale: number } | null
}

interface PartRow {
  part_type: PartType
  storage_path: string
  width: number
  height: number
  pivot_x: number
  pivot_y: number
  sort_order: number
}

export async function listMyFighters(userId: string): Promise<FighterManifest[]> {
  const { data, error } = await supabase
    .from('fighters')
    .select('id, owner_id, name, description, thumbnail_path, rig_manifest, fighter_parts(part_type, storage_path, width, height, pivot_x, pivot_y, sort_order)')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const manifests: FighterManifest[] = []
  for (const row of (data ?? []) as (FighterRow & { fighter_parts: PartRow[] })[]) {
    manifests.push(await rowToManifest(row, row.fighter_parts))
  }
  return manifests
}

async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('fighter-parts').createSignedUrl(path, 60 * 30)
  if (error || !data) throw new Error('生成资源链接失败')
  return data.signedUrl
}

async function rowToManifest(row: FighterRow, parts: PartRow[]): Promise<FighterManifest> {
  const fighterParts: FighterPart[] = await Promise.all(
    parts.map(async (p) => ({
      partType: p.part_type,
      url: await signedUrl(p.storage_path),
      width: p.width,
      height: p.height,
      pivotX: p.pivot_x,
      pivotY: p.pivot_y,
      sortOrder: p.sort_order,
    })),
  )
  let thumbnailUrl: string | undefined
  if (row.thumbnail_path) {
    try {
      thumbnailUrl = await signedUrl(row.thumbnail_path)
    } catch {
      thumbnailUrl = undefined
    }
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description ?? undefined,
    thumbnailUrl,
    parts: fighterParts,
    scale: row.rig_manifest?.scale ?? 1,
  }
}

/** Load a fighter (preset or user-created) by ID for use in a match. */
export async function loadFighterById(fighterId: string): Promise<FighterManifest> {
  const preset = getPresetById(fighterId)
  if (preset) return preset
  const { data, error } = await supabase
    .from('fighters')
    .select('id, owner_id, name, description, thumbnail_path, rig_manifest, fighter_parts(part_type, storage_path, width, height, pivot_x, pivot_y, sort_order)')
    .eq('id', fighterId)
    .maybeSingle()
  if (error || !data) throw new Error('加载角色失败')
  const row = data as FighterRow & { fighter_parts: PartRow[] }
  return rowToManifest(row, row.fighter_parts)
}

export interface SaveFighterInput {
  name: string
  description: string
  parts: { partType: PartType; blob: Blob; width: number; height: number; pivotX: number; pivotY: number }[]
  thumbnail: Blob
  original: Blob
  scale: number
}

export async function saveFighter(userId: string, input: SaveFighterInput): Promise<string> {
  const { data: fighter, error } = await supabase
    .from('fighters')
    .insert({
      owner_id: userId,
      name: input.name,
      description: input.description || null,
      rig_manifest: { scale: input.scale },
      is_ready: false,
    })
    .select('id')
    .single()
  if (error || !fighter) throw new Error(`保存角色失败: ${error?.message ?? ''}`)
  const fighterId = fighter.id as string

  const upload = async (bucket: string, path: string, blob: Blob) => {
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: 'image/webp',
      upsert: true,
    })
    if (upErr) throw new Error(`上传失败: ${upErr.message}`)
  }

  await upload('fighter-originals', `${userId}/${fighterId}/original.webp`, input.original)
  const thumbPath = `${userId}/${fighterId}/thumbnail.webp`
  await upload('fighter-parts', thumbPath, input.thumbnail)

  const partRows = []
  for (const part of input.parts) {
    const path = `${userId}/${fighterId}/${part.partType}.webp`
    await upload('fighter-parts', path, part.blob)
    partRows.push({
      fighter_id: fighterId,
      part_type: part.partType,
      storage_path: path,
      width: part.width,
      height: part.height,
      pivot_x: part.pivotX,
      pivot_y: part.pivotY,
      sort_order: partRows.length,
    })
  }
  const { error: partsErr } = await supabase.from('fighter_parts').insert(partRows)
  if (partsErr) throw new Error(`保存部件失败: ${partsErr.message}`)

  await supabase
    .from('fighters')
    .update({ is_ready: true, thumbnail_path: thumbPath, original_image_path: `${userId}/${fighterId}/original.webp` })
    .eq('id', fighterId)
  return fighterId
}

export async function deleteFighter(fighterId: string, userId: string): Promise<void> {
  const { data: parts } = await supabase
    .from('fighter_parts')
    .select('storage_path')
    .eq('fighter_id', fighterId)
  const paths = (parts ?? []).map((p) => p.storage_path as string)
  if (paths.length) await supabase.storage.from('fighter-parts').remove(paths)
  await supabase.storage.from('fighter-parts').remove([`${userId}/${fighterId}/thumbnail.webp`])
  await supabase.storage.from('fighter-originals').remove([`${userId}/${fighterId}/original.webp`])
  await supabase.from('fighters').delete().eq('id', fighterId)
}

export async function getSelectedFighterId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_settings')
    .select('selected_fighter_id')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.selected_fighter_id as string | null) ?? null
}

export async function setSelectedFighterId(userId: string, fighterId: string): Promise<void> {
  await supabase
    .from('player_settings')
    .upsert({ user_id: userId, selected_fighter_id: fighterId }, { onConflict: 'user_id' })
}
