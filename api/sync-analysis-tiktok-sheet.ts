import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1LmM6QPq5cwic6j-IKumeOI72x1MmK8Vx88Fz-uJSsEI'
const SHEET_NAME = '店舗TikTok'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

type AnalysisTiktokMetricRecord = {
  year: number
  month: number
  account: string
  metric: string
  value: string | null
}

type SheetCellValue = number | ''

type SheetsMetadataResponse = {
  sheets?: Array<{
    properties?: {
      sheetId?: number
      title?: string
    }
  }>
}

const ACCOUNT_BLOCK_START: Record<string, number> = {
  Karilun: 3,
  京北: 13,
  京阪: 13,
  西宮市: 23,
  長瀬: 33,
  西北: 43,
  八尾: 53,
}

const METRIC_ROW_OFFSET: Record<string, number> = {
  フォロワー数: 0,
  フォロワー増加数: 1,
  投稿数: 2,
  視聴者リーチ: 4,
  プロフ閲覧: 5,
  URLクリック: 6,
  電話クリック: 8,
}

const FOLLOWERS_PER_POST_BLOCK_STARTS = [...new Set([...Object.values(ACCOUNT_BLOCK_START), 63])].sort(
  (a, b) => a - b,
)
const FOLLOWERS_PER_POST_ROW_OFFSET = 3
const FOLLOWERS_PER_POST_ROW_NUMBERS = FOLLOWERS_PER_POST_BLOCK_STARTS.map(
  (blockStart) => blockStart + FOLLOWERS_PER_POST_ROW_OFFSET,
)

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

async function fetchAllTiktokMetrics() {
  const supabase = getSupabaseClient()
  const rows: AnalysisTiktokMetricRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('analysis_tiktok_metrics')
      .select('year, month, account, metric, value')
      .order('year', { ascending: true })
      .order('month', { ascending: true })
      .order('account', { ascending: true })
      .order('metric', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as unknown as AnalysisTiktokMetricRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

function normalizeSheetValue(value: string | null): SheetCellValue {
  const cleaned = String(value ?? '').replace(/,/g, '').trim()
  if (!cleaned) return ''

  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : ''
}

function getMonthIndex(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null

  const monthIndex = (year - 2025) * 12 + (month - 1)
  if (monthIndex < 0 || monthIndex > 23) return null

  return monthIndex
}

function escapeSheetName(sheetName: string) {
  return sheetName.replace(/'/g, "''")
}

function buildBatchUpdateData(records: AnalysisTiktokMetricRecord[]) {
  const rowsByNumber = new Map<number, SheetCellValue[]>()

  for (const record of records) {
    const account = String(record.account ?? '').trim()
    const metric = String(record.metric ?? '').trim()
    const blockStart = ACCOUNT_BLOCK_START[account]
    const offset = METRIC_ROW_OFFSET[metric]
    const monthIndex = getMonthIndex(record.year, record.month)

    if (blockStart === undefined || offset === undefined || monthIndex === null) continue

    const rowNumber = blockStart + offset
    const rowValues = rowsByNumber.get(rowNumber) || Array<SheetCellValue>(24).fill('')
    rowValues[monthIndex] = normalizeSheetValue(record.value)
    rowsByNumber.set(rowNumber, rowValues)
  }

  const sheetName = escapeSheetName(SHEET_NAME)
  return Array.from(rowsByNumber.entries())
    .filter(([, values]) => values.some((value) => value !== ''))
    .sort(([a], [b]) => a - b)
    .map(([rowNumber, values]) => ({
      range: `'${sheetName}'!C${rowNumber}:Z${rowNumber}`,
      values: [values],
    }))
}

async function updateSheet(accessToken: string, data: Array<{ range: string; values: SheetCellValue[][] }>) {
  if (data.length === 0) return

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

async function getSheetId(accessToken: string) {
  const fields = encodeURIComponent('sheets.properties(sheetId,title)')
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=${fields}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) throw new Error(`Sheet metadata fetch failed. ${await response.text()}`)

  const data = await response.json() as SheetsMetadataResponse
  const sheetId = data.sheets
    ?.find((sheet) => sheet.properties?.title === SHEET_NAME)
    ?.properties
    ?.sheetId

  if (sheetId === undefined) throw new Error(`Sheet not found: ${SHEET_NAME}`)
  return sheetId
}

async function formatFollowersPerPostRows(accessToken: string) {
  const sheetId = await getSheetId(accessToken)
  const requests = FOLLOWERS_PER_POST_ROW_NUMBERS.map((rowNumber) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: 2,
        endColumnIndex: 26,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: {
            type: 'NUMBER',
            pattern: '0.0',
          },
        },
      },
      fields: 'userEnteredFormat.numberFormat',
    },
  }))

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  )

  if (!response.ok) throw new Error(`Sheet format update failed. ${await response.text()}`)
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

    const records = await fetchAllTiktokMetrics()
    const data = buildBatchUpdateData(records)
    const cellsWritten = data.reduce(
      (sum, item) => sum + item.values[0].filter((value) => value !== '').length,
      0,
    )
    const accessToken = await getGoogleAccessToken()

    await updateSheet(accessToken, data)
    await formatFollowersPerPostRows(accessToken)

    return res.status(200).json({
      ok: true,
      rowsWritten: data.length,
      cellsWritten,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TikTok analysis sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
