import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const DESTINATION_CONFIG = {
  'Karilun｜西宮市': {
    tableName: 'sns_nishinomiya_karilun_properties',
    allowedStores: ['JR西宮店'],
  },
  'Karilun｜京阪': {
    tableName: 'sns_keihan_karilun_properties',
    allowedStores: ['枚方店', '守口店', '寝屋川店'],
  },
} as const

type DestinationName = keyof typeof DESTINATION_CONFIG

type SheetImportBody = {
  storeName?: unknown
  propertyName?: unknown
  roomNumber?: unknown
  destinationName?: unknown
}

type StoreSnsPropertyRow = {
  id: string
  property_name: string | null
  room_number: string | null
  property_number: string | null
  created_at: string | null
}

function json(res: VercelResponse, status: number, body: Record<string, unknown>) {
  return res.status(status).json(body)
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isDestinationName(value: string): value is DestinationName {
  return value in DESTINATION_CONFIG
}

function parseBody(body: unknown): SheetImportBody {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as SheetImportBody
    } catch {
      return {}
    }
  }

  if (body && typeof body === 'object') {
    return body as SheetImportBody
  }

  return {}
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabaseの接続設定がありません')
  }

  return createClient(url, key)
}

function isEmptyCell(value: string | null | undefined) {
  return !String(value ?? '').trim()
}

function findFirstEmptyRow(rows: StoreSnsPropertyRow[]) {
  return rows.find((row) => isEmptyCell(row.property_name) && isEmptyCell(row.room_number))
}

async function fetchRows(tableName: string) {
  const supabase = getSupabaseClient()
  const rows: StoreSnsPropertyRow[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select('id, property_name, room_number, property_number, created_at')
      .order('property_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as StoreSnsPropertyRow[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

async function upsertProperty(tableName: string, propertyName: string, roomNumber: string) {
  const supabase = getSupabaseClient()
  const emptyRow = findFirstEmptyRow(await fetchRows(tableName))

  if (emptyRow) {
    const { data, error } = await supabase
      .from(tableName)
      .update({
        property_name: propertyName,
        room_number: roomNumber,
      })
      .eq('id', emptyRow.id)
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(error?.message || '空欄行の更新に失敗しました')
    }

    return { action: 'updated', id: data.id as string }
  }

  const { data, error } = await supabase
    .from(tableName)
    .insert([{
      property_name: propertyName,
      room_number: roomNumber,
    }])
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message || '新しい行の追加に失敗しました')
  }

  return { action: 'inserted', id: data.id as string }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, message: 'POSTで送信してください' })
  }

  const expectedApiKey = process.env.SHEET_IMPORT_API_KEY
  const requestApiKey = getHeaderValue(req.headers['x-api-key'])

  if (!expectedApiKey || requestApiKey !== expectedApiKey) {
    return json(res, 401, { success: false, message: 'APIキーが不正です' })
  }

  const body = parseBody(req.body)
  const storeName = text(body.storeName)
  const propertyName = text(body.propertyName)
  const roomNumber = text(body.roomNumber)
  const destinationName = text(body.destinationName)

  if (!storeName || !propertyName || !roomNumber || !destinationName) {
    return json(res, 400, { success: false, message: '必須項目が不足しています' })
  }

  if (!isDestinationName(destinationName)) {
    return json(res, 400, { success: false, message: '反映先が不正です' })
  }

  const config = DESTINATION_CONFIG[destinationName]
  if (!config.allowedStores.some((allowedStore) => allowedStore === storeName)) {
    return json(res, 400, { success: false, message: '店舗名と反映先が一致していません' })
  }

  try {
    const result = await upsertProperty(config.tableName, propertyName, roomNumber)

    return json(res, 200, {
      success: true,
      message: '管理ツールへ反映しました',
      destinationName,
      propertyName,
      roomNumber,
      action: result.action,
      id: result.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Supabase登録に失敗しました'
    return json(res, 500, { success: false, message })
  }
}
