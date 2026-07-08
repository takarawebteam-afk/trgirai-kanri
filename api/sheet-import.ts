import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const STORE_DESTINATION_CONFIG = {
  '八尾店': {
    destinationName: '八尾店',
    tableName: 'sns_yao_properties',
    accountKey: 'yao',
  },
  'JR西宮店': {
    destinationName: '西宮市',
    tableName: 'sns_nishinomiya_karilun_properties',
    accountKey: 'nishinomiya',
  },
  '長瀬店': {
    destinationName: '長瀬店',
    tableName: 'sns_nagase_properties',
    accountKey: 'nagase',
  },
  '西北店': {
    destinationName: '西北店',
    tableName: 'sns_nishikita_properties',
    accountKey: 'nishikita',
  },
  '西宮北店': {
    destinationName: '西北店',
    tableName: 'sns_nishikita_properties',
    accountKey: 'nishikita',
  },
  '枚方店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
    accountKey: 'keihan',
  },
  '守口店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
    accountKey: 'keihan',
  },
  '寝屋川店': {
    destinationName: '京阪',
    tableName: 'sns_keihan_karilun_properties',
    accountKey: 'keihan',
  },
} as const

const SHEET_IMAGE_IMPORT_TOKENS: Record<string, string> = {
  '1WgzGsmywL16bRAX3J_MI6qbskuLfelRu3IEYGvLTrwQ': 'c02ce374-c3d2-40da-88bf-6c0483d139f3',
  '1jx3OJi-4vlrUWE4ubr-zlZkrqdeEm2v-Vq3sPkwZ5TQ': '809ca5f8-83f3-4b9c-ad4b-7049c75f7df7',
}

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

type StoreName = keyof typeof STORE_DESTINATION_CONFIG
type StoreSnsPropertyTableName = typeof STORE_DESTINATION_CONFIG[StoreName]['tableName']

const DESTINATION_NAME_ALIASES: Record<string, string> = {
  'Karilun｜京阪': '京阪',
  'Karilun｜西宮市': '西宮市',
}

type SheetImportBody = {
  storeName?: unknown
  propertyName?: unknown
  roomNumber?: unknown
  destinationName?: unknown
  sourceMonth?: unknown
  spreadsheetId?: unknown
  sheetName?: unknown
  rowNumber?: unknown
}

type ExistingPropertyRow = {
  id: string
  property_number: string | null
  source_month?: string | null
  post_date?: string | null
}

type SnsPostingRule = {
  account_platform_key: string
  rule_type: 'weekday' | 'interval'
  day_of_week: number | null
  interval_days: number | null
  reference_date: string | null
}

type ExistingPostDateRow = {
  post_date: string | null
}

const STORE_RULE_PLATFORM_ORDER = ['tiktok', 'instagram', 'youtube'] as const

type SupabaseMaybeError = {
  code?: string
  message?: string
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

function normalizeSourceMonth(value: string) {
  const trimmed = text(value)
  const match = trimmed.match(/^(\d{4})[-/](\d{1,2})/)
  if (!match) return ''

  const year = match[1]
  const month = match[2].padStart(2, '0')
  return `${year}-${month}`
}

function parseLocalDate(value: unknown) {
  const normalized = text(value)
    .replace(/年/g, '/')
    .replace(/月/g, '/')
    .replace(/日/g, '')
    .replace(/\./g, '/')
    .replace(/-/g, '/')

  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function formatLocalDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function diffDays(from: Date, to: Date) {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / (1000 * 60 * 60 * 24))
}

function getNextDateByRule(rule: SnsPostingRule, afterDate: Date) {
  const startDate = addDays(afterDate, 1)

  if (rule.rule_type === 'interval') {
    if (!rule.reference_date || !rule.interval_days || rule.interval_days < 1) return null

    const referenceDate = parseLocalDate(rule.reference_date)
    if (!referenceDate) return null
    if (startDate <= referenceDate) return referenceDate

    const passedDays = diffDays(referenceDate, startDate)
    const remainder = passedDays % rule.interval_days
    return remainder === 0 ? startDate : addDays(startDate, rule.interval_days - remainder)
  }

  if (rule.day_of_week === null || rule.day_of_week < 0 || rule.day_of_week > 6) return null

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(startDate, offset)
    if (candidate.getDay() === rule.day_of_week) return candidate
  }

  return null
}

