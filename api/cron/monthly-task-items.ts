import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type RecurringDateRule = 'same_day' | 'month_end'

type TaskItemRow = {
  id: string
  created_at?: string
  date: string
  name: string
  priority: string
  due_date: string
  work_date: string
  memo: string
  assignees: string[]
  creator: string
  status: string
  parent_task_id?: string | null
  recurring_type?: string
  recurring_template_id?: string | null
  recurring_parent_template_id?: string | null
  recurring_generation_month?: string | null
  recurring_due_day?: number | null
  recurring_due_rule?: RecurringDateRule | null
  recurring_work_day?: number | null
  recurring_work_rule?: RecurringDateRule | null
  recurring_instance_key?: string | null
  slack_notified?: boolean
  completed_notified?: boolean
}

function getJstDateParts(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.formatToParts(baseDate)
  const year = Number(parts.find((part) => part.type === 'year')?.value || '0')
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0')

  return { year, month }
}

function buildMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function resolveRecurringDate(year: number, month: number, day?: number | null, rule?: RecurringDateRule | null) {
  if (!day || !rule) return ''

  const lastDay = getLastDayOfMonth(year, month)
  const resolvedDay = rule === 'month_end' ? lastDay : Math.min(day, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const { year, month } = getJstDateParts()
  const currentMonth = buildMonthKey(year, month)

  const { data, error } = await supabaseAdmin
    .from('task_items')
    .select('*')
    .eq('recurring_type', 'monthly')
    .not('recurring_template_id', 'is', null)

  if (error) {
    return res.status(500).json({ ok: false, message: error.message })
  }

  const items = (data || []) as TaskItemRow[]
  const itemsByTemplate = items.reduce((acc, item) => {
    const key = item.recurring_template_id as string
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, TaskItemRow[]>)

  const latestItemByTemplate = Object.values(itemsByTemplate).reduce((acc, templateItems) => {
    const latestItem = [...templateItems].sort((a, b) => {
      const monthCompare = (b.recurring_generation_month || '').localeCompare(a.recurring_generation_month || '')
      if (monthCompare !== 0) return monthCompare
      return (b.created_at || '').localeCompare(a.created_at || '')
    })[0]

    if (latestItem?.recurring_template_id) {
      acc[latestItem.recurring_template_id] = latestItem
    }
    return acc
  }, {} as Record<string, TaskItemRow>)

  const currentMonthItemsByTemplate = items.reduce((acc, item) => {
    if (item.recurring_generation_month !== currentMonth || !item.recurring_template_id) return acc
    const key = item.recurring_template_id
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, TaskItemRow[]>)

  const sourceRows = Object.values(latestItemByTemplate)
    .filter((item) => !currentMonthItemsByTemplate[item.recurring_template_id as string])
    .sort((a, b) => {
      if (!!a.parent_task_id === !!b.parent_task_id) return 0
      return a.parent_task_id ? 1 : -1
    })

  const newRowIdBySourceId = new Map<string, string>()
  const rowsToInsert: TaskItemRow[] = []

  sourceRows.forEach((item) => {
    const nextId = crypto.randomUUID()
    let nextParentId = item.parent_task_id || null

    if (item.parent_task_id) {
      const clonedParentId = newRowIdBySourceId.get(item.parent_task_id)
      if (clonedParentId) {
        nextParentId = clonedParentId
      } else if (item.recurring_parent_template_id) {
        const currentParents = currentMonthItemsByTemplate[item.recurring_parent_template_id] || []
        const sourceParent = items.find((candidate) => candidate.id === item.parent_task_id)
        const sourceParentAssignee = sourceParent?.assignees?.[0] || ''
        const matchedParent = currentParents.find((candidate) => (candidate.assignees?.[0] || '') === sourceParentAssignee) || currentParents[0]
        nextParentId = matchedParent?.id || null
      } else {
        nextParentId = null
      }
    }

    rowsToInsert.push({
      ...item,
      id: nextId,
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      due_date: resolveRecurringDate(year, month, item.recurring_due_day, item.recurring_due_rule),
      work_date: resolveRecurringDate(year, month, item.recurring_work_day, item.recurring_work_rule),
      status: '未着手',
      slack_notified: false,
      completed_notified: false,
      parent_task_id: nextParentId,
      recurring_generation_month: currentMonth,
      recurring_instance_key: `${item.recurring_template_id}:${currentMonth}`,
    })

    newRowIdBySourceId.set(item.id, nextId)
  })

  if (rowsToInsert.length === 0) {
    return res.status(200).json({ ok: true, inserted: 0 })
  }

  const { error: upsertError } = await supabaseAdmin
    .from('task_items')
    .upsert(rowsToInsert, { onConflict: 'recurring_instance_key', ignoreDuplicates: true })

  if (upsertError) {
    return res.status(500).json({ ok: false, message: upsertError.message })
  }

  return res.status(200).json({ ok: true, inserted: rowsToInsert.length })
}
