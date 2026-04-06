import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID

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
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const todayStr = fmt(now)
  const plus3 = fmt(new Date(now.getTime() + 3 * 86400000))
  const minus3 = fmt(new Date(now.getTime() - 3 * 86400000))

  const { data: tasks } = await supabaseAdmin
    .from('task_items')
    .select('*')
    .neq('status', '完了')

  const { data: membersList } = await supabaseAdmin.from('members').select('*')

  if (!tasks || !membersList) return res.status(200).json({ ok: true, sent: 0 })

  let sent = 0
  for (const task of tasks) {
    if (!task.due_date) continue

    const mentions = (task.assignees || [])
      .map((name: string) => {
        const m = membersList.find((x: { name: string; slack_user_id: string }) => x.name === name)
        return m?.slack_user_id ? `<@${m.slack_user_id}>` : name
      })
      .join(' ')

    let label = ''
    if (task.due_date === plus3) label = ':calendar: 期日3日前'
    else if (task.due_date === todayStr) label = ':bell: 期日当日'
    else if (task.due_date === minus3) label = ':warning: 期日3日超過（未完了）'

    if (label) {
      const text = `${mentions}\n${label}\n\n*タスク名*: ${task.name}\n*期日*: ${task.due_date}\n*優先度*: ${task.priority}\n\nhttps://trgirai-kanri.vercel.app/`
      await postToSlack(text)
      sent++
    }
  }

  res.status(200).json({ ok: true, sent })
}
