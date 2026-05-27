import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1Ddk6QM4-S4MPcc4kEcfkWVM-iWcKHhrQUExltO1IPZ8'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

type SnsPlatform = 'tiktok' | 'instagram' | 'youtube'

type SnsPropertyRecord = {
  created_at?: string
  post_date: string | null
  property_number: string | null
  area?: string | null
  document_url: string | null
  property_name: string | null
  room_number: string | null
  acquisition_source: string | null
  management_company: string | null
  contact: string | null
}

const PLATFORM_CONFIG: Record<SnsPlatform, { tableName: string; sheetName: string; includesArea: boolean }> = {
  tiktok: {
    tableName: 'sns_tiktok_properties',
    sheetName: 'TikTok(K000)',
    includesArea: true,
  },
  instagram: {
    tableName: 'sns_instagram_properties',
    sheetName: 'INSTA(G000)',
    includesArea: true,
  },
  youtube: {
    tableName: 'sns_youtube_properties',
    sheetName: 'YouTube(R/Y000)',
    includesArea: false,
  },
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

function toSheetRow(record: SnsPropertyRecord, includesArea: boolean) {
  return [
    text(record.post_date),
    includesArea ? text(record.area) : '',
    text(record.property_name),
    text(record.room_number),
    text(record.property_number),
    text(record.document_url),
    text(record.management_company),
    text(record.contact),
    text(record.acquisition_source),
  ]
}

async function fetchAllProperties(platform: SnsPlatform) {
  const config = PLATFORM_CONFIG[platform]
  const supabase = getSupabaseClient()
  const rows: SnsPropertyRecord[] = []
  const pageSize = 1000
  const columns = config.includesArea
    ? 'created_at, post_date, property_number, area, document_url, property_name, room_number, acquisition_source, management_company, contact'
    : 'created_at, post_date, property_number, document_url, property_name, room_number, acquisition_source, management_company, contact'

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(config.tableName)
      .select(columns)
      .order('property_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as SnsPropertyRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

function buildSheetRange(sheetName: string) {
  const escapedSheetName = sheetName.replace(/'/g, "''")
  return encodeURIComponent(`'${escapedSheetName}'!A3:I`)
}

async function resolveSheetName(accessToken: string, platform: SnsPlatform) {
  const targetSheetName = PLATFORM_CONFIG[platform].sheetName
  if (platform !== 'youtube') return targetSheetName

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  if (!response.ok) throw new Error(`Sheet list fetch failed. ${await response.text()}`)

  const data = await response.json() as { sheets?: Array<{ properties?: { title?: string } }> }
  const sheetNames = (data.sheets || [])
    .map((sheet) => sheet.properties?.title || '')
    .filter(Boolean)

  return sheetNames.find((name) => name === targetSheetName)
    || sheetNames.find((name) => name.trim() === targetSheetName)
    || sheetNames.find((name) => name.includes('YouTube'))
    || targetSheetName
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

function getPlatform(req: VercelRequest): SnsPlatform | null {
  const value = Array.isArray(req.query.platform) ? req.query.platform[0] : req.query.platform
  if (value === 'tiktok' || value === 'instagram' || value === 'youtube') return value
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POST only.' })
  }

  const platform = getPlatform(req)
  if (!platform) {
    return res.status(400).json({ ok: false, message: 'platform is required.' })
  }

  try {
    const config = PLATFORM_CONFIG[platform]
    const records = await fetchAllProperties(platform)
    const values = records.map((record) => toSheetRow(record, config.includesArea))
    const accessToken = await getGoogleAccessToken()
    const sheetName = await resolveSheetName(accessToken, platform)

    await clearSheet(accessToken, sheetName)
    await updateSheet(accessToken, sheetName, values)

    return res.status(200).json({ ok: true, count: values.length, sheetName })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
