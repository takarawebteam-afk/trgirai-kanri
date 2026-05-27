import { supabase } from './supabase'

export type ChangeHistoryAction = 'update' | 'delete' | 'restore'

export type ChangeHistoryEntry = {
  id: string
  feature: 'snsproperty' | 'progress'
  table_name: string
  record_id: string
  action: ChangeHistoryAction
  changed_field: string | null
  old_value: string | null
  new_value: string | null
  snapshot: Record<string, unknown>
  created_at: string
}

type SaveUndoSnapshotInput = {
  feature: ChangeHistoryEntry['feature']
  tableName: string
  recordId: string
  action: Exclude<ChangeHistoryAction, 'restore'>
  changedField?: string
  oldValue?: unknown
  newValue?: unknown
}

function toHistoryText(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function isMissingHistoryTableError(error: unknown) {
  const maybe = error as { code?: string; message?: string } | null
  return maybe?.code === '42P01' || String(maybe?.message || '').includes('change_history')
}

export async function saveUndoSnapshot(input: SaveUndoSnapshotInput) {
  const { data, error: fetchError } = await supabase
    .from(input.tableName)
    .select('*')
    .eq('id', input.recordId)
    .maybeSingle()

  if (fetchError || !data) {
    console.warn('変更履歴用の控えを取得できませんでした', fetchError)
    return false
  }

  const snapshot = data as Record<string, unknown>
  const { error } = await supabase.from('change_history').insert({
    feature: input.feature,
    table_name: input.tableName,
    record_id: input.recordId,
    action: input.action,
    changed_field: input.changedField || null,
    old_value: input.oldValue === undefined ? null : toHistoryText(input.oldValue),
    new_value: input.newValue === undefined ? null : toHistoryText(input.newValue),
    snapshot,
  })

  if (error) {
    if (!isMissingHistoryTableError(error)) {
      console.warn('変更履歴を保存できませんでした', error)
    }
    return false
  }

  return true
}

export async function fetchChangeHistory(
  feature: ChangeHistoryEntry['feature'],
  tableNames: string[],
  limit = 30,
) {
  let query = supabase
    .from('change_history')
    .select('*')
    .eq('feature', feature)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (tableNames.length > 0) {
    query = query.in('table_name', tableNames)
  }

  const { data, error } = await query
  if (error) {
    if (isMissingHistoryTableError(error)) return []
    throw error
  }

  return (data || []) as ChangeHistoryEntry[]
}

export async function restoreChangeHistory(entry: ChangeHistoryEntry) {
  const snapshot = { ...entry.snapshot, id: entry.record_id }
  const { error } = await supabase
    .from(entry.table_name)
    .upsert(snapshot, { onConflict: 'id' })

  if (error) throw error

  await supabase.from('change_history').insert({
    feature: entry.feature,
    table_name: entry.table_name,
    record_id: entry.record_id,
    action: 'restore',
    changed_field: entry.changed_field,
    old_value: entry.new_value,
    new_value: entry.old_value,
    snapshot,
  })
}

export function formatHistoryDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getHistoryTitle(entry: ChangeHistoryEntry) {
  const snapshot = entry.snapshot || {}
  return String(
    snapshot.property_name
      || snapshot.title
      || snapshot.property_number
      || snapshot.media
      || entry.record_id,
  )
}
