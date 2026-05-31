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
  instagramUserId?: string
  instagramUsername?: string
  facebookPageName?: string
}

type InsightMetricKey = 'reach' | 'urlClicks' | 'profileViews'

type InsightResult = {
  username?: string
  followers: number | null
  mediaCount: number | null
  mediaCountInPeriod: number | null
  views: number | null
  reach: number | null
  urlClicks: number | null
  profileViews: number | null
}

const DEFAULT_INSTAGRAM_ACCOUNTS: InstagramAccountConfig[] = [
  { key: 'karilun_com', account: 'Karilun', instagramUserId: '17841411857507663' },
  { key: 'ap_nagase', account: '長瀬', instagramUserId: '17841408519154477' },
  { key: 'nishinomiyakita', account: '西北', instagramUsername: 'nishinomiyakita' },
  { key: 'nishinomiya_karilun', account: '西宮市', instagramUsername: 'nishinomiya_karilun' },
  { key: 'apaman_yao', account: '八尾', instagramUsername: 'apaman_yao' },
  { key: 'keihan_karilun', account: '京北', instagramUsername: 'keihan_karilun' },
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
  return parsed.filter((account) => (
    account.account
    && (account.instagramUserId || account.instagramUsername || account.facebookPageName)
  ))
}

type ConnectedInstagramAccount = {
  pageName: string
  instagramUserId: string
  instagramUsername?: string
}

function normalizeMetaName(value: string | undefined) {
  return String(value ?? '').replace(/^@/, '').trim().toLowerCase()
}

async function fetchConnectedInstagramAccounts(accessToken: string): Promise<ConnectedInstagramAccount[]> {
  try {
    const data = await fetchGraphJson<{
      data?: Array<{
        name?: string
        instagram_business_account?: {
          id?: string
          username?: string
        }
      }>
    }>(
      `/me/accounts?fields=${encodeURIComponent('name,instagram_business_account{id,username}')}&limit=100`,
      accessToken,
    )

    return (data.data ?? [])
      .map((page) => ({
        pageName: page.name ?? '',
        instagramUserId: page.instagram_business_account?.id ?? '',
        instagramUsername: page.instagram_business_account?.username,
      }))
      .filter((page) => page.instagramUserId)
  } catch {
    return []
  }
}

function resolveInstagramUserId(
  account: InstagramAccountConfig,
  connectedAccounts: ConnectedInstagramAccount[],
) {
  if (account.instagramUserId) return account.instagramUserId

  const username = normalizeMetaName(account.instagramUsername)
  if (username) {
    const match = connectedAccounts.find((item) => normalizeMetaName(item.instagramUsername) === username)
    if (match) return match.instagramUserId
  }

  const pageName = normalizeMetaName(account.facebookPageName)
  if (pageName) {
    const match = connectedAccounts.find((item) => normalizeMetaName(item.pageName) === pageName)
    if (match) return match.instagramUserId
  }

  throw new Error(`${account.account}のInstagram IDが見つかりませんでした。Meta側でページとInstagramの連携を確認してください。`)
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

  const item = metricData as {
    total_value?: {
      value?: unknown
      breakdowns?: Array<{ results?: Array<{ value?: unknown }> }>
    }
    values?: Array<{ value?: unknown }>
  }

  // If breakdown results exist, sum them across all content types (feed, story, reel, ad)
  const breakdownResults = item.total_value?.breakdowns?.[0]?.results
  if (Array.isArray(breakdownResults) && breakdownResults.length > 0) {
    return breakdownResults.reduce(
      (sum, r) => sum + (numberOrNull((r as { value?: unknown }).value) || 0),
      0,
    )
  }

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
    reach: ['reach'],
    urlClicks: ['website_clicks', 'profile_links_taps'],
    profileViews: ['profile_views'],
  }

  const results: Record<InsightMetricKey, number | null> = {
    reach: null,
    urlClicks: null,
    profileViews: null,
  }

  const MAX_WINDOW = 30 * 24 * 60 * 60 // 30 days in seconds

  for (const metricKey of Object.keys(metricMap) as InsightMetricKey[]) {
    for (const metricName of metricMap[metricKey]) {
      let total = 0
      let cursor = since
      let success = false

      while (cursor < until) {
        const chunkUntil = Math.min(cursor + MAX_WINDOW, until)
        try {
          const data = await fetchGraphJson<{ data?: unknown[] }>(
            `/${instagramUserId}/insights?metric=${metricName}&period=day&metric_type=total_value&since=${cursor}&until=${chunkUntil}`,
            accessToken,
          )
          const val = sumInsightValues(data.data?.[0])
          if (val !== null) {
            total += val
            success = true
          }
        } catch {
          break
        }
        cursor = chunkUntil
      }

      if (success) {
        results[metricKey] = total
        break
      }

      try {
        const data = await fetchGraphJson<{ data?: unknown[] }>(
          `/${instagramUserId}/insights?metric=${metricName}&period=day&metric_type=total_value`,
          accessToken,
        )
        results[metricKey] = sumInsightValues(data.data?.[0])
        break
      } catch {
        // 次の指標名候補へ
      }
    }
  }

  return results
}

function parseStoredNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = String(value).replace(/,/g, '').trim()
  const num = Number(cleaned)
  return Number.isFinite(num) && cleaned !== '' ? num : null
}

function getPrevYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function getCurrentYearMonthJst(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date())

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
  }
}

async function fetchPreviousFollowers(
  supabase: { from: (table: string) => any },
  accountNames: string[],
  prevYear: number,
  prevMonth: number,
): Promise<Record<string, number | null>> {
  try {
    const { data } = await supabase
      .from('analysis_insta_metrics')
      .select('account, value')
      .eq('metric', 'フォロワー数')
      .eq('year', prevYear)
      .eq('month', prevMonth)
      .in('account', accountNames)
    const result: Record<string, number | null> = {}
    const rows = (data ?? []) as Array<{ account: string; value: string | null }>
    for (const name of accountNames) {
      const row = rows.find((r) => r.account === name)
      result[name] = parseStoredNumber(row?.value ?? null)
    }
    return result
  } catch {
    return Object.fromEntries(accountNames.map((name) => [name, null]))
  }
}

async function fetchInstagramMediaStats(
  instagramUserId: string,
  accessToken: string,
  since: number,
  until: number,
): Promise<{ count: number | null; viewsSum: number | null }> {
  try {
    const data = await fetchGraphJson<{ data?: { id: string }[] }>(
      `/${instagramUserId}/media?fields=id&since=${since}&until=${until}&limit=100`,
      accessToken,
    )
    if (!Array.isArray(data.data)) return { count: null, viewsSum: null }

    const mediaItems = data.data
    const count = mediaItems.length

    let viewsSum = 0

    for (const item of mediaItems) {
      try {
        const insightData = await fetchGraphJson<{ data?: unknown[] }>(
          `/${item.id}/insights?metric=views`,
          accessToken,
        )
        const val = sumInsightValues(insightData.data?.[0])
        if (val !== null) viewsSum += val
      } catch {
        // skip this media item if insights fail
      }
    }

    return { count, viewsSum }
  } catch {
    return { count: null, viewsSum: null }
  }
}

async function fetchViewsForPeriod(
  instagramUserId: string,
  accessToken: string,
  since: number,
  until: number,
): Promise<number> {
  const MAX_WINDOW = 30 * 24 * 60 * 60 // 30 days in seconds
  let total = 0
  let cursor = since

  while (cursor < until) {
    const chunkUntil = Math.min(cursor + MAX_WINDOW, until)
    try {
      const data = await fetchGraphJson<{ data?: unknown[] }>(
        `/${instagramUserId}/insights?metric=views&period=day&metric_type=total_value&since=${cursor}&until=${chunkUntil}`,
        accessToken,
      )
      const val = sumInsightValues(data.data?.[0])
      if (val !== null) total += val
    } catch {
      // skip chunk on error
    }
    cursor = chunkUntil
  }

  return total
}

