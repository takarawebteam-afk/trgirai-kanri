import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const STORE_DESTINATION_CONFIG = {
  '八尾店': {
    destinationName: '八尾店',
    tableName: 'sns_yao_properties',
  },
  'JR西宮店': {
    destinationName: '西宮市',
    tableName: 'sns_nishinomiya_karilun_properties',
  },
  '長瀬店': {
    destinationName: '長瀬店',
    tableName: 'sns_nagase_properties',
  },
  '西北店': {
    destinationName: '西北店',
    tableName: 'sns_nishikita_properties',
  },
  '枚方店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
  },
  '守口店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
  },
  '寝屋川店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
  },
} as const

const SHEET_IMAGE_IMPORT_TOKENS: Record<string, string> = {
  '1WgzGsmywL16bRAX3J_MI6qbskuLfelRu3IEYGvLTrwQ': 'c02ce374-c3d2-40da-88bf-6c0483d139f3',
  '1jx3OJi-4vlrUWE4ubr-zlZkrqdeEm2v-Vq3sPkwZ5TQ': '809ca5f8-83f3-4b9c-ad4b-7049c75f7df7',
}

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

type StoreName = keyof typeof STORE_DESTINATION_CONFIG
type StoreSnsPropertyTableName = typeof STORE_DESTINATION_CONFIG[StoreName]['tableName']

type SheetImportBody = {
  storeName?: unknown
  propertyName?: unknown
  roomNumber?: unknown
  destinationName?: unknown
  spreadsheetId?: unknown
  sheetName?: unknown
  rowNumber?: unknown
}

type ExistingPropertyRow = {
  id: string
  property_number: string | null
}

function json(res: VercelResponse, status: number, body: Record<string, unknown>) {
  return res.status(status).json(body)
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getParamValue(value: unknown) {
  if (Array.isArray(value)) return text(value[0])
  return text(value)
}

function getQueryParam(req: VercelRequest, name: string) {
  const rawValue = getParamValue(req.query[name])
  if (rawValue) return rawValue

  const host = getHeaderValue(req.headers.host) || 'localhost'
  const url = new URL(req.url || '/', `https://${host}`)
  return text(url.searchParams.get(name))
}

function wantsJsonResponse(req: VercelRequest) {
  return getQueryParam(req, 'format') === 'json'
}

function wantsCsvResponse(req: VercelRequest) {
  return getQueryParam(req, 'format') === 'csv'
}

function sendPixel(res: VercelResponse) {
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(200).send(TRANSPARENT_GIF)
}

function sendCsv(res: VercelResponse, value: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(200).send(value)
}

function normalizeStoreName(value: string) {
  return value.replace(/\s+/g, '').trim()
}

function isStoreName(value: string): value is StoreName {
  return value in STORE_DESTINATION_CONFIG
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

async function getNextPropertyNumber(tableName: StoreSnsPropertyTableName) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(tableName)
    .select('property_number')

  if (error) throw new Error(error.message)

  const maxValue = ((data || []) as Pick<ExistingPropertyRow, 'property_number'>[]).reduce((max, row) => {
    const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)

  return String(maxValue + 1)
}

async function addProperty(
  tableName: StoreSnsPropertyTableName,
  propertyName: string,
  roomNumber: string,
) {
  const propertyNumber = await getNextPropertyNumber(tableName)
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(tableName)
    .insert([{
      property_name: propertyName,
      room_number: roomNumber,
      property_number: propertyNumber,
    }])
    .select('id, property_number')
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'SNS物件管理への追加に失敗しました')
  }

  return {
    action: 'inserted',
    id: data.id as string,
    propertyNumber: String(data.property_number || propertyNumber),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const jsonMode = wantsJsonResponse(req)
    const csvMode = wantsCsvResponse(req)
    const spreadsheetId = getQueryParam(req, 'spreadsheetId')
    const token = getQueryParam(req, 'token')

    if (!spreadsheetId || SHEET_IMAGE_IMPORT_TOKENS[spreadsheetId] !== token) {
      if (jsonMode) return json(res, 401, { success: false, message: '送信用トークンが正しくありません' })
      return json(res, 401, { success: false, message: '送信用トークンが正しくありません' })
    }

    const storeName = normalizeStoreName(getQueryParam(req, 'storeName'))
    const propertyName = getQueryParam(req, 'propertyName')
    const roomNumber = getQueryParam(req, 'roomNumber')

    if (!storeName || !propertyName || !roomNumber || !isStoreName(storeName)) {
      if (csvMode) return sendCsv(res, 'SKIP')
      if (jsonMode) {
        return json(res, 400, {
          success: false,
          message: '店舗名、物件名、号室、または店舗名の反映先が正しくありません',
          storeName,
          propertyName,
          roomNumber,
        })
      }
      return sendPixel(res)
    }

    try {
      const config = STORE_DESTINATION_CONFIG[storeName]
      const result = await addProperty(config.tableName, propertyName, roomNumber)
      if (csvMode) return sendCsv(res, `OK,${result.propertyNumber}`)
      if (jsonMode) {
        return json(res, 200, {
          success: true,
          storeName,
          destinationName: config.destinationName,
          propertyName,
          roomNumber,
          action: result.action,
          propertyNumber: result.propertyNumber,
          id: result.id,
        })
      }
    } catch (error) {
      console.error('Sheet image import failed.', error)
      if (jsonMode) {
        const message = error instanceof Error ? error.message : 'SNS物件管理への反映に失敗しました'
        return json(res, 500, { success: false, message, storeName, propertyName, roomNumber })
      }
    }

    return sendPixel(res)
  }

  if (req.method !== 'POST') {
    return json(res, 405, { success: false, message: 'POSTで送信してください' })
  }

  const expectedApiKey = process.env.SHEET_IMPORT_API_KEY
  const requestApiKey = getHeaderValue(req.headers['x-api-key'])

  if (!expectedApiKey || requestApiKey !== expectedApiKey) {
    return json(res, 401, { success: false, message: 'APIキーが正しくありません' })
  }

  const body = parseBody(req.body)
  const storeName = normalizeStoreName(text(body.storeName))
  const propertyName = text(body.propertyName)
  const roomNumber = text(body.roomNumber)
  const requestedDestinationName = text(body.destinationName)

  if (!storeName || !propertyName || !roomNumber) {
    return json(res, 400, {
      success: false,
      message: '店舗名、物件名、号室が必要です',
    })
  }

  if (!isStoreName(storeName)) {
    return json(res, 400, {
      success: false,
      message: `この店舗名は反映先が決まっていません: ${storeName}`,
    })
  }

  const config = STORE_DESTINATION_CONFIG[storeName]
  if (requestedDestinationName && requestedDestinationName !== config.destinationName) {
    return json(res, 400, {
      success: false,
      message: `店舗名と反映先が一致していません。${storeName} は ${config.destinationName} へ反映します`,
    })
  }

  try {
    const result = await addProperty(config.tableName, propertyName, roomNumber)

    return json(res, 200, {
      success: true,
      message: result.action === 'already_exists'
        ? '同じ物件名と号室がすでにあるため、追加はしませんでした'
        : 'SNS物件管理へ反映しました',
      storeName,
      destinationName: config.destinationName,
      propertyName,
      roomNumber,
      propertyNumber: result.propertyNumber,
      action: result.action,
      id: result.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SNS物件管理への反映に失敗しました'
    return json(res, 500, { success: false, message })
  }
}
