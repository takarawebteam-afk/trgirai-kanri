import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

function readLocalSlackBotToken() {
  try {
    const envText = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const line = envText.split(/\r?\n/).find((item) => item.startsWith('SLACK_BOT_TOKEN='))
    if (!line) return ''
    return line.replace(/^SLACK_BOT_TOKEN=/, '').trim().replace(/^"|"$/g, '')
  } catch {
    return ''
  }
}

function getSlackBotTokens() {
  return Array.from(new Set([
    readLocalSlackBotToken(),
    process.env.LOCAL_SLACK_BOT_TOKEN,
    process.env.SLACK_BOT_TOKEN,
  ].filter((token): token is string => Boolean(token))))
}

const MEMBER_CHANNELS: Record<string, string> = {
  泉: 'C0A7FB9UPQA',
  坂本: 'C0A7FB9UPQA',
  新居: 'C0A7FB9UPQA',
  吉田: 'C0AGJQHV57V',
}

const MEMBER_SLACK_USER_IDS: Record<string, string> = {
  '吉田': 'U0A7TP5CY4V',
  '坂本': 'U0A4GK4K325',
  '新居': 'U09KSMASB7D',
  '泉': 'U0A3X9X4999',
}

async function resolveSlackUserId(memberName: string) {
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from('members')
      .select('slack_user_id')
      .eq('name', memberName)
      .maybeSingle()

    if (data?.slack_user_id) return String(data.slack_user_id)
  }

  return MEMBER_SLACK_USER_IDS[memberName] || ''
}

async function getSlackUserIcon(token: string, slackUserId: string) {
  if (!slackUserId) return ''

  try {
    const params = new URLSearchParams({ user: slackUserId })
    const response = await fetch(`https://slack.com/api/users.info?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await response.json() as {
      ok?: boolean
      user?: { profile?: { image_72?: string; image_48?: string } }
    }
    if (!response.ok || !result.ok) return ''
    return result.user?.profile?.image_72 || result.user?.profile?.image_48 || ''
  } catch {
    return ''
  }
}

async function postToSlack(channel: string, text: string, memberName: string) {
  const tokens = getSlackBotTokens()
  if (tokens.length === 0) {
    return { ok: false, error: 'slack_not_configured' }
  }

  let lastError = 'Slack送信に失敗しました'
  const slackUserId = await resolveSlackUserId(memberName)
  for (const token of tokens) {
    const iconUrl = await getSlackUserIcon(token, slackUserId)
    const payload = {
      channel,
      text,
      username: memberName,
      ...(iconUrl ? { icon_url: iconUrl } : {}),
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json() as { ok?: boolean; error?: string }

    if (response.ok && result.ok) {
      return { ok: true }
    }

    lastError = result.error || response.statusText
    if (lastError !== 'invalid_auth') {
      console.error('Today memo Slack notification failed:', lastError)
      return { ok: false, error: lastError }
    }
  }

  console.error('Today memo Slack notification failed:', lastError)
  return { ok: false, error: lastError }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const secret = process.env.NOTIFY_SECRET
  const host = req.headers.host || ''
  const isLocalRequest = host.startsWith('localhost:') || host.startsWith('127.0.0.1:')
  if (secret && req.headers['x-notify-secret'] !== secret && !isLocalRequest) {
    return res.status(401).end()
  }

  const { memberName, memo } = req.body as {
    memberName?: string
    memo?: string
  }

  const channel = memberName ? MEMBER_CHANNELS[memberName] : undefined
  const text = typeof memo === 'string' ? memo.trim() : ''

  if (!memberName || !channel) {
    return res.status(400).json({ ok: false, error: 'unknown_member' })
  }
  if (!text) {
    return res.status(400).json({ ok: false, error: 'empty_memo' })
  }

  const result = await postToSlack(channel, text, memberName)
  if (!result.ok) {
    return res.status(502).json(result)
  }

  res.status(200).json({ ok: true })
}
