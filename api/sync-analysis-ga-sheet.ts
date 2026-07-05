import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = process.env.ANALYSIS_GA_SPREADSHEET_ID || '1hOIT8zCmR_KGtsHvFEaqkLkBKxkrDGwbltmNULKCmkM'
const SHEET_NAME = '仲介店舗GA'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const SHEET_START_YEAR = 2025
const SHEET_MONTH_COUNT = 24

type AnalysisSessionRecord = {
  year: number
  month: number
  account: string
  media: string
  sessions: number | null
}

type SheetCellValue = number

const ACCOUNT_BLOCK_START: Record<string, number> = {
  Karilun: 3,
  京阪: 11,
  西宮市: 19,
  長瀬: 27,
  西北: 35,
  八尾: 43,
}

const MEDIA_ROW_OFFSET: Record<string, number> = {
  TikTok: 0,
  Instagram: 1,
  Threads: 2,
  YouTube: 3,
  その他: 4,
}

function base64Url(value: string | Buffer) {
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

async function fetchAllAnalysisSessions() {
  const supabase = getSupabaseClient()
  const rows: AnalysisSessionRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('analysis_sessions')
      .select('year, month, account, media, sessions')
      .gte('year', SHEET_START_YEAR)
      .lte('year', SHEET_START_YEAR + 1)
      .order('year', { ascending: true })
      .order('month', { ascending: true })
      .order('account', { ascending: true })
      .order('media', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as unknown as AnalysisSessionRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

function getMonthIndex(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null

  const monthIndex = (year - SHEET_START_YEAR) * 12 + (month - 1)
  if (monthIndex < 0 || monthIndex >= SHEET_MONTH_COUNT) return null

  return monthIndex
}

function escapeSheetName(sheetName: string) {
  return sheetName.replace(/'/g, "''")
}

function normalizeSessions(value: number | null): SheetCellValue {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function createEmptySheetRows() {
  const rowsByNumber = new Map<number, SheetCellValue[]>()

  for (const blockStart of Object.values(ACCOUNT_BLOCK_START)) {
    for (const offset of Object.values(MEDIA_ROW_OFFSET)) {
      rowsByNumber.set(blockStart + offset, Array<SheetCellValue>(SHEET_MONTH_COUNT).fill(0))
    }
  }

  return rowsByNumber
}

function buildBatchUpdateData(records: AnalysisSessionRecord[]) {
  const rowsByNumber = createEmptySheetRows()

  for (const record of records) {
    const blockStart = ACCOUNT_BLOCK_START[String(record.account ?? '').trim()]
    const offset = MEDIA_ROW_OFFSET[String(record.media ?? '').trim()]
    const monthIndex = getMonthIndex(Number(record.year), Number(record.month))

    if (blockStart === undefined || offset === undefined || monthIndex === null) continue

    const rowNumber = blockStart + offset
    const rowValues = rowsByNumber.get(rowNumber) || Array<SheetCellValue>(SHEET_MONTH_COUNT).fill(0)
    rowValues[monthIndex] = normalizeSessions(record.sessions)
    rowsByNumber.set(rowNumber, rowValues)
  }

  const sheetName = escapeSheetName(SHEET_NAME)
  return Array.from(rowsByNumber.entries())
    .sort(([a], [b]) => a - b)
    .map(([rowNumber, values]) => ({
      range: `'${sheetName}'!C${rowNumber}:Z${rowNumber}`,
      values: [values],
    }))
}

async function updateSheet(accessToken: string, data: Array<{ range: string; values: SheetCellValue[][] }>) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    },
  )

  if (!response.ok) throw new Error(`Sheet batch update failed. ${await response.text()}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const account = getGoogleServiceAccount()
      if (!account) {
        return res.status(500).json({ ok: false, message: 'Google sheet write key is not set.' })
      }

      return res.status(200).json({
        ok: true,
        serviceAccountEmail: account.email,
        spreadsheetId: SPREADSHEET_ID,
        sheet: SHEET_NAME,
      })
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, message: 'GET or POST only.' })
    }

    const records = await fetchAllAnalysisSessions()
    const data = buildBatchUpdateData(records)
    const cellsWritten = data.reduce((sum, item) => sum + item.values[0].length, 0)
    const accessToken = await getGoogleAccessToken()

    await updateSheet(accessToken, data)

    return res.status(200).json({
      ok: true,
      rowsWritten: data.length,
      cellsWritten,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis GA sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
