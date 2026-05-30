import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SPREADSHEET_ID = '1vgiE6-onVtpQP2mI44dj768FCi2Y9a0vSonB6tRBDCk'
const GRAPH_API_VERSION = 'v25.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const SHEET_CONFIGS = {
  tiktok: {
    sheetName: 'TikTok｜営業店',
    sheetRange: 'A1:AK49',
  },
  insta: {
    sheetName: 'INSTA｜全アカ',
    sheetRange: 'A1:AA56',
  },
} as const

type SheetValue = string | number | boolean | null
type SheetRow = SheetValue[]

type SheetColumn = {
  index: number
  year: string
  month: string
  label: string
}

type TiktokMetricRow = {
  metric: string
  values: string[]
}

type TiktokGroup = {
  account: string
  rows: TiktokMetricRow[]
}

type GoogleSheetValuesResponse = {
  values?: SheetRow[]
  error?: { message?: string }
}

type InstagramAccountConfig = {
  key: string
  account: string
  instagramUserId: string
}

type InsightMetricKey = 'views' | 'reach' | 'urlClicks'

type InsightResult = {
  username?: string
  followers: number | null
  mediaCount: number | null
  views: number | null
  reach: number | null
  urlClicks: number | null
}

const DEFAULT_INSTAGRAM_ACCOUNTS: InstagramAccountConfig[] = [
  { key: 'karilun_com', account: 'Karilun', instagramUserId: '17841411857507663' },
  { key: 'ap_nagase', account: '長瀬', instagramUserId: '17841408519154477' },
]

const INSTAGRAM_METRIC_LABELS = {
  followers: 'フォロワー数',
  mediaCount: '投稿数',
  views: '視聴回数(閲覧数)',
  reach: '視聴者リーチ',
  urlClicks: 'URLクリック',
} as const

function text(value: SheetValue | undefined) {
  return String(value ?? '').trim()
}

function parseNumberText(value: string) {
  const match = value.match(/\d{1,4}/)
  return match ? match[0] : ''
}

function buildColumns(rows: SheetRow[]) {
  const yearRow = rows[0] || []
  const monthRow = rows[1] || []
  const columns: SheetColumn[] = []
  let currentYear = ''

  for (let index = 2; index < Math.max(yearRow.length, monthRow.length); index += 1) {
    const year = parseNumberText(text(yearRow[index]))
    if (year) currentYear = year

    const month = parseNumberText(text(monthRow[index]))
    if (!currentYear || !month) continue

    columns.push({
      index,
      year: currentYear,
      month,
      label: `${currentYear}年${month}月`,
    })
  }

  return columns
}

function parseSheetRows(rows: SheetRow[]) {
  const columns = buildColumns(rows)
  const groups: TiktokGroup[] = []
  let currentAccount = ''

  rows.slice(2).forEach((row) => {
    const account = text(row[0])
    if (account) currentAccount = account

    const metric = text(row[1])
    if (!currentAccount || !metric) return

    const values = columns.map((column) => text(row[column.index]))
    if (!values.some(Boolean)) return

    let group = groups.find((item) => item.account === currentAccount)
    if (!group) {
      group = { account: currentAccount, rows: [] }
      groups.push(group)
    }

    group.rows.push({ metric, values })
  })

  return {
    columns: columns.map(({ year, month, label }) => ({ year, month, label })),
    groups,
  }
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error('Supabaseの接続設定がありません。')
  return createClient(url, key)
}

function parseAccountsConfig() {
  const rawValue = process.env.INSTAGRAM_ACCOUNT_IDS
  if (!rawValue) return DEFAULT_INSTAGRAM_ACCOUNTS

  const parsed = JSON.parse(rawValue) as InstagramAccountConfig[]
  return parsed.filter((account) => account.account && account.instagramUserId)
}

function getMonthRange(year: number, month: number) {
  const since = Math.floor(Date.UTC(year, month - 1, 1, 0, 0, 0) / 1000)
  const until = Math.floor(Date.UTC(year, month, 1, 0, 0, 0) / 1000)
  return { since, until }
}

function numberOrNull(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function sumInsightValues(metricData: unknown) {
  if (!metricData || typeof metricData !== 'object') return null

  const item = metricData as { total_value?: { value?: unknown }, values?: Array<{ value?: unknown }> }
  const totalValue = numberOrNull(item.total_value?.value)
  if (totalValue !== null) return totalValue

  if (!Array.isArray(item.values)) return null
  return item.values.reduce((sum, row) => sum + (numberOrNull(row.value) || 0), 0)
}

async function fetchGraphJson<T>(path: string, accessToken: string) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`${GRAPH_API_BASE}${path}${separator}access_token=${encodeURIComponent(accessToken)}`)
  const data = await response.json() as T & { error?: { message?: string } }

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Instagramの数字を取得できませんでした。')
  }

  return data
}

async function fetchInstagramAccountFields(instagramUserId: string, accessToken: string) {
  return fetchGraphJson<{ username?: string, followers_count?: number, media_count?: number }>(
    `/${instagramUserId}?fields=username,followers_count,media_count`,
    accessToken,
  )
}

