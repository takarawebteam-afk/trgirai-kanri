import type { VercelRequest, VercelResponse } from '@vercel/node'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID

type MemberInfo = { name: string; slack_user_id: string }

function buildMentions(assignees: string[], members: MemberInfo[]): string {
  return (assignees || [])
    .map((name) => {
      const m = members.find((x) => x.name === name)
      return m?.slack_user_id ? `<@${m.slack_user_id}>` : name
    })
    .join(' ')
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

  const { type, taskName, dueDate, priority, assignees, members } = req.body as {
    type: 'new' | 'completed' | 'remind'
    taskName: string
    dueDate?: string
    priority?: string
    assignees: string[]
    members: MemberInfo[]
    label?: string
  }

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    return res.status(200).json({ ok: false, message: 'Slack not configured' })
  }

  const mentions = buildMentions(assignees, members)

  let text = ''
  if (type === 'new') {
    text = `${mentions}\n新しいタスクが設定されました :memo:\n\n*タスク名*: ${taskName}\n*期日*: ${dueDate || '未設定'}\n*優先度*: ${priority || '中'}\n\nhttps://trgirai-kanri.vercel.app/`
  } else if (type === 'completed') {
    text = `${mentions}\n:white_check_mark: タスクが完了しました\n\n*タスク名*: ${taskName}`
  }

  await postToSlack(text)
  res.status(200).json({ ok: true })
}
