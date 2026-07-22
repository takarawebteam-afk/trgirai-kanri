import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type GaReportRow = {
  dimensionValues?: { value?: string }[]
  metricValues?: { value?: string }[]
}

type GaRunReportResponse = {
  rows?: GaReportRow[]
}

type GaErrorResponse = {
  error?: {
    message?: string
  }
}

type SearchConsoleRow = {
  keys?: string[]
  clicks?: number
  impressions?: number
}

type SearchConsoleResponse = {
  rows?: SearchConsoleRow[]
}

type AnalysisMedia = 'TikTok' | 'Instagram' | 'Threads' | 'YouTube' | 'その他'
type AnalysisAccount = 'Karilun' | '京阪' | '西宮市' | '八尾' | '長瀬' | '西北' | '採用'

type AnalysisSessionRow = {
  account: AnalysisAccount
  media: AnalysisMedia
  month: number
  sessions: number
}

type AnalyticsRequestBody = {
  accessToken?: unknown
  action?: unknown
  code?: unknown
  expiresIn?: unknown
  redirectUri?: unknown
  setupKey?: unknown
  year?: unknown
}

const ANALYSIS_ACCOUNTS: AnalysisAccount[] = ['Karilun', '京阪', '西宮市', '八尾', '長瀬', '西北', '採用']
const ANALYSIS_MEDIAS: AnalysisMedia[] = ['TikTok', 'Instagram', 'Threads', 'YouTube', 'その他']
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const GOOGLE_OAUTH_SCOPE = `${GA_SCOPE} ${SEARCH_CONSOLE_SCOPE}`

const GA4_PROPERTY_CONFIGS: Array<{
  propertyId: string | undefined
  fixedAccount?: AnalysisAccount
  fallbackAccount?: AnalysisAccount
}> = [
  { propertyId: process.env.GA4_PROPERTY_KARILUN || process.env.GA4_PROPERTY_ID || '315167676', fallbackAccount: 'Karilun' },
  { propertyId: process.env.GA4_PROPERTY_YAO || '476571386', fixedAccount: '八尾' },
  { propertyId: process.env.GA4_PROPERTY_NAGASE || '317090157', fixedAccount: '長瀬' },
  { propertyId: process.env.GA4_PROPERTY_NISHIKITA || '317217717', fixedAccount: '西北' },
  { propertyId: process.env.GA4_PROPERTY_SAIYO || '398577157', fixedAccount: '採用' },
]

let cachedToken: { accessToken: string; expiresAt: number } | null = null

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function getPrivateKey() {
  return (
    process.env.GA4_PRIVATE_KEY
    || process.env.GOOGLE_ANALYTICS_PRIVATE_KEY
    || process.env.GOOGLE_PRIVATE_KEY
    || ''
  ).replace(/\\n/g, '\n')
}

function envText(value: string | undefined) {
  return (value || '').trim()
}

