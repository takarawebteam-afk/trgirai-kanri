import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const GRAPH_API_VERSION = 'v22.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

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
  { key: 'nishinomiyakita', account: '西北', instagramUserId: '17841405801166646' },
  { key: 'nishinomiya_karilun', account: '西宮市', instagramUserId: '17841469828438834' },
  { key: 'apaman_yao', account: '八尾', instagramUserId: '17841470372894673' },
  { key: 'keihan_karilun', account: '京北', instagramUserId: '17841408003177321' },
]

const METRIC_LABELS = {
  followers: 'フォロワー数',
  views: '視聴回数(閲覧数)',
  reach: '視聴者リーチ',
  urlClicks: 'URLクリック',
} as const

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error('Supabaseの接続設定がありません。')
  return createClient(url, key)
}

function parseAccountsConfig() {
  const rawValue = process.env.INSTAGRAM_ACCOUNT_IDS
  if (!rawValue) return DEFAULT_INSTAGRAM_ACCOUNTS.filter((account) => account.instagramUserId)

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

async function fetchAccountFields(instagramUserId: string, accessToken: string) {
  return fetchGraphJson<{ username?: string, followers_count?: number, media_count?: number }>(
    `/${instagramUserId}?fields=username,followers_count,media_count`,
    accessToken,
  )
}

async function fetchInsightMetrics(instagramUserId: string, accessToken: string, since: number, until: number) {
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
      try {
        const data = await fetchGraphJson<{ data?: unknown[] }>(
          `/${instagramUserId}/insights?metric=${metricName}&period=day&metric_type=total_value&since=${since}&until=${until}`,
          accessToken,
        )
        results[metricKey] = sumInsightValues(data.data?.[0])
        break
      } catch {
        // Meta側の指標名は変わることがあるので、次の候補名で試します。
      }
    }
  }

  return results
}

async function fetchInstagramInsights(account: InstagramAccountConfig, accessToken: string, year: number, month: number): Promise<InsightResult> {
  const { since, until } = getMonthRange(year, month)
  const accountFields = await fetchAccountFields(account.instagramUserId, accessToken)
  const insights = await fetchInsightMetrics(account.instagramUserId, accessToken, since, until)

  return {
    username: accountFields.username,
    followers: numberOrNull(accountFields.followers_count),
    mediaCount: numberOrNull(accountFields.media_count),
    ...insights,
  }
}

function buildRows(year: number, month: number, accountName: string, insights: InsightResult) {
  const rows = [
    { metric: METRIC_LABELS.followers, value: insights.followers },
    { metric: METRIC_LABELS.views, value: insights.views },
    { metric: METRIC_LABELS.reach, value: insights.reach },
    { metric: METRIC_LABELS.urlClicks, value: insights.urlClicks },
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POSTで開いてください。' })
  }

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
        message: 'InstagramアカウントIDが設定されていません。INSTAGRAM_ACCOUNT_IDSをVercelに入れてください。',
      })
    }

    const summaries = []
    const rowsToSave = []

    for (const account of accounts) {
      const insights = await fetchInstagramInsights(account, accessToken, year, month)
      summaries.push({ key: account.key, account: account.account, username: insights.username, ...insights })
      rowsToSave.push(...buildRows(year, month, account.account, insights))
    }

    if (!dryRun && rowsToSave.length > 0) {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('analysis_insta_metrics')
        .upsert(rowsToSave, { onConflict: 'year,month,account,metric' })

      if (error) throw new Error(error.message)
    }

    return res.status(200).json({
      ok: true,
      year,
      month,
      saved: dryRun ? 0 : rowsToSave.length,
      summaries,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagramの自動取得に失敗しました。'
    return res.status(200).json({ ok: false, message })
  }
}
