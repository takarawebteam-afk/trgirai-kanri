import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// --- Task notification ---
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID
const APP_URL = 'https://trgirai-kanri.vercel.app/'

// --- Today-memo notification ---
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

function getMemoSlackBotTokens() {
  return Array.from(new Set([
    readLocalSlackBotToken(),
    process.env.LOCAL_SLACK_BOT_TOKEN,
    process.env.SLACK_BOT_TOKEN,
  ].filter((token): token is string => Boolean(token))))
}

// --- Task notification helpers ---
type MemberInfo = { name: string; slack_user_id: string }
type NotifyType = 'new' | 'updated' | 'deleted' | 'completed' | 'remind'

function resolveSender(creator: string | undefined, assignees: string[], members: MemberInfo[]) {
  const senderName = creator || assignees?.[0] || ''
  const sender = members.find((item) => item.name === senderName)
  return {
    name: senderName || 'タスク管理',
    slackUserId: sender?.slack_user_id || '',
  }
}

function resolveMention(name: string, members: MemberInfo[]) {
  const member = members.find((item) => item.name === name)
  return member?.slack_user_id ? `<@${member.slack_user_id}>` : name
}

function buildMentions(assignees: string[], creator: string | undefined, members: MemberInfo[]) {
  const names = Array.from(new Set([...(assignees || []), creator || ''].filter(Boolean)))
  return names.map((name) => resolveMention(name, members)).join(' ')
}

function buildTaskSummary(taskName: string, dueDate?: string, workDate?: string, priority?: string) {
  return [
    `*タスク名*: ${taskName}`,
    `*作業日*: ${workDate || '未設定'}`,
    `*期限*: ${dueDate || '未設定'}`,
    `*優先度*: ${priority || '中'}`,
  ].join('\n')
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

async function postTaskToSlack(text: string, sender: { name: string; slackUserId?: string }) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    return { ok: false, error: 'slack_not_configured' }
  }
  const iconUrl = await getSlackUserIcon(SLACK_BOT_TOKEN, sender.slackUserId || '')
  const payload = {
    channel: SLACK_CHANNEL_ID,
    text,
    username: sender.name,
    ...(iconUrl ? { icon_url: iconUrl } : {}),
  }
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || !result.ok) {
    console.error('Slack notification failed:', result.error || response.statusText)
    return { ok: false, error: result.error || response.statusText }
  }
  return { ok: true }
}

// --- Today-memo notification helpers ---
async function resolveMemoSlackUserId(memberName: string) {
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

async function postMemoToSlack(channel: string, text: string, memberName: string) {
  const tokens = getMemoSlackBotTokens()
  if (tokens.length === 0) return { ok: false, error: 'slack_not_configured' }

  let lastError = 'Slack送信に失敗しました'
  const slackUserId = await resolveMemoSlackUserId(memberName)
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
    if (response.ok && result.ok) return { ok: true }
    lastError = result.error || response.statusText
    if (lastError !== 'invalid_auth') {
      console.error('Today memo Slack notification failed:', lastError)
      return { ok: false, error: lastError }
    }
  }
  console.error('Today memo Slack notification failed:', lastError)
  return { ok: false, error: lastError }
}

// --- Handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const body = req.body as Record<string, unknown>

  // Today-memo route: body has memberName + memo
  if (typeof body.memberName === 'string' && typeof body.memo === 'string') {
    const memberName = body.memberName
    const memo = body.memo.trim()
    const channel = MEMBER_CHANNELS[memberName]

    if (!memberName || !channel) {
      return res.status(400).json({ ok: false, error: 'unknown_member' })
    }
    if (!memo) {
      return res.status(400).json({ ok: false, error: 'empty_memo' })
    }

    const result = await postMemoToSlack(channel, memo, memberName)
    if (!result.ok) return res.status(502).json(result)
    return res.status(200).json({ ok: true })
  }

  // Task notification route
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    return res.status(200).json({ ok: false, message: 'Slack not configured' })
  }

  const {
    type,
    taskName,
    dueDate,
    workDate,
    priority,
    assignees,
    creator,
    members,
    reminderLabel,
  } = body as {
    type: NotifyType
    taskName: string
    dueDate?: string
    workDate?: string
    priority?: string
    assignees: string[]
    creator?: string
    members: MemberInfo[]
    reminderLabel?: string
  }

  const mentions = buildMentions(assignees, creator, members)
  const summary = buildTaskSummary(taskName, dueDate, workDate, priority)
  const sender = resolveSender(creator, assignees, members)

  let title = ''
  switch (type) {
    case 'new': title = ':memo: 新しいタスクが登録されました'; break
    case 'updated': title = ':pencil2: タスクの内容が変更されました'; break
    case 'deleted': title = ':wastebasket: タスクが削除されました'; break
    case 'completed': title = ':white_check_mark: タスクが完了になりました'; break
    case 'remind': title = reminderLabel || ':bell: タスクのお知らせです'; break
  }

  const text = `${mentions}\n${title}\n\n${summary}\n\n${APP_URL}`
  const result = await postTaskToSlack(text, sender)
  if (!result.ok) return res.status(502).json(result)
  return res.status(200).json({ ok: true })
}