function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getSupabaseAdmin() {
  const url = envText(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const key = envText(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function getStoredRefreshToken() {
  const supabase = getSupabaseAdmin()
  if (!supabase) return ''

  const { data } = await supabase
    .from('app_secrets')
    .select('value')
    .eq('key', 'ga4_refresh_token')
    .maybeSingle()

  return typeof data?.value === 'string' ? data.value.trim() : ''
}

async function getStoredAccessToken() {
  const supabase = getSupabaseAdmin()
  if (!supabase) return ''

  const { data } = await supabase
    .from('app_secrets')
    .select('key, value')
    .in('key', ['ga4_access_token', 'ga4_access_token_expires_at'])

  const values = new Map((data || []).map((row) => [row.key, row.value]))
  const accessToken = values.get('ga4_access_token') || ''
  const expiresAt = values.get('ga4_access_token_expires_at') || ''
  const expiresAtMs = Date.parse(expiresAt)

  if (!accessToken || !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now() + 60_000) {
    return ''
  }

  return accessToken
}

function isValidSetupKey(value: unknown) {
  const setupKey = envText(process.env.GA4_SETUP_KEY)
  return Boolean(setupKey && value === setupKey)
}

function handleOauthConfig(req: VercelRequest, res: VercelResponse) {
  if (!isValidSetupKey(getQueryValue(req.query.key))) {
    return res.status(403).json({ ok: false, message: 'not_allowed' })
  }

  const clientId = envText(
    process.env.GA4_OAUTH_CLIENT_ID
    || process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID
    || process.env.VITE_GOOGLE_CLIENT_ID
  )
  if (!clientId) {
    return res.status(200).json({ ok: false, message: 'GA4のGoogleログイン設定がありません。' })
  }

  return res.status(200).json({ ok: true, clientId })
}

async function handleRefreshExchange(body: AnalyticsRequestBody, res: VercelResponse) {
  if (!isValidSetupKey(body.setupKey)) {
    return res.status(403).json({ ok: false, message: 'not_allowed' })
  }

  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : 'postmessage'
  const clientId = envText(process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID)
  const clientSecret = envText(process.env.GA4_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET)

  if (!code || !clientId || !clientSecret) {
    return res.status(200).json({ ok: false, message: 'GA4の再接続に必要な設定が足りません。' })
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenData = await tokenResponse.json() as { refresh_token?: string, error?: string }

  if (!tokenResponse.ok) {
    return res.status(200).json({ ok: false, message: `Googleが接続を断りました: ${tokenData.error || 'unknown_error'}` })
  }
  if (!tokenData.refresh_token) {
    return res.status(200).json({
      ok: false,
      message: '新しい接続設定が返ってきませんでした。別のGoogleアカウントで試してください。',
    })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return res.status(200).json({ ok: false, message: 'Supabaseの保存設定がありません。' })
  }

  const updatedAt = new Date().toISOString()
  const { error } = await supabase
    .from('app_secrets')
    .upsert([
      { key: 'ga4_refresh_token', value: tokenData.refresh_token, updated_at: updatedAt },
      { key: 'ga4_access_token', value: '', updated_at: updatedAt },
      { key: 'ga4_access_token_expires_at', value: '1970-01-01T00:00:00.000Z', updated_at: updatedAt },
    ])

  if (error) {
    return res.status(200).json({ ok: false, message: `保存に失敗しました: ${error.message}` })
  }

  cachedToken = null
  return res.status(200).json({ ok: true, scope: GOOGLE_OAUTH_SCOPE })
}

async function handleStoreAccessToken(body: AnalyticsRequestBody, res: VercelResponse) {
  if (!isValidSetupKey(body.setupKey)) {
    return res.status(403).json({ ok: false, message: 'not_allowed' })
  }

  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
  const expiresIn = Number(body.expiresIn || 3600)
  const supabase = getSupabaseAdmin()

  if (!accessToken) {
    return res.status(200).json({ ok: false, message: 'Googleログインの鍵が届きませんでした。' })
  }
  if (!supabase) {
    return res.status(200).json({ ok: false, message: 'Supabaseの保存設定がありません。' })
  }

  const expiresAt = new Date(Date.now() + Math.max(300, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString()
  const { error } = await supabase
    .from('app_secrets')
    .upsert([
      { key: 'ga4_access_token', value: accessToken, updated_at: new Date().toISOString() },
      { key: 'ga4_access_token_expires_at', value: expiresAt, updated_at: new Date().toISOString() },
    ])

  if (error) {
    return res.status(200).json({ ok: false, message: `保存に失敗しました: ${error.message}` })
  }

  cachedToken = { accessToken, expiresAt: Math.floor(Date.parse(expiresAt) / 1000) }
  return res.status(200).json({ ok: true })
}

function normalizeAccount(value: string): AnalysisAccount | null {
  const normalized = value.toLowerCase().replace(/\s+/g, '_')

  if (normalized.includes('karilun_keihan')) return '京阪'
  if (normalized.includes('karilun_nishinomiya')) return '西宮市'
  if (normalized.includes('nishinomiya')) return '西宮市'
  if (normalized.includes('keihan')) return '京阪'
  if (normalized.includes('yao')) return '八尾'
  if (normalized.includes('nagase')) return '長瀬'
  if (normalized.includes('nishikita')) return '西北'
  if (normalized.includes('karilun')) return 'Karilun'

  return null
}

function normalizeMedia(...values: string[]): AnalysisMedia {
  const normalized = values.join(' ').toLowerCase()

  if (normalized.includes('link_in_bio')) return 'その他'
  if (normalized.includes('tiktok')) return 'TikTok'
  if (normalized.includes('instagram') || normalized.includes('ig')) return 'Instagram'
  if (normalized.includes('threads')) return 'Threads'
  if (normalized.includes('youtube') || normalized.includes('youtu.be')) return 'YouTube'

  return 'その他'
}

function normalizeRecruitMedia(...values: string[]): AnalysisMedia {
  const normalized = values.join(' ').toLowerCase()

  if (normalized.includes('tiktok')) return 'TikTok'
  if (normalized.includes('instagram') || normalized.includes('ig')) return 'Instagram'
  if (normalized.includes('threads')) return 'Threads'
  if (normalized.includes('youtube') || normalized.includes('youtu.be')) return 'YouTube'

  return 'その他'
}

function isSocialSession(...values: string[]) {
  const normalized = values.join(' ').toLowerCase()

  return (
    normalized.includes('social')
      || normalized.includes('tiktok')
      || normalized.includes('instagram')
      || normalized.includes('threads')
      || normalized.includes('youtube')
      || normalized.includes('youtu.be')
      || normalized.includes('link_in_bio')
  )
}

function emptyRows() {
  const rows: AnalysisSessionRow[] = []

  for (const account of ANALYSIS_ACCOUNTS) {
    for (const media of ANALYSIS_MEDIAS) {
      for (let month = 1; month <= 12; month += 1) {
        rows.push({ account, media, month, sessions: 0 })
      }
    }
  }

  return rows
}

function getTokyoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: Number(values.year),
    dateKey: `${values.year}-${values.month}-${values.day}`,
  }
}

function getGaDateRange(year: number) {
  const today = getTokyoDateParts(new Date())
  const startDate = `${year}-01-01`
  const endOfYear = `${year}-12-31`

  if (year < today.year) return { startDate, endDate: endOfYear }
  if (year === today.year) return { startDate, endDate: today.dateKey }

  return null
}

function getPropertyConfigAccount(config: (typeof GA4_PROPERTY_CONFIGS)[number]) {
  return config.fixedAccount || config.fallbackAccount || '不明'
}

function getReadableGaErrorMessage(message: string) {
  if (message.includes('User does not have sufficient permissions')) {
    return 'このGoogleアカウントにGA4を見る権限がありません。GA4を見られるGoogleアカウントでつなぎ直してください。'
  }

  return message || 'GA4から数字を取れませんでした。'
}

async function getAccessTokenFromServiceAccount(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken
  }

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: GOOGLE_OAUTH_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }))
  const unsignedJwt = `${header}.${claim}`
  const signature = createSign('RSA-SHA256').update(unsignedJwt).sign(privateKey)
  const jwt = `${unsignedJwt}.${base64Url(signature)}`

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!response.ok) throw new Error('service_account_auth_failed')

  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('missing_access_token')

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  }

  return data.access_token
}

