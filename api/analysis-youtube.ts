import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

type YouTubeAccountConfig = {
  key: string
  account: string
  channelId: string
}

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

function getYoutubeAccounts(): YouTubeAccountConfig[] {
  const raw = process.env.YOUTUBE_CHANNEL_IDS ?? ''
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const [key, account, channelId] = entry.split(':')
    return { key: key.trim(), account: account.trim(), channelId: channelId.trim() }
  })
}

async function fetchChannelStats(channelId: string, apiKey: string) {
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

async function fetchMonthlyVideos(channelId: string, apiKey: string, year: number, month: number) {
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

async function syncYoutubeInsights(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.YOUTUBE_API_KEY ?? ''
  if (!apiKey) {
    return res.status(200).json({ ok: false, message: 'YouTube API キーが設定されていません。YOUTUBE_API_KEY環境変数を設定してください。' })
  }

  const accounts = getYoutubeAccounts()
  if (accounts.length === 0) {
    return res.status(200).json({ ok: false, message: 'YouTubeチャンネルIDが設定されていません。YOUTUBE_CHANNEL_IDS環境変数を設定してください。' })
  }

  const { year, month, skipSubscriberCount } = req.body as { year: number; month: number; skipSubscriberCount?: boolean }

  const rows: Array<{ year: number; month: number; account: string; metric: string; value: string; updated_at: string }> = []

  for (const acc of accounts) {
    try {
      const [stats, monthlyVideos] = await Promise.all([
        fetchChannelStats(acc.channelId, apiKey),
        fetchMonthlyVideos(acc.channelId, apiKey, year, month),
      ])

      if (!skipSubscriberCount && stats.subscriberCount !== undefined) {
        rows.push({ year, month, account: acc.account, metric: 'チャンネル登録数', value: stats.subscriberCount, updated_at: new Date().toISOString() })
      }
      rows.push({ year, month, account: acc.account, metric: '投稿数', value: String(monthlyVideos.videoCount), updated_at: new Date().toISOString() })
      rows.push({ year, month, account: acc.account, metric: 'いいね数', value: String(monthlyVideos.totalLikes), updated_at: new Date().toISOString() })
      rows.push({ year, month, account: acc.account, metric: 'コメント数', value: String(monthlyVideos.totalComments), updated_at: new Date().toISOString() })
    } catch (e) {
      console.error(`Error fetching YouTube data for ${acc.account}:`, e)
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('analysis_youtube_metrics').upsert(rows, { onConflict: 'year,month,account,metric' })
    if (error) {
      return res.status(500).json({ ok: false, message: `Supabase保存エラー: ${error.message}` })
    }
  }

  return res.status(200).json({ ok: true, saved: rows.length, message: `${rows.length}件を保存しました。` })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = req.query['action'] as string

  if (req.method === 'POST' && action === 'sync-youtube-insights') {
    return syncYoutubeInsights(req, res)
  }

  return res.status(404).json({ ok: false, message: 'Not found' })
}