async function getLatestPostDate(tableName: StoreSnsPropertyTableName) {
  const supabase = getSupabaseClient()
  const rows: ExistingPostDateRow[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select('post_date')
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as ExistingPostDateRow[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows.reduce<Date | null>((latest, row) => {
    const date = parseLocalDate(row.post_date)
    if (!date) return latest
    if (!latest || date > latest) return date
    return latest
  }, null)
}

async function getNextPostDate(tableName: StoreSnsPropertyTableName, accountKey: string) {
  const supabase = getSupabaseClient()
  const latestPostDate = await getLatestPostDate(tableName)
  const afterDate = latestPostDate || addDays(new Date(), -1)
  const accountPlatformKeys = STORE_RULE_PLATFORM_ORDER.map((platform) => `${accountKey}-${platform}`)

  const { data, error } = await supabase
    .from('sns_posting_rules')
    .select('account_platform_key, rule_type, day_of_week, interval_days, reference_date')
    .in('account_platform_key', accountPlatformKeys)

  if (error) throw new Error(error.message)

  const rules = (data || []) as SnsPostingRule[]
  for (const accountPlatformKey of accountPlatformKeys) {
    const candidates = rules
      .filter((rule) => rule.account_platform_key === accountPlatformKey)
      .map((rule) => getNextDateByRule(rule, afterDate))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime())

    if (candidates[0]) {
      return {
        postDate: formatLocalDateKey(candidates[0]),
        ruleKey: accountPlatformKey,
      }
    }
  }

  return { postDate: '', ruleKey: '' }
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

function normalizeDestinationName(value: string) {
  const destinationName = text(value)
  return DESTINATION_NAME_ALIASES[destinationName] || destinationName
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
  accountKey: string,
  propertyName: string,
  roomNumber: string,
  sourceMonth: string,
) {
  const supabase = getSupabaseClient()

  if (sourceMonth) {
    const { data: existingRows, error: existingError } = await supabase
      .from(tableName)
      .select('id, property_number, source_month, post_date')
      .eq('source_month', sourceMonth)
      .eq('property_name', propertyName)
      .eq('room_number', roomNumber)
      .limit(1)

    if (existingError) throw new Error(existingError.message)

    const existing = (existingRows || [])[0] as ExistingPropertyRow | undefined
    if (existing) {
      return {
        action: 'already_exists',
        id: existing.id,
        propertyNumber: String(existing.property_number || ''),
        postDate: String(existing.post_date || ''),
        ruleKey: '',
      }
    }

    const { data: legacyRows, error: legacyError } = await supabase
      .from(tableName)
      .select('id, property_number, source_month, post_date')
      .is('source_month', null)
      .eq('property_name', propertyName)
      .eq('room_number', roomNumber)
      .limit(1)

    if (legacyError) throw new Error(legacyError.message)

    const legacy = (legacyRows || [])[0] as ExistingPropertyRow | undefined
    if (legacy) {
      const { error: updateLegacyError } = await supabase
        .from(tableName)
        .update({ source_month: sourceMonth })
        .eq('id', legacy.id)

      if (updateLegacyError) throw new Error(updateLegacyError.message)

      return {
        action: 'already_exists',
        id: legacy.id,
        propertyNumber: String(legacy.property_number || ''),
        postDate: String(legacy.post_date || ''),
        ruleKey: '',
      }
    }
  }

  const propertyNumber = await getNextPropertyNumber(tableName)
  const nextPostDate = await getNextPostDate(tableName, accountKey)
  const { data, error } = await supabase
    .from(tableName)
    .insert([{
      property_name: propertyName,
      room_number: roomNumber,
      property_number: propertyNumber,
      post_date: nextPostDate.postDate || null,
      source_month: sourceMonth || null,
    }])
    .select('id, property_number')
    .single()

  if (error && sourceMonth && (error as SupabaseMaybeError).code === '23505') {
    const { data: existingRows, error: existingError } = await supabase
      .from(tableName)
      .select('id, property_number, source_month, post_date')
      .eq('source_month', sourceMonth)
      .eq('property_name', propertyName)
      .eq('room_number', roomNumber)
      .limit(1)

    if (existingError) throw new Error(existingError.message)

    const existing = (existingRows || [])[0] as ExistingPropertyRow | undefined
    if (existing) {
      return {
        action: 'already_exists',
        id: existing.id,
        propertyNumber: String(existing.property_number || ''),
        postDate: String(existing.post_date || ''),
        ruleKey: '',
      }
    }
  }

  if (error || !data) {
    throw new Error(error?.message || 'SNS物件管理への追加に失敗しました')
  }

  return {
    action: 'inserted',
    id: data.id as string,
    propertyNumber: String(data.property_number || propertyNumber),
    postDate: nextPostDate.postDate,
    ruleKey: nextPostDate.ruleKey,
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
    const sourceMonth = normalizeSourceMonth(getQueryParam(req, 'sourceMonth'))

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
      const result = await addProperty(config.tableName, config.accountKey, propertyName, roomNumber, sourceMonth)
      if (csvMode) return sendCsv(res, `OK,${result.propertyNumber}`)
      if (jsonMode) {
        return json(res, 200, {
          success: true,
          storeName,
          destinationName: config.destinationName,
          propertyName,
          roomNumber,
          sourceMonth,
          action: result.action,
          propertyNumber: result.propertyNumber,
          postDate: result.postDate,
          ruleKey: result.ruleKey,
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
  const requestedDestinationName = normalizeDestinationName(text(body.destinationName))
  const sourceMonth = normalizeSourceMonth(text(body.sourceMonth))

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
    const result = await addProperty(config.tableName, config.accountKey, propertyName, roomNumber, sourceMonth)

    return json(res, 200, {
      success: true,
      message: result.action === 'already_exists'
        ? '同じ物件名と号室がすでにあるため、追加はしませんでした'
        : 'SNS物件管理へ反映しました',
      storeName,
      destinationName: config.destinationName,
      propertyName,
      roomNumber,
      sourceMonth,
      propertyNumber: result.propertyNumber,
      postDate: result.postDate,
      ruleKey: result.ruleKey,
      action: result.action,
      id: result.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SNS物件管理への反映に失敗しました'
    return json(res, 500, { success: false, message })
  }
}
