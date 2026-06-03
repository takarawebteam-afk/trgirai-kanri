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

const THREADS_API_BASE = 'https://graph.threads.net/v1.0'

type ThreadsAccountConfig = {
  key: string
  account: string
  threadsUserId?: string
  accessToken?: string
}

const DEFAULT_THREADS_ACCOUNTS: ThreadsAccountConfig[] = [
  { key: 'karilun_com', account: 'Karilun' },
  { key: 'ap_nagase', account: '長瀬' },
  { key: 'nishinomiyakita', account: '西北' },
  { key: 'nishinomiya_karilun', account: '西宮市' },
  { key: 'apaman_yao', account: '八尾' },
]

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

async function fetchThreadsJson<T>(url: string, accessToken: string) {
  const separator = url.includes('?') ? '&' : '?'
  const response = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`)
  const data = await response.json() as T & { error?: { message?: string } }
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Threadsの数字を取得できませんでした。')
  }
  return data
}

function parseThreadsAccountsConfig(): ThreadsAccountConfig[] {
  const rawValue = process.env.THREADS_ACCOUNT_IDS
  if (!rawValue) return DEFAULT_THREADS_ACCOUNTS
  try {
    const parsed = JSON.parse(rawValue) as ThreadsAccountConfig[]
    return parsed.filter((a) => a.account && a.threadsUserId)
  } catch {
    return DEFAULT_THREADS_ACCOUNTS
  }
}

async function fetchPreviousThreadsFollowers(
  supabase: { from: (table: string) => any },
  accountNames: string[],
  prevYear: number,
  prevMonth: number,
): Promise<Record<string, number | null>> {
  try {
    const { data } = await supabase
      .from('analysis_threads_metrics')
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
    return {}
  }
}

async function fetchThreadsAccountFields(threadsUserId: string, accessToken: string) {
  const until = Math.floor(Date.now() / 1000)
  const since = until - 2 * 24 * 60 * 60
  try {
    const data = await fetchThreadsJson<{ data?: unknown[] }>(
      `${THREADS_API_BASE}/${threadsUserId}/threads_insights?metric=followers_count&period=day&since=${since}&until=${until}`,
      accessToken,
    )
    const item = data.data?.[0] as { total_value?: { value?: number } } | undefined
    return { followers_count: item?.total_value?.value }
  } catch {
    return { followers_count: undefined }
  }
}

async function fetchThreadsInsightMetrics(
  threadsUserId: string,
  accessToken: string,
  since: number,
  until: number,
): Promise<{ views: number | null; likes: number | null; replies: number | null; reposts: number | null }> {
  const results = { views: null as number | null, likes: null as number | null, replies: null as number | null, reposts: null as number | null }
  const metrics = ['views', 'likes', 'replies', 'reposts'] as const
  const chunkSeconds = 30 * 24 * 60 * 60

  for (const metricName of metrics) {
    let total = 0
    let cursor = since
    while (cursor < until) {
      const chunkUntil = Math.min(cursor + chunkSeconds, until)
      try {
        const data = await fetchThreadsJson<{ data?: unknown[] }>(
          `${THREADS_API_BASE}/${threadsUserId}/threads_insights?metric=${metricName}&period=day&metric_type=total_value&since=${cursor}&until=${chunkUntil}`,
          accessToken,
        )
        const val = sumInsightValues(data.data?.[0])
        total += val ?? 0
      } catch {
        // chunk failed, continue
      }
      cursor = chunkUntil
    }
    results[metricName] = total
  }

  return results
}

async function fetchThreadsPostCount(
  threadsUserId: string,
  accessToken: string,
  since: number,
  until: number,
): Promise<number | null> {
  try {
    const cappedUntil = Math.min(until, Math.floor(Date.now() / 1000))
    const data = await fetchThreadsJson<{ data?: unknown[] }>(
      `${THREADS_API_BASE}/${threadsUserId}/threads?fields=id&since=${since}&until=${cappedUntil}&limit=100`,
      accessToken,
    )
    return Array.isArray(data.data) ? data.data.length : null
  } catch {
    return null
  }
}

function buildThreadsRows(
  year: number,
  month: number,
  accountName: string,
  followers: number | null,
  previousFollowers: number | null,
  postCount: number | null,
  metrics: { views: number | null; likes: number | null; replies: number | null; reposts: number | null },
  includeFollowerMetrics: boolean,
) {
  const rows: Array<{ metric: string; value: number | string | null }> = []

  if (includeFollowerMetrics && followers !== null) {
    rows.push({ metric: 'フォロワー数', value: followers })
  }

  if (includeFollowerMetrics && followers !== null && previousFollowers !== null) {
    rows.push({ metric: 'フォロワー増加数', value: followers - previousFollowers })
  }

  if (postCount !== null) {
    rows.push({ metric: '投稿数', value: postCount })
  }

  if (
    includeFollowerMetrics &&
    followers !== null &&
    previousFollowers !== null &&
    postCount !== null &&
    postCount > 0
  ) {
    const growth = followers - previousFollowers
    rows.push({ metric: 'フォロワー/投稿', value: Math.round((growth / postCount) * 10) / 10 })
  }

  if (metrics.views !== null) rows.push({ metric: '視聴回数(閲覧数)', value: metrics.views })
  if (metrics.likes !== null) rows.push({ metric: 'いいね数', value: metrics.likes })
  if (metrics.reposts !== null) rows.push({ metric: 'リポスト数', value: metrics.reposts })
  if (metrics.replies !== null) rows.push({ metric: 'コメント数', value: metrics.replies })

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

async function syncThreadsInsights(req: VercelRequest, res: VercelResponse) {
  const accessToken = process.env.THREADS_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(200).json({
      ok: false,
      message: 'ThreadsのアクセストークンがまだVercelに設定されていません。THREADS_ACCESS_TOKENを設定してください。',
    })
  }

  const now = new Date()
  const year = Number(req.body?.year || now.getFullYear())
  const month = Number(req.body?.month || now.getMonth() + 1)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ ok: false, message: '年月が正しくありません。' })
  }

  try {
    const accounts = parseThreadsAccountsConfig().filter((a) => a.threadsUserId)
    if (accounts.length === 0) {
      return res.status(200).json({
        ok: false,
        message: 'ThreadsアカウントIDがまだ設定されていません。THREADS_ACCOUNT_IDSをVercelに設定してください。',
      })
    }

    const { year: prevYear, month: prevMonth } = getPrevYearMonth(year, month)
    const currentYearMonth = getCurrentYearMonthJst()
    const includeFollowerMetrics = year === currentYearMonth.year && month === currentYearMonth.month
    const { since, until } = getMonthRange(year, month)

    let previousFollowersMap: Record<string, number | null> = {}
    try {
      const supabaseForRead = getSupabaseClient()
      previousFollowersMap = await fetchPreviousThreadsFollowers(
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

    for (const account of accounts) {
      const { threadsUserId } = account as ThreadsAccountConfig & { threadsUserId: string }
      const accountToken = (account as ThreadsAccountConfig).accessToken || accessToken
      try {
        const [accountFields, insightMetrics, postCount] = await Promise.all([
          fetchThreadsAccountFields(threadsUserId, accountToken),
          fetchThreadsInsightMetrics(threadsUserId, accountToken, since, until),
          fetchThreadsPostCount(threadsUserId, accountToken, since, until),
        ])
        const followers = numberOrNull(accountFields.followers_count)
        const previousFollowers = previousFollowersMap[account.account] ?? null

        summaries.push({
          key: account.key,
          account: account.account,
          followers,
          postCount,
          views: insightMetrics.views,
          likes: insightMetrics.likes,
          replies: insightMetrics.replies,
          reposts: insightMetrics.reposts,
          previousFollowers,
        })

        rowsToSave.push(...buildThreadsRows(
          year, month, account.account,
          followers, previousFollowers, postCount,
          insightMetrics, includeFollowerMetrics,
        ))
      } catch (error) {
        failures.push({
          key: account.key,
          account: account.account,
          message: error instanceof Error ? error.message : '取得できませんでした。',
        })
      }
    }

    if (rowsToSave.length > 0) {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('analysis_threads_metrics')
        .upsert(rowsToSave, { onConflict: 'year,month,account,metric' })
      if (error) throw new Error(error.message)
    }

    return res.status(200).json({
      ok: failures.length < accounts.length,
      year,
      month,
      saved: rowsToSave.length,
      summaries,
      failures,
      message: failures.length > 0
        ? `一部のThreadsは取得できませんでした: ${failures.map((f) => (f as { key: string }).key).join(', ')}`
        : undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Threadsの自動取得に失敗しました。'
    return res.status(200).json({ ok: false, message })
  }
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
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

type YouTubeAccountConfig = {
  key: string
  account: string
  channelId: string
  refreshToken?: string
}

function getYoutubeAccounts(): YouTubeAccountConfig[] {
  const raw = process.env.YOUTUBE_CHANNEL_IDS ?? ''
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const [key, account, channelId, refreshToken] = entry.split(':')
    return { key: key.trim(), account: account.trim(), channelId: channelId.trim(), refreshToken: refreshToken?.trim() }
  })
}

async function getYoutubeAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
    client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
  const json = await res.json() as { access_token?: string; error?: string }
  if (!json.access_token) throw new Error('アクセストークン取得失敗: ' + (json.error ?? 'unknown'))
  return json.access_token
}

async function fetchYoutubeChannelStats(channelId: string, apiKey: string) {
  const url = `${YOUTUBE_API_BASE}/channels?part=statistics&id=${channelId}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`)
  const json = await res.json() as {
    items?: Array<{
      statistics: {
        subscriberCount?: string
        videoCount?: string
        viewCount?: string
        commentCount?: string
      }
    }>
  }
  const stats = json.items?.[0]?.statistics
  if (!stats) throw new Error(`Channel not found: ${channelId}`)
  return stats
}

async function fetchYoutubeMonthlyVideos(channelId: string, apiKey: string, year: number, month: number) {
  const since = new Date(year, month - 1, 1).toISOString()
  const until = new Date(year, month, 1).toISOString()

  let totalLikes = 0
  let totalComments = 0
  let videoCount = 0
  let pageToken: string | undefined

  do {
    const searchUrl = `${YOUTUBE_API_BASE}/search?part=id&channelId=${channelId}&type=video&publishedAfter=${since}&publishedBefore=${until}&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`
    const searchRes = await fetch(searchUrl)
    if (!searchRes.ok) break
    const searchJson = await searchRes.json() as {
      items?: Array<{ id: { videoId: string } }>
      nextPageToken?: string
    }
    const videoIds = (searchJson.items ?? []).map((item) => item.id.videoId).filter(Boolean)
    videoCount += videoIds.length
    pageToken = searchJson.nextPageToken

    if (videoIds.length > 0) {
      const statsUrl = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${videoIds.join(',')}&key=${apiKey}`
      const statsRes = await fetch(statsUrl)
      if (statsRes.ok) {
        const statsJson = await statsRes.json() as {
          items?: Array<{
            statistics: {
              likeCount?: string
              commentCount?: string
            }
          }>
        }
        for (const item of statsJson.items ?? []) {
          totalLikes += parseInt(item.statistics.likeCount ?? '0', 10)
          totalComments += parseInt(item.statistics.commentCount ?? '0', 10)
        }
      }
    }
  } while (pageToken)

  return { videoCount, totalLikes, totalComments }
}

