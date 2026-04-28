import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID
const APP_URL = 'https://trgirai-kanri.vercel.app/'

type MemberInfo = { name: string; slack_user_id: string }

function parseDate(value?: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function diffDays(target: Date, base: Date) {
  const oneDay = 24 * 60 * 60 * 1000
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()
  return Math.round((a - b) / oneDay)
}

function resolveMention(name: string, members: MemberInfo[]) {
  const member = members.find((item) => item.name === name)
  return member?.slack_user_id ? `<@${member.slack_user_id}>` : name
}

function buildMentions(assignees: string[], creator: string | undefined, members: MemberInfo[]) {
  const names = Array.from(new Set([...(assignees || []), creator || ''].filter(Boolean)))
  return names.map((name) => resolveMention(name, members)).join(' ')
}

function buildReminderLabel(task: { work_date?: string; due_date?: string }, today: Date) {
  const workDate = parseDate(task.work_date)
  if (workDate && diffDays(workDate, today) === 0) {
    return ':hammer_and_wrench: 今日は作業日です'
  }

  const dueDate = parseDate(task.due_date)
  if (!dueDate) return null

  const daysUntilDue = diffDays(dueDate, today)
  if (daysUntilDue === 3) return ':calendar: 期日の3日前です'
  if (daysUntilDue === 0) return ':bell: 期日当日です'
  if (daysUntilDue === -3) return ':warning: 期日から3日過ぎています'
  if (daysUntilDue < -3 && Math.abs(daysUntilDue) % 3 === 0) {
    return `:rotating_light: 期日から${Math.abs(daysUntilDue)}日過ぎています`
  }

  return null
}

async function postToSlack(text: string) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) return
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: SLACK_CHANNEL_ID, text }),
  })
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const today = new Date()

  const { data: tasks } = await supabaseAdmin
    .from('task_items')
    .select('name, priority, due_date, work_date, assignees, creator, status')
    .neq('status', '完了')

  const { data: membersList } = await supabaseAdmin
    .from('members')
    .select('name, slack_user_id')

  if (!tasks || !membersList) return res.status(200).json({ ok: true, sent: 0 })

  let sent = 0

  for (const task of tasks) {
    const reminderLabel = buildReminderLabel(task, today)
    if (!reminderLabel) continue

    const mentions = buildMentions(task.assignees || [], task.creator, membersList as MemberInfo[])
    const text = `${mentions}
${reminderLabel}

*タスク名*: ${task.name}
*作業日*: ${task.work_date || '未設定'}
*期日*: ${task.due_date || '未設定'}
*優先度*: ${task.priority || '中'}

${APP_URL}`

    await postToSlack(text)
    sent += 1
  }

  res.status(200).json({ ok: true, sent })
}