async function getAccessTokenFromRefreshToken(clientId: string, clientSecret: string, refreshToken: string) {
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) throw new Error('refresh_token_auth_failed')

  const data = await response.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('missing_access_token')

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in || 3600),
  }

  return data.access_token
}

async function getAnalyticsAccessToken() {
  const refreshClientId = envText(process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID)
  const refreshClientSecret = envText(process.env.GA4_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET)
  const refreshToken = envText(process.env.GA4_REFRESH_TOKEN || process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN)

  const storedAccessToken = await getStoredAccessToken().catch(() => '')
  if (storedAccessToken) return storedAccessToken

  if (refreshClientId && refreshClientSecret && refreshToken) {
    try {
      return await getAccessTokenFromRefreshToken(refreshClientId, refreshClientSecret, refreshToken)
    } catch {
      cachedToken = null
    }
  }

  const storedRefreshToken = await getStoredRefreshToken().catch(() => '')
  if (refreshClientId && refreshClientSecret && storedRefreshToken) {
    try {
      return await getAccessTokenFromRefreshToken(refreshClientId, refreshClientSecret, storedRefreshToken)
    } catch {
      cachedToken = null
    }
  }

  const clientEmail = envText(
    process.env.GA4_CLIENT_EMAIL
    || process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL
    || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  )
  const privateKey = getPrivateKey()

  if (clientEmail && privateKey) {
    return await getAccessTokenFromServiceAccount(clientEmail, privateKey)
  }

  return null
}

