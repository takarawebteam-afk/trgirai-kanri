import type { VercelRequest, VercelResponse } from '@vercel/node'

const SPREADSHEET_ID = '1Ddk6QM4-S4MPcc4kEcfkWVM-iWcKHhrQUExltO1IPZ8'
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.VITE_GOOGLE_SHEETS_API_KEY

function normalizePropertyNumber(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ area: '\u4e0d\u660e', reason: 'method_not_allowed' })
  }

  const sheetName = String(req.query.sheetName ?? '').trim()
  const propertyNumber = normalizePropertyNumber(req.query.propertyNumber)

  if (!sheetName || !propertyNumber) {
    return res.status(400).json({ area: '\u4e0d\u660e', reason: 'missing_params' })
  }

  if (!API_KEY) {
    return res.status(200).json({ area: '\u4e0d\u660e', reason: 'missing_api_key' })
  }

  try {
    const range = encodeURIComponent(`${sheetName}!A:F`)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?key=${API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      return res.status(200).json({ area: '\u4e0d\u660e', reason: 'google_error' })
    }

    const data = await response.json() as { values?: string[][] }
    const rows = data.values || []

    for (const row of rows) {
      const sheetPropertyNumber = normalizePropertyNumber(row[4])
      if (sheetPropertyNumber === propertyNumber) {
        return res.status(200).json({ area: String(row[1] || '').trim() || '\u4e0d\u660e', reason: 'matched' })
      }
    }

    return res.status(200).json({ area: '\u4e0d\u660e', reason: 'not_found' })
  } catch {
    return res.status(200).json({ area: '\u4e0d\u660e', reason: 'request_failed' })
  }
}
