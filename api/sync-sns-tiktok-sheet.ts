import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1Ddk6QM4-S4MPcc4kEcfkWVM-iWcKHhrQUExltO1IPZ8'
const SHEET_NAME = 'TikTok(K000)'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

type TiktokPropertyRecord = {
  created_at?: string
  post_date: string | null
  property_number: string | null
  area: string | null
  document_url: string | null
  property_name: string | null
  room_number: string | null
  management_company: string | null
  contact: string | null
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
  if (!account) {
    throw new Error('Googleの書き込み用キーが未設定です。')
  }

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
    throw new Error(data.error_description || data.error || 'Googleの認証に失敗しました。')
  }

  return data.access_token
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabaseの接続情報が未設定です。')
  }

  return createClient(url, key)
}

function text(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function toSheetRow(record: TiktokPropertyRecord) {
  return [
    text(record.post_date),
    text(record.area),
    text(record.property_name),
    text(record.room_number),
    text(record.property_number),
    text(record.document_url),
    text(record.management_company),
    text(record.contact),
  ]
}

async function fetchAllTiktokProperties() {
  const supabase = getSupabaseClient()
  const rows: TiktokPropertyRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('sns_tiktok_properties')
      .select('created_at, post_date, property_number, area, document_url, property_name, room_number, management_company, contact')
      .order('property_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as TiktokPropertyRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

async function clearSheet(accessToken: string) {
  const range = encodeURIComponent(`'${SHEET_NAME}'!A3:H`)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: '{}',
    },
  )

  if (!response.ok) {
    const textBody = await response.text()
    throw new Error(`シートの消去に失敗しました。${textBody}`)
  }
}

async function updateSheet(accessToken: string, values: string[][]) {
  if (values.length === 0) return

  const range = encodeURIComponent(`'${SHEET_NAME}'!A3:H`)
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

  if (!response.ok) {
    const textBody = await response.text()
    throw new Error(`シートへの書き込みに失敗しました。${textBody}`)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POSTだけ使えます。' })
  }

  try {
    const records = await fetchAllTiktokProperties()
    const values = records.map(toSheetRow)
    const accessToken = await getGoogleAccessToken()

    await clearSheet(accessToken)
    await updateSheet(accessToken, values)

    return res.status(200).json({
      ok: true,
      count: values.length,
      sheetName: SHEET_NAME,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'スプレッドシート反映に失敗しました。'
    return res.status(500).json({ ok: false, message })
  }
}
