import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SHEET_ID = '1Pell1SGF4KhC4sGo5JQwzps-2mViOli-p2fhswBM5kc'
const SHEET_GID = process.env.NISHIKITA_SHEET_GID || '0'
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
const TABLE_NAME = 'sns_nishikita_properties'

function loadEnvFile(filePath) {
  try {
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
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
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

function getNishikitaYearFromPropertyNumber(propertyNumber) {
  const code = Number(normalizeText(propertyNumber))
  if (!Number.isInteger(code) || code <= 0) return null
  if (code >= 207) return 2026
  return 2025
}

function normalizeNishikitaPostDate(value, propertyNumber) {
  const text = normalizeText(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const fullDateMatch = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (fullDateMatch) {
    const [, year, month, day] = fullDateMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const normalized = text
    .replace(/\s+/g, '')
    .replace(/\u5e74/g, '/')
    .replace(/\u6708/g, '/')
    .replace(/\u65e5/g, '')
    .replace(/\./g, '/')
    .replace(/-/g, '/')

  const monthDayMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!monthDayMatch) return text

  const year = getNishikitaYearFromPropertyNumber(propertyNumber)
  if (!year) return text

  const [, month, day] = monthDayMatch
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function toNishikitaRecord(columns) {
  return {
    memo: normalizeText(columns[0]),
    post_date: normalizeNishikitaPostDate(columns[1], columns[5]),
    category: normalizeText(columns[2]),
    property_name: normalizeText(columns[3]),
    room_number: normalizeText(columns[4]),
    property_number: normalizeText(columns[5]),
    document_url: normalizeText(columns[6]),
    tiktok_reserved: normalizeText(columns[7]),
    tiktok_wp: normalizeText(columns[8]),
    instagram_reserved: normalizeText(columns[9]),
    instagram_wp: normalizeText(columns[10]),
    youtube_reserved: normalizeText(columns[11]),
    youtube_wp: normalizeText(columns[12]),
    threads_post_date: '',
    post_text: normalizeText(columns[13]),
  }
}

async function fetchSheetRecords() {
  const response = await fetch(SHEET_CSV_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch Google Sheet CSV: ${response.status}`)
  }

  const csvText = new TextDecoder('utf-8').decode(await response.arrayBuffer())
  const rows = parseCsv(csvText)

  return rows
    .slice(1)
    .map(toNishikitaRecord)
    .filter((record) => /^\d+$/.test(record.property_number) && record.property_name)
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
    throw new Error('Supabase settings were not found in .env or .env.local.')
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const sheetRecords = await fetchSheetRecords()
  const nextMap = groupByPropertyNumber(sheetRecords)

  const { data: currentData, error: fetchError } = await supabase
    .from(TABLE_NAME)
    .select('id, property_number')

  if (fetchError) {
    throw new Error(`Failed to read current Nishikita rows: ${fetchError.message}`)
  }

  const currentRows = currentData || []
  const currentMap = new Map(currentRows.map((row) => [normalizeText(row.property_number), row.id]))

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
      const propertyNumber = normalizeText(row.property_number)
      return propertyNumber && !nextMap.has(propertyNumber)
    })
    .map((row) => row.id)

  if (deleteIds.length > 0) {
    const { error } = await supabase.from(TABLE_NAME).delete().in('id', deleteIds)
    if (error) {
      throw new Error(`Failed to delete old Nishikita rows: ${error.message}`)
    }
  }

  for (const record of updates) {
    const { id, ...payload } = record
    const { error } = await supabase.from(TABLE_NAME).update(payload).eq('id', id)
    if (error) {
      throw new Error(`Failed to update Nishikita row ${record.property_number}: ${error.message}`)
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from(TABLE_NAME).insert(inserts)
    if (error) {
      throw new Error(`Failed to insert Nishikita rows: ${error.message}`)
    }
  }

  console.log(`Done. source ${sheetRecords.length} / updated ${updates.length} / inserted ${inserts.length} / deleted ${deleteIds.length}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
