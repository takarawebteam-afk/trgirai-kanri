import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SHEET_ID = '1qXKOHfTUWbYgpxKh67ZW1GspFswJQ4DETQeREaCxH4M'
const SHEET_GID = process.env.YOUTUBE_SHEET_GID || '0'
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`

function loadEnvFile(filePath) {
  const env = {}
  const content = readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalIndex = line.indexOf('=')
    if (equalIndex === -1) continue
    const key = line.slice(0, equalIndex).trim()
    const value = line.slice(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    env[key] = value
  }
  return env
}

function loadEnv() {
  return {
    ...loadEnvFile('.env'),
    ...loadEnvFile('.env.local'),
    ...process.env,
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function normalizeText(value) {
  return String(value || '').trim()
}

function getYoutubePropertyNumberCode(propertyNumber) {
  const match = normalizeText(propertyNumber).match(/^Y(\d{3})$/i)
  return match ? Number(match[1]) : null
}

function getYoutubeYearFromPropertyNumber(propertyNumber) {
  const code = getYoutubePropertyNumberCode(propertyNumber)
  if (code === null) return null
  if (code >= 545) return 2026
  return 2025
}

function normalizeYoutubePostDate(rawDate, propertyNumber) {
  const text = normalizeText(rawDate)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const fullDateMatch = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (fullDateMatch) {
    const [, year, month, day] = fullDateMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const normalized = text
    .replace(/\s+/g, '')
    .replace(/年/g, '/')
    .replace(/月/g, '/')
    .replace(/日/g, '')
    .replace(/\./g, '/')
    .replace(/-/g, '/')

  const monthDayMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!monthDayMatch) return null

  const year = getYoutubeYearFromPropertyNumber(propertyNumber)
  if (!year) return null

  const [, month, day] = monthDayMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function toYoutubeRecord(columns) {
  const propertyNumber = normalizeText(columns[3]).toUpperCase()
  return {
    memo: normalizeText(columns[0]),
    wp_registered: normalizeText(columns[1]),
    post_date: normalizeYoutubePostDate(columns[2], propertyNumber),
    property_number: propertyNumber,
    document_url: normalizeText(columns[9]),
    property_name: normalizeText(columns[4]),
    room_number: normalizeText(columns[5]),
    address: normalizeText(columns[6]),
    management_company: normalizeText(columns[7]),
    contact: normalizeText(columns[8]),
  }
}

async function fetchSheetRecords() {
  const response = await fetch(SHEET_CSV_URL)
  if (!response.ok) {
    throw new Error(`Googleスプレッドシートの取得に失敗しました: ${response.status}`)
  }

  const csvText = new TextDecoder('utf-8').decode(await response.arrayBuffer())
  const rows = parseCsv(csvText)

  return rows
    .slice(1)
    .map(toYoutubeRecord)
    .filter((row) => /^Y\d{3}$/i.test(row.property_number))
}

function groupByPropertyNumber(records) {
  const map = new Map()
  for (const record of records) {
    map.set(record.property_number, record)
  }
  return map
}

async function main() {
  const env = loadEnv()
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('.env または .env.local に Supabase の設定が見つかりません。')
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const sheetRecords = await fetchSheetRecords()
  const nextMap = groupByPropertyNumber(sheetRecords)

  const { data: currentData, error: fetchError } = await supabase
    .from('sns_youtube_properties')
    .select('id, property_number')

  if (fetchError) {
    throw new Error(`今あるデータの読み込みに失敗しました: ${fetchError.message}`)
  }

  const currentRows = currentData || []
  const currentMap = new Map(currentRows.map((row) => [normalizeText(row.property_number).toUpperCase(), row.id]))

  const updates = []
  const inserts = []

  for (const record of sheetRecords) {
    const existingId = currentMap.get(record.property_number)
    if (existingId) {
      updates.push({ id: existingId, ...record })
    } else {
      inserts.push(record)
    }
  }

  const deleteIds = currentRows
    .filter((row) => {
      const propertyNumber = normalizeText(row.property_number).toUpperCase()
      return propertyNumber && !nextMap.has(propertyNumber)
    })
    .map((row) => row.id)

  if (deleteIds.length > 0) {
    const { error } = await supabase.from('sns_youtube_properties').delete().in('id', deleteIds)
    if (error) {
      throw new Error(`不要データの削除に失敗しました: ${error.message}`)
    }
  }

  for (const record of updates) {
    const { id, ...payload } = record
    const { error } = await supabase.from('sns_youtube_properties').update(payload).eq('id', id)
    if (error) {
      throw new Error(`更新に失敗しました (${record.property_number}): ${error.message}`)
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from('sns_youtube_properties').insert(inserts)
    if (error) {
      throw new Error(`新規追加に失敗しました: ${error.message}`)
    }
  }

  console.log(`完了: 取得 ${sheetRecords.length}件 / 更新 ${updates.length}件 / 追加 ${inserts.length}件 / 削除 ${deleteIds.length}件`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