async function fetchInstagramInsights(
  account: InstagramAccountConfig & { instagramUserId: string },
  accessToken: string,
  year: number,
  month: number,
): Promise<InsightResult> {
  const { since, until } = getMonthRange(year, month)
  const [accountFields, insights, mediaStats] = await Promise.all([
    fetchInstagramAccountFields(account.instagramUserId, accessToken),
    fetchInstagramInsightMetrics(account.instagramUserId, accessToken, since, until),
    fetchInstagramMediaStats(account.instagramUserId, accessToken, since, until),
  ])

  const accountViewsTotal = await fetchViewsForPeriod(account.instagramUserId, accessToken, since, until)

  return {
    username: accountFields.username,
    followers: numberOrNull(accountFields.followers_count),
    mediaCount: numberOrNull(accountFields.media_count),
    mediaCountInPeriod: mediaStats.count,
    views: accountViewsTotal,
    reach: insights.reach,
    urlClicks: insights.urlClicks,
    profileViews: insights.profileViews,
  }
}

function buildInstagramRows(
  year: number,
  month: number,
  accountName: string,
  insights: InsightResult,
  previousFollowers: number | null,
  includeFollowerMetrics: boolean,
) {
  const { followers, mediaCountInPeriod, views, reach, urlClicks, profileViews } = insights

  const rows: Array<{ metric: string; value: number | string | null }> = [
    { metric: '視聴回数(閲覧数)', value: views },
    { metric: '視聴者リーチ', value: reach },
    { metric: 'URLクリック', value: urlClicks },
    { metric: 'プロフ閲覧', value: profileViews },
  ]

  if (includeFollowerMetrics) {
    rows.unshift({ metric: 'フォロワー数', value: followers })
  }

  if (mediaCountInPeriod !== null) {
    rows.push({ metric: '投稿数', value: mediaCountInPeriod })
  }

  if (includeFollowerMetrics && followers !== null && previousFollowers !== null) {
    rows.push({ metric: 'フォロワー増加数', value: followers - previousFollowers })
  }

  if (
    includeFollowerMetrics &&
    followers !== null &&
    previousFollowers !== null &&
    mediaCountInPeriod !== null &&
    mediaCountInPeriod > 0
  ) {
    const growth = followers - previousFollowers
    rows.push({ metric: 'フォロワー/投稿', value: Math.round((growth / mediaCountInPeriod) * 10) / 10 })
  }

  if (urlClicks !== null && profileViews !== null && profileViews > 0) {
    rows.push({ metric: 'URLクリック率', value: `${Math.round((urlClicks / profileViews) * 100)}%` })
  }

  return rows
    .filter((row) => row.value !== null && row.value !== '')
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
      return res.status(200).json({ ok: false, message: 'InstagramアカウントIDが設定されていません。' })
    }

    const { year: prevYear, month: prevMonth } = getPrevYearMonth(year, month)
    const currentYearMonth = getCurrentYearMonthJst()
    const includeFollowerMetrics = year === currentYearMonth.year && month === currentYearMonth.month
    let previousFollowersMap: Record<string, number | null> = {}
    try {
      const supabaseForRead = getSupabaseClient()
      previousFollowersMap = await fetchPreviousFollowers(
        supabaseForRead,
        accounts.map((a) => a.account),
        prevYear,
        prevMonth,
      )
    } catch {
      // computed metrics will be skipped
    }

    const summaries: object[] = []
    const failures: object[] = []
    const rowsToSave: object[] = []
    const connectedAccounts = accounts.some((account) => !account.instagramUserId)
      ? await fetchConnectedInstagramAccounts(accessToken)
      : []

    for (const account of accounts) {
      try {
        const instagramUserId = resolveInstagramUserId(account, connectedAccounts)
        const insights = await fetchInstagramInsights({ ...account, instagramUserId }, accessToken, year, month)
        const previousFollowers = previousFollowersMap[account.account] ?? null
        summaries.push({
          key: account.key,
          account: account.account,
          username: insights.username,
          followers: insights.followers,
          mediaCountInPeriod: insights.mediaCountInPeriod,
          views: insights.views,
          reach: insights.reach,
          urlClicks: insights.urlClicks,
          profileViews: insights.profileViews,
          previousFollowers,
          followerGrowth: insights.followers !== null && previousFollowers !== null
            ? insights.followers - previousFollowers
            : null,
        })
        rowsToSave.push(...buildInstagramRows(
          year,
          month,
          account.account,
          insights,
          previousFollowers,
          includeFollowerMetrics,
        ))
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
        ? `一部のInstagramは取得できませんでした: ${failures.map((f) => (f as { key: string; message: string }).key).join(', ')}`
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
