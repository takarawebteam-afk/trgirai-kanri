import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createSign } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// 採用SNS物件管理専用のスプレッドシートID
const SPREADSHEET_ID = '1QM5d_lY-BLJ_GQps7ywATQumck7am0D4aju1ThLOlwM'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

// 対象シート名のパターン（例: 「【Instagram】6月」）
const INSTAGRAM_SHEET_PREFIX = '【Instagram】'

type RecruitmentSnsPropertyRecord = {
  created_at?: string
  post_date: string | null
  category: string | null
  title: string | null
}

// ------------------------------------------------
// Google認証まわり（既存APIと同じパターン）
// ------------------------------------------------

function base64Url(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n')
}

function getGoogleServiceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || ''
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''

  if (!email || !privateKey) return null
  return { email, privateKey: normalizePrivateKey(privateKey) }
}

function createServiceAccountJwt(email: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const unsignedToken = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${unsignedToken}.${signature}`
}

async function getGoogleAccessToken() {
  const account = getGoogleServiceAccount()
  if (!account) throw new Error('Google sheet write key is not set.')

  const assertion = createServiceAccountJwt(account.email, account.privateKey)
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const data = await response.json() as { access_token?: string; error_description?: string; error?: string }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Google auth failed.')
  }

  return data.access_token
}

// ------------------------------------------------
// Supabase
// ------------------------------------------------

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) throw new Error('Supabase connection settings are not set.')
  return createClient(url, key)
}

async function fetchAllRecruitmentProperties(): Promise<RecruitmentSnsPropertyRecord[]> {
  const supabase = getSupabaseClient()
  const rows: RecruitmentSnsPropertyRecord[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('sns_recruitment_properties')
      .select('created_at, post_date, category, title')
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const pageRows = (data || []) as RecruitmentSnsPropertyRecord[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
}

// ------------------------------------------------
// スプレッドシート操作
// ------------------------------------------------

// シート一覧を取得して「【Instagram】〇月」の名前だけ返す
async function fetchInstagramSheetNames(accessToken: string): Promise<string[]> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )

  if (!response.ok) throw new Error(`シート一覧の取得に失敗しました。${await response.text()}`)

  const data = await response.json() as { sheets?: { properties?: { title?: string } }[] }
  const allSheetNames = (data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean)

  return allSheetNames.filter((name) => name.startsWith(INSTAGRAM_SHEET_PREFIX))
}

// 「【Instagram】6月」→ 6 を返す
function parseMonthFromSheetName(sheetName: string): number | null {
  // 「【Instagram】6月」→「6月」→「6」
  const suffix = sheetName.slice(INSTAGRAM_SHEET_PREFIX.length) // 例: "6月"
  const match = suffix.match(/^(\d{1,2})月$/)
  if (!match) return null
  return parseInt(match[1], 10)
}

// post_date（例: "2025-06-03"）から { month, day } を返す
function parsePostDate(postDate: string | null): { month: number; day: number } | null {
  if (!postDate) return null
  const match = postDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return {
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  }
}

// 対象シートのA列（A1:A45）を読んで「日付の数値がある行インデックス（0始まり）→ 日付の数値」のマップを返す
async function readSheetDayMap(
  accessToken: string,
  sheetName: string,
): Promise<Map<number, number>> {
  const escapedSheetName = sheetName.replace(/'/g, "''")
  const range = encodeURIComponent(`'${escapedSheetName}'!A1:A45`)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  if (!response.ok) throw new Error(`シート読み込みに失敗しました（${sheetName}）。${await response.text()}`)

  const data = await response.json() as { values?: string[][] }
  const rows = data.values || []

  // 行インデックス（0始まり） → 日付の数値（1〜31）
  const dayMap = new Map<number, number>()
  for (let i = 0; i < rows.length; i++) {
    const cellValue = (rows[i]?.[0] ?? '').toString().trim()
    const dayNum = parseInt(cellValue, 10)
    if (!Number.isNaN(dayNum) && dayNum >= 1 && dayNum <= 31 && String(dayNum) === cellValue) {
      dayMap.set(i, dayNum)
    }
  }

  return dayMap
}

// C列・D列を一括書き込み
// dayMap: 行インデックス→日付の数値
// dataByDay: 日付の数値→{ category, title }
async function writeSheetCategoryAndTitle(
  accessToken: string,
  sheetName: string,
  dayMap: Map<number, number>,
  dataByDay: Map<number, { category: string; title: string }>,
) {
  if (dayMap.size === 0) return

  // C列・D列の書き込み範囲は行1〜（最大インデックス+1）行目まで
  const maxRowIndex = Math.max(...dayMap.keys())
  const totalRows = maxRowIndex + 1

  // C列（index=2）とD列（index=3）の配列を用意（空文字で初期化）
  const cValues: string[][] = Array.from({ length: totalRows }, () => [''])
  const dValues: string[][] = Array.from({ length: totalRows }, () => [''])

  for (const [rowIndex, day] of dayMap.entries()) {
    const record = dataByDay.get(day)
    cValues[rowIndex] = [record?.category ?? '']
    dValues[rowIndex] = [record?.title ?? '']
  }

  // C列とD列をまとめて2列で書き込む
  const combinedValues: string[][] = Array.from({ length: totalRows }, (_, i) => [
    cValues[i][0],
    dValues[i][0],
  ])

  const escapedSheetName = sheetName.replace(/'/g, "''")
  const range = encodeURIComponent(`'${escapedSheetName}'!C1:D${totalRows}`)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: combinedValues }),
    },
  )

  if (!response.ok) throw new Error(`シート書き込みに失敗しました（${sheetName}）。${await response.text()}`)
}

// ------------------------------------------------
// メイン処理
// ------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'POST only.' })
  }

  try {
    // 1. Supabaseから採用物件の全レコードを取得
    const records = await fetchAllRecruitmentProperties()

    // 2. 月ごとに { 日 → { category, title } } のマップを作る
    //    同じ日に複数レコードがある場合は最初の1件を採用
    const dataByMonth = new Map<number, Map<number, { category: string; title: string }>>()
    for (const record of records) {
      const parsed = parsePostDate(record.post_date)
      if (!parsed) continue
      const { month, day } = parsed

      if (!dataByMonth.has(month)) {
        dataByMonth.set(month, new Map())
      }
      const dayMap = dataByMonth.get(month)!
      if (!dayMap.has(day)) {
        // 同じ日の最初のレコードを使用
        dayMap.set(day, {
          category: (record.category ?? '').trim(),
          title: (record.title ?? '').trim(),
        })
      }
    }

    // 3. Google認証
    const accessToken = await getGoogleAccessToken()

    // 4. スプレッドシートの「【Instagram】〇月」シート一覧を取得
    const instagramSheetNames = await fetchInstagramSheetNames(accessToken)

    // 5. 各シートに対して書き込み
    let totalUpdatedSheets = 0
    for (const sheetName of instagramSheetNames) {
      const month = parseMonthFromSheetName(sheetName)
      if (month === null) continue

      // A列を読んで「行インデックス→日付数値」のマップを取得
      const sheetDayMap = await readSheetDayMap(accessToken, sheetName)
      if (sheetDayMap.size === 0) continue

      // Supabaseデータのうちこの月のデータ（なければ空のMap）
      const monthData = dataByMonth.get(month) ?? new Map<number, { category: string; title: string }>()

      // C列・D列を書き込む（データのない日は空文字）
      await writeSheetCategoryAndTitle(accessToken, sheetName, sheetDayMap, monthData)
      totalUpdatedSheets++
    }

    return res.status(200).json({
      ok: true,
      updatedSheets: totalUpdatedSheets,
      recordCount: records.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sheet sync failed.'
    return res.status(500).json({ ok: false, message })
  }
}
