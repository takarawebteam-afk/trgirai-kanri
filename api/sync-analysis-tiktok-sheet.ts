import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1hOIT8zCmR_KGtsHvFEaqkLkBKxkrDGwbltmNULKCmkM'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

type AnalysisSheetType = 'tiktok' | 'insta' | 'threads' | 'youtube'

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

const FOLLOWERS_PER_POST_ROW_OFFSET = 3

const SHEET_CONFIGS: Record<AnalysisSheetType, {
  sheetName: string
  tableName: string
  accountBlockStart: Record<string, number>
  metricRowOffset: Record<string, number>
  totalBlockStart: number
}> = {
  tiktok: {
    sheetName: '店舗TikTok',
    tableName: 'analysis_tiktok_metrics',
    accountBlockStart: {
      Karilun: 3,
      京北: 13,
      京阪: 13,
      西宮市: 23,
      長瀬: 33,
      西北: 43,
      八尾: 53,
    },
    metricRowOffset: {
      フォロワー数: 0,
      フォロワー増加数: 1,
      投稿数: 2,
      視聴者リーチ: 4,
      プロフ閲覧: 5,
      URLクリック: 6,
      電話クリック: 8,
    },
    totalBlockStart: 63,
  },
  insta: {
    sheetName: '店舗INSTA',
    tableName: 'analysis_insta_metrics',
    accountBlockStart: {
      Karilun: 3,
      京北: 12,
      京阪: 12,
      西宮市: 21,
      長瀬: 30,
      西北: 39,
      八尾: 48,
    },
    metricRowOffset: {
      フォロワー数: 0,
      フォロワー増加数: 1,
      投稿数: 2,
      '視聴回数(閲覧数)': 4,
      視聴者リーチ: 5,
      プロフ閲覧: 6,
      URLクリック: 7,
    },
    totalBlockStart: 57,
  },
  threads: {
    sheetName: '店舗threads',
    tableName: 'analysis_threads_metrics',
    accountBlockStart: {
      Karilun: 3,
      京北: 11,
      京阪: 11,
      長瀬: 19,
      西北: 27,
      八尾: 35,
    },
    metricRowOffset: {
      フォロワー数: 0,
      投稿数: 2,
      '視聴回数(閲覧数)': 4,
      いいね数: 5,
      リポスト数: 6,
      コメント数: 7,
    },
    totalBlockStart: 43,
  },
  youtube: {
    sheetName: '店舗YouTube',
    tableName: 'analysis_youtube_metrics',
    accountBlockStart: {
      Karilun: 3,
      長瀬: 11,
      西北: 19,
      八尾: 27,
    },
    metricRowOffset: {
      チャンネル登録数: 0,
      投稿数: 2,
      再生数: 4,
      平均視聴時間: 5,
      '平均視聴時間（秒）': 5,
      いいね数: 6,
      コメント数: 7,
    },
    totalBlockStart: 35,
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

async function fetchAllMetrics(tableName: string) {
  const supabase = getSupabaseClient()
  const rows: AnalysisTiktokMetricRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
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

function buildBatchUpdateData(
  records: AnalysisTiktokMetricRecord[],
  config: (typeof SHEET_CONFIGS)[AnalysisSheetType],
) {
  const rowsByNumber = new Map<number, SheetCellValue[]>()

  for (const record of records) {
    const account = String(record.account ?? '').trim()
    const metric = String(record.metric ?? '').trim()
    const blockStart = config.accountBlockStart[account]
    const offset = config.metricRowOffset[metric]
    const monthIndex = getMonthIndex(record.year, record.month)

    if (blockStart === undefined || offset === undefined || monthIndex === null) continue

    const rowNumber = blockStart + offset
    const rowValues = rowsByNumber.get(rowNumber) || Array<SheetCellValue>(24).fill('')
    rowValues[monthIndex] = normalizeSheetValue(record.value)
    rowsByNumber.set(rowNumber, rowValues)
  }

  const sheetName = escapeSheetName(config.sheetName)
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

async function getSheetId(accessToken: string, sheetName: string) {
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
    ?.find((sheet) => sheet.properties?.title === sheetName)
    ?.properties
    ?.sheetId

  if (sheetId === undefined) throw new Error(`Sheet not found: ${sheetName}`)
  return sheetId
}

async function formatFollowersPerPostRows(
  accessToken: string,
  config: (typeof SHEET_CONFIGS)[AnalysisSheetType],
) {
  const sheetId = await getSheetId(accessToken, config.sheetName)
  const blockStarts = [...new Set([
    ...Object.values(config.accountBlockStart),
    config.totalBlockStart,
  ])].sort((a, b) => a - b)
  const requests = blockStarts.map((blockStart) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: blockStart + FOLLOWERS_PER_POST_ROW_OFFSET - 1,
        endRowIndex: blockStart + FOLLOWERS_PER_POST_ROW_OFFSET,
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
    const requestedSheet = Array.isArray(req.query.sheet) ? req.query.sheet[0] : req.query.sheet
    const sheetType: AnalysisSheetType = (
      requestedSheet === 'insta'
      || requestedSheet === 'threads'
      || requestedSheet === 'youtube'
    ) ? requestedSheet : 'tiktok'
    const config = SHEET_CONFIGS[sheetType]

    if (req.method === 'GET') {
      const account = getGoogleServiceAccount()
      if (!account) {
        return res.status(500).json({ ok: false, message: 'Google sheet write key is not set.' })
      }

      return res.status(200).json({
        ok: true,
        serviceAccountEmail: account.email,
        spreadsheetId: SPREADSHEET_ID,
        sheet: config.sheetName,
      })
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, message: 'GET or POST only.' })
    }

    const records = await fetchAllMetrics(config.tableName)
    const data = buildBatchUpdateData(records, config)
    const cellsWritten = data.reduce(
      (sum, item) => sum + item.values[0].filter((value) => value !== '').length,
      0,
    )
    const accessToken = await getGoogleAccessToken()

    await updateSheet(accessToken, data)
    await formatFollowersPerPostRows(accessToken, config)

    return res.status(200).json({
      ok: true,
      sheet: config.sheetName,
      rowsWritten: data.length,
      cellsWritten,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
