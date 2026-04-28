import type { VercelRequest, VercelResponse } from '@vercel/node'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID
const APP_URL = 'https://trgirai-kanri.vercel.app/'

type MemberInfo = { name: string; slack_user_id: string }
type NotifyType = 'new' | 'updated' | 'deleted' | 'completed' | 'remind'

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
    `*期日*: ${dueDate || '未設定'}`,
    `*優先度*: ${priority || '中'}`,
  ].join('\n')
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

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
  } = req.body as {
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

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    return res.status(200).json({ ok: false, message: 'Slack not configured' })
  }

  const mentions = buildMentions(assignees, creator, members)
  const summary = buildTaskSummary(taskName, dueDate, workDate, priority)

  let title = ''
  switch (type) {
    case 'new':
      title = ':memo: 新しいタスクが登録されました'
      break
    case 'updated':
      title = ':pencil2: タスクの内容が変更されました'
      break
    case 'deleted':
      title = ':wastebasket: タスクが削除されました'
      break
    case 'completed':
      title = ':white_check_mark: タスクが完了になりました'
      break
    case 'remind':
      title = reminderLabel || ':bell: タスクのお知らせです'
      break
  }

  const text = `${mentions}\n${title}\n\n${summary}\n\n${APP_URL}`
  await postToSlack(text)
  res.status(200).json({ ok: true })
}