const ANALYSIS_GA_SPREADSHEET_ID = process.env.ANALYSIS_GA_SPREADSHEET_ID || '1hOIT8zCmR_KGtsHvFEaqkLkBKxkrDGwbltmNULKCmkM'
const ANALYSIS_GA_STORE_SHEET_NAME = '仲介店舗GA'
const ANALYSIS_GA_INDIRECT_SHEET_NAME = '間接部署GA'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const SHEET_START_YEAR = 2025
const SHEET_MONTH_COUNT = 24
const SHEET_END_YEAR = SHEET_START_YEAR + Math.ceil(SHEET_MONTH_COUNT / 12) - 1
const SHEET_ONLY_KANRI_GA_PROPERTY_ID = process.env.GA4_PROPERTY_KANRI || '398626147'
const KANRI_SEARCH_CONSOLE_SITE_URLS = (process.env.SEARCH_CONSOLE_SITE_URL || process.env.GSC_SITE_URL || 'https://www.rentax.co.jp/,http://www.rentax.co.jp/,sc-domain:rentax.co.jp')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

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

const SITE_TRAFFIC_ROW_OFFSET: Record<string, number> = {
  自然検索: 0,
  指名検索表示数: 1,
  指名検索クリック: 2,
  ダイレクト: 3,
  外部サイト: 4,
  AI経由: 5,
  その他: 6,
}

const INDIRECT_SOCIAL_ACCOUNT_BLOCK_START: Record<string, number> = {
  採用: 3,
  管理: 11,
}