async function fetchInstagramInsightMetrics(instagramUserId: string, accessToken: string, since: number, until: number) {
  const metricMap: Record<InsightMetricKey, string[]> = {
    views: ['views'],
    reach: ['reach'],
    urlClicks: ['website_clicks', 'profile_links_taps'],
  }

  const results: Record<InsightMetricKey, number | null> = {
    views: null,
    reach: null,
    urlClicks: null,
  }

  for (const metricKey of Object.keys(metricMap) as InsightMetricKey[]) {
    for (const metricName of metricMap[metricKey]) {
      const paths = [
        `/${instagramUserId}/insights?metric=${metricName}&period=day&metric_type=total_value&since=${since}&until=${until}`,
        `/${instagramUserId}/insights?metric=${metricName}&period=day&metric_type=total_value`,
      ]

      for (const path of paths) {
        try {
          const data = await fetchGraphJson<{ data?: unknown[] }>(path, accessToken)
          results[metricKey] = sumInsightValues(data.data?.[0])
          break
        } catch {
          // Meta側の指標名や期間指定は変わることがあるので、次の候補で試します。
        }
      }

      if (results[metricKey] !== null) break
    }
  }

  return results
}

async function fetchInstagramInsights(account: InstagramAccountConfig, accessToken: string, year: number, month: number): Promise<InsightResult> {
  const { since, until } = getMonthRange(year, month)
  const accountFields = await fetchInstagramAccountFields(account.instagramUserId, accessToken)
  const insights = await fetchInstagramInsightMetrics(account.instagramUserId, accessToken, since, until)

  return {
    username: accountFields.username,
    followers: numberOrNull(accountFields.followers_count),
    mediaCount: numberOrNull(accountFields.media_count),
    ...insights,
  }
}

function buildInstagramRows(year: number, month: number, accountName: string, insights: InsightResult) {
  const rows = [
    { metric: INSTAGRAM_METRIC_LABELS.followers, value: insights.followers },
    { metric: INSTAGRAM_METRIC_LABELS.mediaCount, value: insights.mediaCount },
    { metric: INSTAGRAM_METRIC_LABELS.views, value: insights.views },
    { metric: INSTAGRAM_METRIC_LABELS.reach, value: insights.reach },
    { metric: INSTAGRAM_METRIC_LABELS.urlClicks, value: insights.urlClicks },
  ]

  return rows
    .filter((row) => row.value !== null)
    .map((row) => ({
      year,
      month,
      account: accountName,
      metric: row.metric,
      value: String(row.value),
      updated_at: new Date().toISOString(),
    }))
}

async function syncInstagramInsights(req: VercelRequest, res: VercelResponse) {
  const accessToken = process.env.META_GRAPH_ACCESS_TOKEN || process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(200).json({
      ok: false,
      message: 'Metaの接続キーがまだ設定されていません。META_GRAPH_ACCESS_TOKENをVercelに入れてください。',
    })
  }

  const now = new Date()
  const year = Number(req.body?.year || now.getFullYear())
  const month = Number(req.body?.month || now.getMonth() + 1)
  const dryRun = req.body?.dryRun === true

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ ok: false, message: '年月が正しくありません。' })
  }

  try {
    const accounts = parseAccountsConfig()
    if (accounts.length === 0) {
      return res.status(200).json({
        ok: false,
        message: 'InstagramアカウントIDが設定されていません。',
      })
    }

    const summaries = []
    const failures = []
    const rowsToSave = []

    for (const account of accounts) {
      try {
        const insights = await fetchInstagramInsights(account, accessToken, year, month)
        summaries.push({ key: account.key, account: account.account, username: insights.username, ...insights })
        rowsToSave.push(...buildInstagramRows(year, month, account.account, insights))
      } catch (error) {
        failures.push({
          key: account.key,
          account: account.account,
          message: error instanceof Error ? error.message : '取得できませんでした。',
        })
      }
    }

    if (!dryRun && rowsToSave.length > 0) {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('analysis_insta_metrics')
        .upsert(rowsToSave, { onConflict: 'year,month,account,metric' })

      if (error) throw new Error(error.message)
    }

    return res.status(200).json({
      ok: failures.length < accounts.length,
      year,
      month,
      saved: dryRun ? 0 : rowsToSave.length,
      summaries,
      failures,
      message: failures.length > 0
        ? `一部のInstagramは取得できませんでした: ${failures.map((failure) => failure.key).join(', ')}`
        : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagramの自動取得に失敗しました。'
    return res.status(200).json({ ok: false, message })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST' && req.query.action === 'sync-instagram-insights') {
    return syncInstagramInsights(req, res)
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'GETで開いてください。' })
  }

  const sheetType = req.query.sheet === 'insta' ? 'insta' : 'tiktok'
  const config = SHEET_CONFIGS[sheetType]

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.VITE_GOOGLE_SHEETS_API_KEY
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      message: 'Googleスプレッドシートを読むためのキーが設定されていません。',
      columns: [],
      groups: [],
    })
  }

  const range = encodeURIComponent(`'${config.sheetName}'!${config.sheetRange}`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE&key=${apiKey}`

  try {
    const response = await fetch(url)
    const data = await response.json() as GoogleSheetValuesResponse

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'スプレッドシートを読めませんでした。')
    }

    const parsed = parseSheetRows(data.values || [])
    return res.status(200).json({
      ok: true,
      sheetName: config.sheetName,
      fetchedAt: new Date().toISOString(),
      ...parsed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'スプレッドシートを読めませんでした。'
    return res.status(200).json({ ok: false, message, columns: [], groups: [] })
  }
}
