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

  const { error } = await supabase
    .from('app_secrets')
    .upsert({
      key: 'ga4_refresh_token',
      value: tokenData.refresh_token,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    return res.status(200).json({ ok: false, message: `保存に失敗しました: ${error.message}` })
  }

  cachedToken = null
  return res.status(200).json({ ok: true, scope: GA_SCOPE })
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

async function getAccessTokenFromServiceAccount(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken
  }

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: GA_SCOPE,
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

async function fetchPropertyRows(propertyId: string, year: number, accessToken: string) {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${year}-01-01`, endDate: `${year}-12-31` }],
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

  if (!response.ok) throw new Error('ga4_report_failed')

  return await response.json() as GaRunReportResponse
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

    for (const config of propertyConfigs) {
      if (!config.propertyId) continue

      const data = await fetchPropertyRows(config.propertyId, year, accessToken)

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

    return res.status(200).json({
      ok: true,
      rows: Array.from(rowMap.values()),
      fetchedAt: new Date().toISOString(),
    })
  } catch {
    return res.status(200).json({ ok: false, message: 'GA4から数字を取れませんでした。', rows: emptyRows() })
  }
}