async function fetchYoutubeAnalytics(channelId: string, accessToken: string, year: number, month: number): Promise<{ views: number; avgViewDuration: number }> {
  const since = new Date(year, month - 1, 1).toISOString().split('T')[0]
  const until = new Date(year, month, 0).toISOString().split('T')[0]
  const url = 'https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3D' + channelId + '&startDate=' + since + '&endDate=' + until + '&metrics=views%2CaverageViewDuration'
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } })
  if (!res.ok) throw new Error('YouTube Analytics API error: ' + res.status)
  const json = await res.json() as { rows?: number[][] }
  const row = json.rows?.[0]
  return { views: row?.[0] ?? 0, avgViewDuration: row?.[1] ?? 0 }
}

async function syncYoutubeInsights(req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY ?? ''
    if (!apiKey) {
      return res.status(200).json({ ok: false, message: 'YouTube API キーが設定されていません。YOUTUBE_API_KEY環境変数を設定してください。' })
    }

    const accounts = getYoutubeAccounts()
    if (accounts.length === 0) {
      return res.status(200).json({ ok: false, message: 'YouTubeチャンネルIDが設定されていません。YOUTUBE_CHANNEL_IDS環境変数を設定してください。' })
    }

    const { year, month, skipSubscriberCount } = req.body as { year: number; month: number; skipSubscriberCount?: boolean }

    const results = await Promise.all(accounts.map(async (acc) => {
      try {
        const [stats, monthlyVideos] = await Promise.all([
          fetchYoutubeChannelStats(acc.channelId, apiKey),
          fetchYoutubeMonthlyVideos(acc.channelId, apiKey, year, month),
        ])

        const rows: Array<{ year: number; month: number; account: string; metric: string; value: string; updated_at: string }> = []
        const updatedAt = new Date().toISOString()

        if (!skipSubscriberCount && stats.subscriberCount !== undefined) {
          rows.push({ year, month, account: acc.account, metric: 'チャンネル登録数', value: stats.subscriberCount, updated_at: updatedAt })
        }
        rows.push({ year, month, account: acc.account, metric: '投稿数', value: String(monthlyVideos.videoCount), updated_at: updatedAt })
        rows.push({ year, month, account: acc.account, metric: 'いいね数', value: String(monthlyVideos.totalLikes), updated_at: updatedAt })
        rows.push({ year, month, account: acc.account, metric: 'コメント数', value: String(monthlyVideos.totalComments), updated_at: updatedAt })

        if (acc.refreshToken) {
          try {
            const accessToken = await getYoutubeAccessToken(acc.refreshToken)
            const analytics = await fetchYoutubeAnalytics(acc.channelId, accessToken, year, month)
            rows.push({ year, month, account: acc.account, metric: '再生数', value: String(analytics.views), updated_at: updatedAt })
            rows.push({ year, month, account: acc.account, metric: '平均視聴時間（秒）', value: String(Math.round(analytics.avgViewDuration)), updated_at: updatedAt })
          } catch (error) {
            console.error(error)
          }
        }

        return {
          ok: true as const,
          summary: {
            key: acc.key,
            account: acc.account,
            subscriberCount: stats.subscriberCount ?? null,
            videoCount: monthlyVideos.videoCount,
            totalLikes: monthlyVideos.totalLikes,
            totalComments: monthlyVideos.totalComments,
          },
          rows,
        }
      } catch (error) {
        return {
          ok: false as const,
          failure: {
            key: acc.key,
            account: acc.account,
            message: error instanceof Error ? error.message : '取得できませんでした。',
          },
          rows: [],
        }
      }
    }))

    const summaries = results.flatMap((result) => (result.ok ? [result.summary] : []))
    const failures = results.flatMap((result) => (result.ok ? [] : [result.failure]))
    const rows = results.flatMap((result) => result.rows)

    if (rows.length > 0) {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('analysis_youtube_metrics').upsert(rows, { onConflict: 'year,month,account,metric' })
      if (error) {
        return res.status(500).json({ ok: false, message: `Supabase保存エラー: ${error.message}` })
      }
    }

    return res.status(200).json({
      ok: failures.length < accounts.length,
      saved: rows.length,
      summaries,
      failures,
      message: failures.length > 0
        ? `一部のYouTubeは取得できませんでした: ${failures.map((failure) => failure.key).join(', ')}`
        : `${rows.length}件を保存しました。`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTubeの自動取得に失敗しました。'
    return res.status(500).json({ ok: false, message })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST' && req.query.action === 'sync-instagram-insights') {
    return syncInstagramInsights(req, res)
  }

  if (req.method === 'POST' && req.query.action === 'sync-threads-insights') {
    return syncThreadsInsights(req, res)
  }

  if (req.method === 'POST' && req.query.action === 'sync-youtube-insights') {
    return syncYoutubeInsights(req, res)
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