const INDIRECT_SITE_ACCOUNT_BLOCK_START: Record<string, number> = {
  管理課サイト: 19,
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
    aud: TOKEN_URL,
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
  const response = await fetch(TOKEN_URL, {
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

function createEmptySheetRows(accountBlockStart: Record<string, number>, rowOffset: Record<string, number>) {
  const rowsByNumber = new Map<number, SheetCellValue[]>()

  for (const blockStart of Object.values(accountBlockStart)) {
    for (const offset of Object.values(rowOffset)) {
      rowsByNumber.set(blockStart + offset, Array<SheetCellValue>(SHEET_MONTH_COUNT).fill(0))
    }
  }

  return rowsByNumber
}

function buildSheetUpdateData(
  records: AnalysisSessionRecord[],
  sheetNameValue: string,
  accountBlockStart: Record<string, number>,
  rowOffset: Record<string, number>,
) {
  const rowsByNumber = createEmptySheetRows(accountBlockStart, rowOffset)

  for (const record of records) {
    const blockStart = accountBlockStart[String(record.account ?? '').trim()]
    const offset = rowOffset[String(record.media ?? '').trim()]
    const monthIndex = getMonthIndex(Number(record.year), Number(record.month))

    if (blockStart === undefined || offset === undefined || monthIndex === null) continue

    const rowNumber = blockStart + offset
    const rowValues = rowsByNumber.get(rowNumber) || Array<SheetCellValue>(SHEET_MONTH_COUNT).fill(0)
    rowValues[monthIndex] = normalizeSessions(record.sessions)
    rowsByNumber.set(rowNumber, rowValues)
  }

  const sheetName = escapeSheetName(sheetNameValue)
  return Array.from(rowsByNumber.entries())
    .sort(([a], [b]) => a - b)
    .map(([rowNumber, values]) => ({
      range: `'${sheetName}'!C${rowNumber}:Z${rowNumber}`,
      values: [values],
    }))
}

function buildBatchUpdateData(records: AnalysisSessionRecord[]) {
  return [
    ...buildSheetUpdateData(records, ANALYSIS_GA_STORE_SHEET_NAME, ACCOUNT_BLOCK_START, MEDIA_ROW_OFFSET),
    ...buildSheetUpdateData(records, ANALYSIS_GA_INDIRECT_SHEET_NAME, INDIRECT_SOCIAL_ACCOUNT_BLOCK_START, MEDIA_ROW_OFFSET),
    ...buildSheetUpdateData(records, ANALYSIS_GA_INDIRECT_SHEET_NAME, INDIRECT_SITE_ACCOUNT_BLOCK_START, SITE_TRAFFIC_ROW_OFFSET),
  ]
}

async function updateSheet(accessToken: string, data: Array<{ range: string; values: SheetCellValue[][] }>) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ANALYSIS_GA_SPREADSHEET_ID}/values:batchUpdate`,
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

async function handleSyncGaSheet(res: VercelResponse) {
  try {
    const records = await fetchAllAnalysisSessions()
    const sheetOnlyRecords = await fetchSheetOnlyAnalysisSessions()
    const data = buildBatchUpdateData([...records, ...sheetOnlyRecords])
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

async function fetchPropertyRows(propertyId: string, year: number, accessToken: string) {
  const dateRange = getGaDateRange(year)
  if (!dateRange) return { rows: [] } satisfies GaRunReportResponse

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [dateRange],
      dimensions: [
        { name: 'month' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
        { name: 'sessionCampaignName' },
        { name: 'sessionManualAdContent' },
      ],
      metrics: [{ name: 'sessions' }],
      limit: '100000',
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null) as GaErrorResponse | null
    throw new Error(getReadableGaErrorMessage(data?.error?.message || ''))
  }

  return await response.json() as GaRunReportResponse
}

async function fetchPropertyChannelRows(propertyId: string, year: number, accessToken: string) {
  const dateRange = getGaDateRange(year)
  if (!dateRange) return { rows: [] } satisfies GaRunReportResponse

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [dateRange],
      dimensions: [
        { name: 'month' },
        { name: 'sessionDefaultChannelGroup' },
      ],
      metrics: [{ name: 'sessions' }],
      limit: '100000',
    }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null) as GaErrorResponse | null
    throw new Error(getReadableGaErrorMessage(data?.error?.message || ''))
  }

  return await response.json() as GaRunReportResponse
}

function normalizeSiteTrafficMedia(channelGroup: string) {
  switch (channelGroup) {
    case 'Organic Search':
      return '自然検索'
    case 'Direct':
      return 'ダイレクト'
    case 'Referral':
      return '外部サイト'
    case 'AI Assistant':
      return 'AI経由'
    case 'Organic Social':
    case 'Paid Social':
      return null
    default:
      return 'その他'
  }
}

function isKanriBrandSearchQuery(query: string) {
  const normalized = query.normalize('NFKC').toLowerCase()
  if (normalized.includes('takara') || normalized.includes('タカラ')) return false

  return normalized.includes('rentax') || normalized.includes('レンタックス')
}

function addSheetOnlyRecord(
  rowMap: Map<string, AnalysisSessionRecord>,
  record: AnalysisSessionRecord,
) {
  const key = `${record.year}:${record.account}:${record.media}:${record.month}`
  const current = rowMap.get(key)

  if (current) {
    current.sessions = normalizeSessions(current.sessions) + normalizeSessions(record.sessions)
  } else {
    rowMap.set(key, record)
  }
}

async function fetchSearchConsoleBrandRows(year: number, accessToken: string) {
  const dateRange = getGaDateRange(year)
  if (!dateRange) return []

  let data: SearchConsoleResponse | null = null

  for (const siteUrl of KANRI_SEARCH_CONSOLE_SITE_URLS) {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          dimensions: ['date', 'query'],
          rowLimit: 25000,
        }),
      },
    )

    if (response.ok) {
      data = await response.json() as SearchConsoleResponse
      break
    }
  }

  if (!data) return []
  const rowsByMonth = new Map<number, { clicks: number, impressions: number }>()

  for (const row of data.rows || []) {
    const dateKey = row.keys?.[0] || ''
    const query = row.keys?.[1] || ''
    const month = Number(dateKey.slice(5, 7))
    const clicks = Number(row.clicks || 0)
    const impressions = Number(row.impressions || 0)

    if (!isKanriBrandSearchQuery(query)) continue
    if (
      !Number.isInteger(month)
      || month < 1
      || month > 12
      || !Number.isFinite(clicks)
      || !Number.isFinite(impressions)
    ) continue

    const current = rowsByMonth.get(month) || { clicks: 0, impressions: 0 }
    current.clicks += clicks
    current.impressions += impressions
    rowsByMonth.set(month, current)
  }

  return Array.from(rowsByMonth.entries()).flatMap(([month, values]) => [
    {
      year,
      month,
      account: '管理課サイト',
      media: '指名検索表示数',
      sessions: values.impressions,
    },
    {
      year,
      month,
      account: '管理課サイト',
      media: '指名検索クリック',
      sessions: values.clicks,
    },
  ]) satisfies AnalysisSessionRecord[]
}

async function fetchSheetOnlyAnalysisSessions() {
  if (!SHEET_ONLY_KANRI_GA_PROPERTY_ID) return []

  const accessToken = await getAnalyticsAccessToken()
  if (!accessToken) throw new Error('管理課GAの接続設定がまだ入っていません。')

  const rowMap = new Map<string, AnalysisSessionRecord>()

  for (let year = SHEET_START_YEAR; year <= SHEET_END_YEAR; year += 1) {
    const socialData = await fetchPropertyRows(SHEET_ONLY_KANRI_GA_PROPERTY_ID, year, accessToken)

    for (const row of socialData.rows || []) {
      const dimensions = row.dimensionValues || []
      const month = Number(dimensions[0]?.value || 0)
      const source = dimensions[1]?.value || ''
      const medium = dimensions[2]?.value || ''
      const campaign = dimensions[3]?.value || ''
      const adContent = dimensions[4]?.value || ''
      const sessions = Number(row.metricValues?.[0]?.value || 0)
      const media = normalizeMedia(source, medium, campaign, adContent)

      if (!isSocialSession(source, medium, campaign, adContent)) continue
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(sessions)) continue

      addSheetOnlyRecord(rowMap, { year, month, account: '管理', media, sessions })
    }

    const siteData = await fetchPropertyChannelRows(SHEET_ONLY_KANRI_GA_PROPERTY_ID, year, accessToken)

    for (const row of siteData.rows || []) {
      const dimensions = row.dimensionValues || []
      const month = Number(dimensions[0]?.value || 0)
      const channelGroup = dimensions[1]?.value || ''
      const sessions = Number(row.metricValues?.[0]?.value || 0)
      const media = normalizeSiteTrafficMedia(channelGroup)

      if (!media) continue
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(sessions)) continue

      addSheetOnlyRecord(rowMap, { year, month, account: '管理課サイト', media, sessions })
    }

    for (const record of await fetchSearchConsoleBrandRows(year, accessToken)) {
      addSheetOnlyRecord(rowMap, record)
    }
  }

  return Array.from(rowMap.values())
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET' && getQueryValue(req.query.action) === 'oauth-config') {
    return handleOauthConfig(req, res)
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'method_not_allowed' })
  }

  let requestBody: AnalyticsRequestBody = {}
  try {
    if (typeof req.body === 'string') {
      requestBody = req.body ? JSON.parse(req.body) as AnalyticsRequestBody : {}
    } else {
      requestBody = (req.body || {}) as AnalyticsRequestBody
    }
  } catch {
    requestBody = {}
  }

  if (requestBody.action === 'refresh-exchange') {
    return await handleRefreshExchange(requestBody, res)
  }
  if (requestBody.action === 'store-access-token') {
    return await handleStoreAccessToken(requestBody, res)
  }
  if (requestBody.action === 'sync-ga-sheet') {
    return await handleSyncGaSheet(res)
  }

  const year = Number(requestBody.year || 2026)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ ok: false, message: 'year_invalid' })
  }

  const propertyConfigs = GA4_PROPERTY_CONFIGS.filter((config) => config.propertyId)
  const accessToken = await getAnalyticsAccessToken().catch(() => null)

  if (propertyConfigs.length === 0 || !accessToken) {
    return res.status(200).json({
      ok: false,
      message: 'GA4の接続設定がまだ入っていません。',
      missingConfig: true,
      rows: emptyRows(),
    })
  }

  try {
    const rowMap = new Map<string, AnalysisSessionRow>()

    for (const row of emptyRows()) {
      rowMap.set(`${row.account}:${row.media}:${row.month}`, row)
    }

    const warnings: string[] = []
    let fetchedPropertyCount = 0

    for (const config of propertyConfigs) {
      if (!config.propertyId) continue

      let data: GaRunReportResponse
      try {
        data = await fetchPropertyRows(config.propertyId, year, accessToken)
        fetchedPropertyCount += 1
      } catch (error) {
        const account = getPropertyConfigAccount(config)
        const message = error instanceof Error ? error.message : 'GA4から数字を取れませんでした。'
        warnings.push(`${account}（ID: ${config.propertyId}）: ${message}`)
        continue
      }

      for (const row of data.rows || []) {
        const dimensions = row.dimensionValues || []
        const month = Number(dimensions[0]?.value || 0)
        const source = dimensions[1]?.value || ''
        const medium = dimensions[2]?.value || ''
        const campaign = dimensions[3]?.value || ''
        const adContent = dimensions[4]?.value || ''
        const sessions = Number(row.metricValues?.[0]?.value || 0)
        const account = config.fixedAccount || normalizeAccount(adContent) || normalizeAccount(campaign) || config.fallbackAccount
        const media = config.fixedAccount === '採用'
          ? normalizeRecruitMedia(source, medium, campaign, adContent)
          : normalizeMedia(source, medium, campaign, adContent)

        if (!isSocialSession(source, medium, campaign, adContent)) continue
        if (!account || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(sessions)) continue

        const key = `${account}:${media}:${month}`
        const current = rowMap.get(key)
        if (current) current.sessions += sessions
      }
    }

    if (fetchedPropertyCount === 0 && warnings.length > 0) {
      return res.status(200).json({
        ok: false,
        message: `GA4の権限がありません。${warnings.join(' / ')}`,
        warnings,
        rows: emptyRows(),
      })
    }

    return res.status(200).json({
      ok: true,
      rows: Array.from(rowMap.values()),
      fetchedAt: new Date().toISOString(),
      warnings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GA4から数字を取れませんでした。'
    return res.status(200).json({ ok: false, message, rows: emptyRows() })
  }
}
