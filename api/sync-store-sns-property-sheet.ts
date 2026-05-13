import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1Ddk6QM4-S4MPcc4kEcfkWVM-iWcKHhrQUExltO1IPZ8'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

const STORE_SYNC_CONFIG = {
  'keihan-karilun': {
    label: '京阪かりるん',
    tableName: 'sns_keihan_karilun_properties',
    sheetName: '京阪',
  },
  'nishinomiya-karilun': {
    label: '西宮かりるん',
    tableName: 'sns_nishinomiya_karilun_properties',
    sheetName: 'JR西宮',
  },
  nagase: {
    label: '長瀬店',
    tableName: 'sns_nagase_properties',
    sheetName: '長瀬',
  },
  nishikita: {
    label: '西北店',
    tableName: 'sns_nishikita_properties',
    sheetName: '西北',
  },
  yao: {
    label: '八尾店',
    tableName: 'sns_yao_properties',
    sheetName: '八尾',
  },
} as const

type StorePlatform = keyof typeof STORE_SYNC_CONFIG

type StoreSnsPropertyRecord = {
  created_at?: string
  post_date: string | null
  category: string | null
  property_name: string | null
  room_number: string | null
  property_number: string | null
  document_url: string | null
}

function isStorePlatform(value: unknown): value is StorePlatform {
  return typeof value === 'string' && value in STORE_SYNC_CONFIG
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n')
}

function getGoogleServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || ''
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''

  if (!email || !privateKey) return null
  return { email, privateKey: normalizePrivateKey(privateKey) }
}

function createServiceAccountJwt(email: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const unsignedToken = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${unsignedToken}.${signature}`
}

async function getGoogleAccessToken() {
  const account = getGoogleServiceAccount()
  if (!account) throw new Error('Google sheet write key is not set.')

  const assertion = createServiceAccountJwt(account.email, account.privateKey)
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const data = await response.json() as { access_token?: string; error_description?: string; error?: string }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Google auth failed.')
  }

  return data.access_token
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error('Supabase connection settings are not set.')
  return createClient(url, key)
}

function text(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function toSheetRow(record: StoreSnsPropertyRecord) {
  return [
    text(record.post_date),
    text(record.category),
    text(record.property_name),
    text(record.room_number),
    text(record.property_number),
    text(record.document_url),
  ]
}

async function fetchAllStoreProperties(tableName: string) {
  const supabase = getSupabaseClient()
  const rows: StoreSnsPropertyRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select('created_at, post_date, category, property_name, room_number, property_number, document_url')
      .order('property_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as StoreSnsPropertyRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

function buildSheetRange(sheetName: string) {
  const escapedSheetName = sheetName.replace(/'/g, "''")
  return encodeURIComponent(`'${escapedSheetName}'!A3:F`)
}

async function clearSheet(accessToken: string, sheetName: string) {
  const range = buildSheetRange(sheetName)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: '{}',
    },
  )

  if (!response.ok) throw new Error(`Sheet clear failed. ${await response.text()}`)
}

async function updateSheet(accessToken: string, sheetName: string, values: string[][]) {
  if (values.length === 0) return

  const range = buildSheetRange(sheetName)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  )

  if (!response.ok) throw new Error(`Sheet update failed. ${await response.text()}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POST only.' })
  }

  const platform = req.query.platform
  if (!isStorePlatform(platform)) {
    return res.status(400).json({ ok: false, message: 'Unknown store platform.' })
  }

  const config = STORE_SYNC_CONFIG[platform]

  try {
    const records = await fetchAllStoreProperties(config.tableName)
    const values = records.map(toSheetRow)
    const accessToken = await getGoogleAccessToken()

    await clearSheet(accessToken, config.sheetName)
    await updateSheet(accessToken, config.sheetName, values)

    return res.status(200).json({
      ok: true,
      count: values.length,
      label: config.label,
      sheetName: config.sheetName,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
