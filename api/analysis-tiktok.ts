import type { VercelRequest, VercelResponse } from '@vercel/node'

const SPREADSHEET_ID = '1vgiE6-onVtpQP2mI44dj768FCi2Y9a0vSonB6tRBDCk'
const SHEET_NAME = 'TikTok｜営業店'
const SHEET_RANGE = 'A1:AK49'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'GETで開いてください。' })
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.VITE_GOOGLE_SHEETS_API_KEY
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      message: 'Googleスプレッドシートを読むためのキーが設定されていません。',
      columns: [],
      groups: [],
    })
  }

  const range = encodeURIComponent(`'${SHEET_NAME}'!${SHEET_RANGE}`)
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
      sheetName: SHEET_NAME,
      fetchedAt: new Date().toISOString(),
      ...parsed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'スプレッドシートを読めませんでした。'
    return res.status(200).json({ ok: false, message, columns: [], groups: [] })
  }
}
