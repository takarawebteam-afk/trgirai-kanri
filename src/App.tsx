import { Fragment, useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, LineChart, Line } from 'recharts'
import * as XLSX from 'xlsx'
import './App.css'
import { supabase } from './supabase'
import ManualsPage from './ManualsPage'
import ProgressPage from './ProgressPage'
import OfficeNetworkGate from './OfficeNetworkGate'

type Department = '人事' | '総務' | '仲介' | '管理' | '売買' | '本社' | 'その他'
type TaskType = '単発' | '継続'
type TaskStatus = '未実施' | '作業中' | '完了'
type Priority = '高' | '中' | '低'
type SnsPlatform = 'TikTok' | 'Instagram' | 'Threads' | 'YouTube'
type RecruitDepartment = '仲介' | '管理' | '売買' | 'ビバ' | '経理' | '総務' | 'その他'
type JobType = '正社員' | 'パート'
type TaskItemStatus = '未着手' | '進行中' | '完了'
type TaskItemRecurrence = 'none' | 'monthly'
type RecurringDateRule = 'same_day' | 'month_end'
type PageKey = 'dashboard' | 'tasks' | 'sns' | 'recruitment' | 'taskmanagement' | 'members' | 'hankyo' | 'manuals' | 'dm' | 'stock' | 'busho' | 'jishashukyaku' | 'progress' | 'taskreport' | 'snsproperty'

type StockRecord = {
  id: string
  deadline: string
  required_count: number
  label: string
  note: string
  achieved_count: number
  created_at?: string
}

const DEPARTMENTS = ['人事', '総務', '仲介', '管理', '売買', '本社', 'その他'] as const

type BushoSchedule = {
  id: string
  created_at: string
  date: string
  start_time?: string | null
  title: string
  department: string
  note: string
}

type JishaShukyakuMedia = 'Karilun' | '学生サイト' | 'SNS' | '地域サイト' | '口コミ'
type JishaShukyakuRowType = '予算' | '実績' | '前年'
type JishaShukyakuRecord = {
  id: string
  year: number
  month: number
  media: JishaShukyakuMedia
  row_type: JishaShukyakuRowType
  hankyo_count: number
  hankyo_raikyo: number
  shinki_count: number
  keiyaku_count: number
  koken_uriaage: number
  created_at?: string
}

type JishaMetricField = keyof Pick<
  JishaShukyakuRecord,
  'hankyo_count' | 'hankyo_raikyo' | 'shinki_count' | 'keiyaku_count' | 'koken_uriaage'
>

type JishaImportRow = {
  month: number
  rowType: Extract<JishaShukyakuRowType, '実績' | '前年'>
  values: Record<JishaMetricField, number>
}

const JISHA_METRIC_FIELDS: JishaMetricField[] = [
  'hankyo_count',
  'hankyo_raikyo',
  'shinki_count',
  'keiyaku_count',
  'koken_uriaage',
]

const JISHA_EXCEL_CELL_MAP: Record<JishaMetricField, { 実績: string; 前年: string }> = {
  hankyo_count: { 実績: 'H117', 前年: 'H118' },
  hankyo_raikyo: { 実績: 'N117', 前年: 'N118' },
  shinki_count: { 実績: 'W117', 前年: 'W118' },
  keiyaku_count: { 実績: 'AB117', 前年: 'AB118' },
  koken_uriaage: { 実績: 'AG117', 前年: 'AG118' },
}

function getJishaMediaFromFileName(fileName: string): JishaShukyakuMedia | null {
  const normalized = fileName.toLowerCase()

  if (normalized.includes('karilun')) return 'Karilun'
  if (normalized.includes('学生サイト')) return '学生サイト'
  if (normalized.includes('sns')) return 'SNS'
  if (normalized.includes('地域サイト')) return '地域サイト'
  if (normalized.includes('口コミ')) return '口コミ'

  return null
}

function readJishaExcelNumber(sheet: XLSX.WorkSheet, address: string) {
  const cell = sheet[address]
  if (!cell) return 0

  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return cell.v
  }

  const raw = typeof cell.w === 'string' && cell.w.trim() !== '' ? cell.w : String(cell.v ?? '')
  const normalized = raw.replace(/,/g, '').trim()
  const value = Number(normalized)

  return Number.isFinite(value) ? value : 0
}

function extractJishaRowsFromWorkbook(workbook: XLSX.WorkBook) {
  const rows: JishaImportRow[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const match = sheetName.match(/^(\d{1,2})月$/)
    if (!match) return

    const month = Number(match[1])
    if (!Number.isInteger(month) || month < 1 || month > 12) return

    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return

    ;(['実績', '前年'] as const).forEach((rowType) => {
      const values = JISHA_METRIC_FIELDS.reduce((acc, field) => {
        acc[field] = readJishaExcelNumber(sheet, JISHA_EXCEL_CELL_MAP[field][rowType])
        return acc
      }, {} as Record<JishaMetricField, number>)

      rows.push({ month, rowType, values })
    })
  })

  const rowsByMonth = rows.reduce((acc, row) => {
    if (!acc[row.month]) acc[row.month] = []
    acc[row.month].push(row)
    return acc
  }, {} as Record<number, JishaImportRow[]>)

  return Object.entries(rowsByMonth)
    .flatMap(([monthText, monthRows]) => {
      const month = Number(monthText)
      const actualRow = monthRows.find((row) => row.rowType === '実績')
      const hasActualValue = actualRow
        ? JISHA_METRIC_FIELDS.some((field) => actualRow.values[field] !== 0)
        : false

      if (!hasActualValue) return []

      return monthRows.map((row) => ({ ...row, month }))
    })
    .sort((a, b) => a.month - b.month)
}

const defaultBushoForm = { date: '', start_time: '', title: '', department: '人事', note: '' }

const DEPT_COLORS: Record<string, string> = {
  人事: '#4f86c6',
  総務: '#6ab04c',
  仲介: '#f0932b',
  管理: '#eb4d4b',
  売買: '#9b59b6',
  本社: '#1abc9c',
  その他: '#95a5a6',
}

type HankyoRecord = {
  id: string
  inquiry_date: string
  account: string
  trigger: string
  media: string
  inquiry_type: string
  customer_name: string
  contact_method: string
  move_in_timing: string
  store: string
  area: string
  note: string
  confirmed?: boolean
  created_at?: string
  updated_at?: string
}

type DMRecord = {
  id: string
  date: string
  account: string
  sns: string
  area: string
  property_number: string
  created_at?: string
}

type SnsPropertyPlatform =
  | 'sokanri'
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'keihan-karilun'
  | 'nishinomiya-karilun'
  | 'nagase'
  | 'nishikita'
  | 'yao'
  | 'recruitment'
type StoreSnsPropertyPlatform = 'keihan-karilun' | 'nishinomiya-karilun' | 'nagase' | 'nishikita' | 'yao'
type SnsPropertyTableName =
  | 'sns_tiktok_properties'
  | 'sns_instagram_properties'
  | 'sns_youtube_properties'
  | 'sns_recruitment_properties'
  | 'sns_keihan_karilun_properties'
  | 'sns_nishinomiya_karilun_properties'
  | 'sns_nagase_properties'
  | 'sns_nishikita_properties'
  | 'sns_yao_properties'

type SnsPostingRule = {
  id: string
  account_platform_key: string
  rule_type: 'weekday' | 'interval'
  day_of_week: number | null
  interval_days: number | null
  reference_date: string | null
}

type SnsMemoEditorState = {
  tableName: SnsPropertyTableName
  id: string
  value: string
}

type TiktokPropertyRecord = {
  id: string
  created_at?: string
  memo: string
  wp_registered: string
  aos_registered: string
  post_date: string
  property_number: string
  floor_plan: string
  rent: string
  area: string
  nearest_station: string
  document_url: string
  property_name: string
  room_number: string
  address: string
  acquisition_source: string
  management_company: string
  contact: string
}

type InstagramPropertyRecord = {
  id: string
  created_at?: string
  memo: string
  wp_registered: string
  category: string
  post_date: string
  property_number: string
  floor_plan: string
  rent: string
  area: string
  nearest_station: string
  document_url: string
  property_name: string
  room_number: string
  address: string
  acquisition_source: string
  management_company: string
  contact: string
}

type YoutubePropertyRecord = {
  id: string
  created_at?: string
  memo: string
  wp_registered: string
  post_date: string
  property_number: string
  document_url: string
  property_name: string
  room_number: string
  address: string
  acquisition_source: string
  management_company: string
  contact: string
}

type StoreSnsPropertyRecord = {
  id: string
  created_at?: string
  memo: string
  post_date: string
  category: string
  property_name: string
  room_number: string
  property_number: string
  document_url: string
  tiktok_reserved: string
  tiktok_wp: string
  instagram_reserved: string
  instagram_wp: string
  youtube_reserved: string
  youtube_wp: string
  threads_post_date: string
  post_text: string
}

type RecruitmentSnsPropertyRecord = {
  id: string
  created_at?: string
  memo: string
  post_date: string
  category: string
  title: string
  property_number: string
  post_reserved: string
  youtube_reserved: string
}

type SnsPropertyTab = {
  key: SnsPropertyPlatform
  label: string
  title: string
  status: 'ready' | 'placeholder'
}

type TaskItem = {
  id: string
  created_at?: string
  date: string
  name: string
  priority: Priority
  due_date: string
  work_date: string
  memo: string
  assignees: string[]
  creator: string
  status: TaskItemStatus
  parent_task_id?: string | null
  recurring_type?: TaskItemRecurrence
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

type Member = {
  id: string
  name: string
  slack_user_id: string
}

type Task = {
  id: string
  taskDate: string
  assignees: string[]
  department: Department
  name: string
  content: string
  taskType: TaskType
  dueDate: string
  priority: Priority
  status: TaskStatus
  savings: number
  note: string
}

type SnsPost = {
  id: string
  postDate: string
  platform: SnsPlatform
  account: string
  comments: number
  saves: number
}

type RecruitmentRecord = {
  id: string
  date: string
  platform: SnsPlatform
  department: RecruitDepartment
  jobType: JobType
  costReduction: number
}

type AllowedAccount = {
  id: string
  created_at?: string
  email: string
  is_master: boolean
  allow_outside_office: boolean
  created_by?: string | null
}

const TEAM_MEMBERS = [
  { name: '新居', calendarId: 'trg.yshini@gmail.com', color: '#374151' },
  { name: '泉', calendarId: 'izumiyurina2322@gmail.com', color: '#7c3aed' },
  { name: '坂本', calendarId: 'takarabaito3@gmail.com', color: '#1d4ed8' },
  { name: '吉田', calendarId: 'takarabaito1@gmail.com', color: '#db2777' },
  { name: 'WEBチーム', calendarId: 'takara.webteam@gmail.com', color: '#0ea5e9' },
]

const TEAM_MEMBER_OPTIONS = TEAM_MEMBERS.filter((member) => member.name !== 'WEBチーム')
const MEMBER_NAME_BY_CALENDAR_ID = Object.fromEntries(TEAM_MEMBERS.map((member) => [member.calendarId, member.name])) as Record<string, string>
const STOCK_ATTENDANCE_MEMBERS = [
  { name: '泉', badge: '泉', calendarId: 'izumiyurina2322@gmail.com' },
  { name: '坂本', badge: '坂', calendarId: 'takarabaito3@gmail.com' },
  { name: '吉田', badge: '吉', calendarId: 'takarabaito1@gmail.com' },
] as const
const STOCK_HONMACHI_MEMBER = { name: '新居', badge: '新', calendarId: 'trg.yshini@gmail.com' } as const
const TASK_REPORT_WORK_MINUTES: Record<string, number> = {
  泉: 480,
  坂本: 480,
  吉田: 330,
}
const TASK_REPORT_NII_HONMACHI_MINUTES = 480
const TASK_REPORT_NII_HONSHA_TO_HONMACHI_MINUTES = 300
const TASK_REPORT_395_MINUTES = 360
const TASK_REPORT_DAY_OFF_KEYWORDS = ['公休', '欠勤', '有給', '上期公休', '下期公休']
type TaskReportCalendarEvent = { summary: string; isAllDay: boolean }

const DEFAULT_TASK_REPORT_CATEGORIES = [
  {
    id: 'default-sns-post',
    name: 'SNS投稿・予約投稿',
    keywords: 'sns\n投稿\nyoutube\ntiktok\ninstagram\nthreads\n予約',
    sort_order: 0,
  },
  {
    id: 'default-analysis',
    name: '分析・改善',
    keywords: '数値入力\n数値,入力\nアカウント,数値\n分析\n改善\nレポート',
    sort_order: 1,
  },
  {
    id: 'default-other',
    name: 'その他',
    keywords: '',
    sort_order: 999,
  },
] as const

const TASK_REPORT_CHART_COLORS = ['#005AFF', '#03AF7A', '#F6AA00', '#4DC4FF', '#FF4B00', '#FFF100', '#990099', '#84919E', '#000000'] as const

const TAB_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'dashboard', label: 'ダッシュボード' },
  { key: 'busho', label: '部署予定' },
  { key: 'tasks', label: '案件管理' },
  { key: 'taskmanagement', label: 'タスク管理' },
  { key: 'recruitment', label: '採用管理' },
  { key: 'hankyo', label: '反響管理' },
  { key: 'dm', label: 'DM管理' },
  { key: 'jishashukyaku', label: '自社集客売上' },
  { key: 'members', label: '当日業務管理' },
  { key: 'taskreport', label: '業務棚卸し' },
  { key: 'snsproperty', label: 'SNS物件管理' },
  { key: 'progress', label: '進捗管理' },
  { key: 'stock', label: 'ストック管理' },
  { key: 'sns', label: 'SNS投稿管理' },
  { key: 'manuals', label: 'Note' },
] as const

type CalendarEvent = { id: string; summary: string; start: string }

type TaskReportRow = {
  id: string
  event_date: string
  member_name: string
  task_name: string
  minutes: number
  source: 'Googleカレンダー' | '追加タスク'
  category: string
  source_key: string
  source_type: 'checked_events' | 'manual_tasks'
}

type TaskReportCategoryMaster = {
  id: string
  name: string
  keywords: string
  sort_order: number
  created_at?: string
}

type TaskReportCategorySummary = {
  category: string
  detail: string
  memberCounts: Record<string, number>
  memberMinutes: Record<string, number>
  totalCount: number
  totalMinutes: number
  averageMinutes: number
  isCategoryTotal: boolean
}

type WeeklyScheduleItem = {
  id: string
  source: '案件管理' | 'タスク管理' | '部署予定'
  date: string
  start_time?: string
  title: string
  detail: string
}

const departments: Department[] = ['人事', '総務', '仲介', '管理', '売買', '本社', 'その他']
const taskTypes: TaskType[] = ['単発', '継続']
const taskStatuses: TaskStatus[] = ['未実施', '作業中', '完了']
const taskItemStatuses: TaskItemStatus[] = ['未着手', '進行中', '完了']
const priorityOptions: Priority[] = ['高', '中', '低']
const assigneeOptions = ['泉', '坂本', '吉田', '新居']

// DM管理 マスターデータ
const dmAccounts = ['Karilun', '京阪Karilun', '西宮Karilun', '近鉄八尾店', '近大一人暮らし', '関学一人暮らし']
const dmSnsList = ['TikTok', 'Instagram', 'Threads', 'YouTube']

// 反響管理 マスターデータ
const hankyoAccounts = ['Karilun', '西宮Karilun', '京阪Karilun', '近大', '関学', '外大', '摂南', '大商', '大経', '武庫女', '学生ポータル', '八尾', '売買', '採用', '管理', '店舗']
const hankyoTriggers = ['検索', 'Karilun', 'TikTok', 'Instagram', 'threads', 'YouTube', '広告', '学生サイト', '学生ポータル', '地域サイト', '不明']
const hankyoMedias = ['Karilun', '学生サイト', 'TikTok', 'Instagram', 'threads', 'YouTube', '地域サイト', '口コミ', '不明']
const hankyoInquiryTypes = ['物件問合', 'アンケート', '来店予約', 'オンライン', '相談', 'その他']
const hankyoContactMethods = ['LINE', 'メール', 'DM', 'コメント', '電話']
const hankyoMoveInTimings = ['2週間以内', '1ヶ月以内', '2ヶ月以内', '3ヶ月以内', '4ヶ月以内', '時期先', '良いのがあれば', '時期未定', '不明']
const hankyoStores = ['対象外', '店舗誘導済', '大阪店', '京橋店', '放出店', '淡路店', '長瀬店', '西北店', '枚方店', '八尾店', '塚口店', 'JR西宮店', '寝屋川店', '守口店', '高槻店', '長田店', '布施店', '小阪店', '瓢箪山店', '深井店', 'WEB', '反響C', '重複']

const defaultTaskItemForm: Omit<TaskItem, 'id' | 'created_at'> = {
  date: new Date().toISOString().split('T')[0],
  name: '',
  priority: '中',
  due_date: '',
  work_date: '',
  memo: '',
  assignees: [],
  creator: '',
  status: '未着手',
  parent_task_id: null,
  recurring_type: 'none',
  recurring_template_id: null,
  recurring_parent_template_id: null,
  recurring_generation_month: null,
  recurring_due_day: null,
  recurring_due_rule: null,
  recurring_work_day: null,
  recurring_work_rule: null,
  recurring_instance_key: null,
}
const snsPlatforms: SnsPlatform[] = ['TikTok', 'Instagram', 'Threads', 'YouTube']
const snsAccounts = ['Karilun', '西宮Karilun', '京阪Karilun', '近大', '関学', '八尾', '採用', '管理']
const recruitDepartments: RecruitDepartment[] = ['仲介', '管理', '売買', 'ビバ', '経理', '総務', 'その他']
const jobTypes: JobType[] = ['正社員', 'パート']

const defaultTaskForm: Omit<Task, 'id'> = {
  taskDate: '',
  assignees: [],
  department: '人事',
  name: '',
  content: '',
  taskType: '単発',
  dueDate: '',
  priority: '中',
  status: '未実施',
  savings: 0,
  note: '',
}

const defaultSnsForm: Omit<SnsPost, 'id'> = {
  postDate: '',
  platform: 'TikTok',
  account: 'Karilun',
  comments: 0,
  saves: 0,
}

const defaultRecruitmentForm: Omit<RecruitmentRecord, 'id'> = {
  date: '',
  platform: 'TikTok',
  department: '仲介',
  jobType: '正社員',
  costReduction: 0,
}

const defaultHankyoForm: Omit<HankyoRecord, 'id' | 'created_at' | 'updated_at'> = {
  inquiry_date: new Date().toISOString().split('T')[0],
  account: '',
  trigger: '',
  media: '',
  inquiry_type: '',
  customer_name: '',
  contact_method: '',
  move_in_timing: '',
  store: '',
  area: '',
  note: '',
}

const DM_PAGE_SIZE = 20

const defaultDmForm: Omit<DMRecord, 'id' | 'created_at'> = {
  date: new Date().toISOString().split('T')[0],
  account: 'Karilun',
  sns: 'TikTok',
  area: '',
  property_number: '',
}

const defaultTiktokPropertyForm: Omit<TiktokPropertyRecord, 'id' | 'created_at'> = {
  memo: '', wp_registered: '', aos_registered: '', post_date: '', property_number: '',
  floor_plan: '', rent: '', area: '', nearest_station: '', document_url: '',
  property_name: '', room_number: '', address: '', acquisition_source: '', management_company: '', contact: ''
}

const defaultInstagramPropertyForm: Omit<InstagramPropertyRecord, 'id' | 'created_at'> = {
  memo: '', wp_registered: '', category: '', post_date: '', property_number: '',
  floor_plan: '', rent: '', area: '', nearest_station: '', document_url: '',
  property_name: '', room_number: '', address: '', acquisition_source: '', management_company: '', contact: ''
}

const defaultYoutubePropertyForm: Omit<YoutubePropertyRecord, 'id' | 'created_at'> = {
  memo: '', wp_registered: '', post_date: '', property_number: '',
  document_url: '', property_name: '', room_number: '', address: '',
  acquisition_source: '', management_company: '', contact: ''
}

const defaultStoreSnsPropertyForm: Omit<StoreSnsPropertyRecord, 'id' | 'created_at'> = {
  memo: '',
  post_date: '',
  category: '',
  property_name: '',
  room_number: '',
  property_number: '',
  document_url: '',
  tiktok_reserved: '',
  tiktok_wp: '',
  instagram_reserved: '',
  instagram_wp: '',
  youtube_reserved: '',
  youtube_wp: '',
  threads_post_date: '',
  post_text: '',
}

const defaultRecruitmentSnsPropertyForm: Omit<RecruitmentSnsPropertyRecord, 'id' | 'created_at'> = {
  memo: '',
  post_date: '',
  category: '',
  title: '',
  property_number: '',
  post_reserved: '',
  youtube_reserved: '',
}

const snsPropertyTabs: SnsPropertyTab[] = [
  { key: 'sokanri', label: '総管理', title: '総管理', status: 'ready' },
  { key: 'tiktok', label: 'TikTok', title: 'Karilun｜TikTok 物件管理', status: 'ready' },
  { key: 'instagram', label: 'Instagram', title: 'Karilun｜Instagram 物件管理', status: 'ready' },
  { key: 'youtube', label: 'YouTube', title: 'Karilun｜YouTube 物件管理', status: 'ready' },
  { key: 'keihan-karilun', label: '京阪', title: '京阪かりるん 物件管理', status: 'ready' },
  { key: 'nishinomiya-karilun', label: '西宮市', title: '西宮かりるん 物件管理', status: 'ready' },
  { key: 'nagase', label: '長瀬店', title: '長瀬店 物件管理', status: 'ready' },
  { key: 'nishikita', label: '西北店', title: '西北店 物件管理', status: 'ready' },
  { key: 'yao', label: '八尾店', title: '八尾店 物件管理', status: 'ready' },
  { key: 'recruitment', label: '採用', title: '採用 物件管理', status: 'ready' },
]

const SOKANRI_ROWS = [
  { apKey: 'karilun-tiktok', account: 'Karilun', platform: 'TikTok', accountColor: '#EBF5FB' },
  { apKey: 'karilun-instagram', account: 'Karilun', platform: 'Instagram', accountColor: '#EBF5FB' },
  { apKey: 'karilun-youtube', account: 'Karilun', platform: 'YouTube', accountColor: '#EBF5FB' },
  { apKey: 'keihan-tiktok', account: '京阪かりるん', platform: 'TikTok', accountColor: '#EAF4F4' },
  { apKey: 'keihan-instagram', account: '京阪かりるん', platform: 'Instagram', accountColor: '#EAF4F4' },
  { apKey: 'nishinomiya-tiktok', account: '西宮かりるん', platform: 'TikTok', accountColor: '#F4ECF7' },
  { apKey: 'nishinomiya-instagram', account: '西宮かりるん', platform: 'Instagram', accountColor: '#F4ECF7' },
  { apKey: 'nishinomiya-youtube', account: '西宮かりるん', platform: 'YouTube', accountColor: '#F4ECF7' },
  { apKey: 'nagase-tiktok', account: '長瀬店', platform: 'TikTok', accountColor: '#FEF9E7' },
  { apKey: 'nagase-instagram', account: '長瀬店', platform: 'Instagram', accountColor: '#FEF9E7' },
  { apKey: 'nagase-youtube', account: '長瀬店', platform: 'YouTube', accountColor: '#FEF9E7' },
  { apKey: 'nishikita-tiktok', account: '西北店', platform: 'TikTok', accountColor: '#E8F5E9' },
  { apKey: 'nishikita-instagram', account: '西北店', platform: 'Instagram', accountColor: '#E8F5E9' },
  { apKey: 'nishikita-youtube', account: '西北店', platform: 'YouTube', accountColor: '#E8F5E9' },
  { apKey: 'yao-tiktok', account: '八尾店', platform: 'TikTok', accountColor: '#F9EBF8' },
  { apKey: 'yao-instagram', account: '八尾店', platform: 'Instagram', accountColor: '#F9EBF8' },
  { apKey: 'yao-youtube', account: '八尾店', platform: 'YouTube', accountColor: '#F9EBF8' },
]

const PLATFORM_LABEL_STYLE: Record<string, { bg: string; color: string }> = {
  TikTok: { bg: '#010101', color: '#fff' },
  Instagram: { bg: '#C13584', color: '#fff' },
  YouTube: { bg: '#FF0000', color: '#fff' },
  Threads: { bg: '#101010', color: '#fff' },
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function getWeekdayLabel(dateText: string) {
  if (!dateText) return ''
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return DAY_LABELS[date.getDay()]
}

const storeSnsPropertyPlatforms: StoreSnsPropertyPlatform[] = [
  'keihan-karilun',
  'nishinomiya-karilun',
  'nagase',
  'nishikita',
  'yao',
]

const storeSnsPropertyTableMap: Record<StoreSnsPropertyPlatform, SnsPropertyTableName> = {
  'keihan-karilun': 'sns_keihan_karilun_properties',
  'nishinomiya-karilun': 'sns_nishinomiya_karilun_properties',
  nagase: 'sns_nagase_properties',
  nishikita: 'sns_nishikita_properties',
  yao: 'sns_yao_properties',
}

type SnsPropertySelectField =
  | 'wp_registered'
  | 'aos_registered'
  | 'acquisition_source'
  | 'tiktok_reserved'
  | 'tiktok_wp'
  | 'instagram_reserved'
  | 'instagram_wp'
  | 'youtube_reserved'
  | 'youtube_wp'
  | 'threads_post_date'
  | 'post_text'
  | 'post_reserved'

type SnsPropertyOptionEditorState = {
  field: SnsPropertySelectField
  title: string
  items: string[]
}

type SnsPropertySelectOptionRow = {
  id: string
  field: SnsPropertySelectField
  label: string
  sort_order: number | null
  created_at?: string
}

const SNS_PROPERTY_OPTION_STORAGE_PREFIX = 'sns_property_select_options:'
const DEFAULT_SNS_WP_OPTIONS = [
  '〇-新居',
  '〇-泉',
  '〇-米澤',
  '〇-坂本',
  '〇-吉田',
  '準備中-新',
  '準備中-泉',
  '準備中-米',
  '準備中‐吉',
  '準備中‐坂',
  '下書き済-泉',
  '×',
] as const
const DEFAULT_SNS_AOS_OPTIONS = [
  '〇-営業店',
  '〇-RPA/APSS',
  '〇-泉',
  '〇-坂本',
  '〇-吉田',
  '〇-営業店依頼中',
  '投稿部屋満室の為他建屋利用',
  '登録前満室で登録未',
  '他社サイトで対応',
  '広告不可',
  '×',
] as const
const DEFAULT_STORE_SNS_STATUS_OPTIONS = [
  '〇-新',
  '〇-泉',
  '〇-米',
  '〇-坂',
  '〇-吉',
  '新居',
  '吉田',
  '✖(画像投稿)',
  '写真無',
  '〇',
] as const
const DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS = [
  '〇-泉',
  '〇-坂',
  '〇-吉',
  '準備中',
  '×',
] as const
const DEFAULT_STORE_SNS_POST_TEXT_OPTIONS = [
  '2重ﾁｪｯｸOK泉',
  '2重ﾁｪｯｸOK坂',
  '2重ﾁｪｯｸOK吉',
] as const
const DEFAULT_ACQUISITION_SOURCE_OPTIONS = [
  'リアプロ',
  'イタンジ',
  'レインズ',
  '管理会社HP',
  'その他',
] as const
const FIXED_ACQUISITION_SOURCE_OPTIONS = normalizeSnsPropertyOptions([...DEFAULT_ACQUISITION_SOURCE_OPTIONS])
const SNS_PROPERTY_DEFAULT_OPTIONS: Record<SnsPropertySelectField, string[]> = {
  wp_registered: normalizeSnsPropertyOptions([...DEFAULT_SNS_WP_OPTIONS]),
  aos_registered: normalizeSnsPropertyOptions([...DEFAULT_SNS_AOS_OPTIONS]),
  acquisition_source: FIXED_ACQUISITION_SOURCE_OPTIONS,
  tiktok_reserved: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS]),
  tiktok_wp: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS]),
  instagram_reserved: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS]),
  instagram_wp: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS]),
  youtube_reserved: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_STATUS_OPTIONS]),
  youtube_wp: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_STATUS_OPTIONS]),
  threads_post_date: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_MAIN_STATUS_OPTIONS]),
  post_text: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_POST_TEXT_OPTIONS]),
  post_reserved: normalizeSnsPropertyOptions([...DEFAULT_STORE_SNS_STATUS_OPTIONS]),
}
const SNS_PROPERTY_PAGE_SIZE = 30
const SNS_PROPERTY_CATEGORY_OPTIONS = ['動画', '画像'] as const

function normalizeSnsPropertySearch(value: string) {
  return value.trim().toUpperCase()
}

function buildSnsPropertyPageInfo(totalCount: number, currentPage: number) {
  const safeTotalCount = Math.max(0, totalCount)
  const totalPages = Math.max(1, Math.ceil(safeTotalCount / SNS_PROPERTY_PAGE_SIZE))
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages)
  return {
    totalPages,
    currentPage: safeCurrentPage,
    from: safeTotalCount === 0 ? 0 : (safeCurrentPage - 1) * SNS_PROPERTY_PAGE_SIZE + 1,
    to: safeTotalCount === 0 ? 0 : Math.min(safeCurrentPage * SNS_PROPERTY_PAGE_SIZE, safeTotalCount),
  }
}

function normalizeSnsPropertyOptions(options: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      options
        .map((option) => String(option ?? '').trim())
        .filter(Boolean),
    ),
  )
}

function getStoredSnsPropertyOptions(field: SnsPropertySelectField) {
  if (field === 'acquisition_source') return FIXED_ACQUISITION_SOURCE_OPTIONS
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(`${SNS_PROPERTY_OPTION_STORAGE_PREFIX}${field}`)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return normalizeSnsPropertyOptions(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return null
  }
}

function saveStoredSnsPropertyOptions(field: SnsPropertySelectField, options: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    `${SNS_PROPERTY_OPTION_STORAGE_PREFIX}${field}`,
    JSON.stringify(normalizeSnsPropertyOptions(options)),
  )
}

function isMissingSnsPropertyOptionTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeCode = 'code' in error ? String(error.code || '') : ''
  const maybeMessage = 'message' in error ? String(error.message || '') : ''
  return maybeCode === '42P01' || maybeMessage.includes('sns_property_select_options')
}

function getSnsPropertyYearFromPropertyNumber(propertyNumber: string | null | undefined, storePlatform?: StoreSnsPropertyPlatform) {
  const normalizedPropertyNumber = String(propertyNumber || '').trim().toUpperCase()
  const tikTokMatch = normalizedPropertyNumber.match(/^K(\d{4})$/)
  if (tikTokMatch) {
    const code = Number(tikTokMatch[1])
    if (code >= 922) return 2026
    return 2025
  }

  const instagramMatch = normalizedPropertyNumber.match(/^G(\d{3})$/)
  if (instagramMatch) {
    const code = Number(instagramMatch[1])
    if (code >= 485) return 2026
    return 2025
  }

  const storeMatch = normalizedPropertyNumber.match(/^(\d{3})$/)
  if (storeMatch) {
    const code = Number(storeMatch[1])
    if (storePlatform === 'nagase') return 2025
    if (storePlatform === 'nishikita') {
      if (code >= 207) return 2026
      return 2025
    }
    // keihan-karilun / nishinomiya-karilun / yao
    if (code >= 153) return 2026
    return 2025
  }

  const youtubeMatch = normalizedPropertyNumber.match(/^Y(\d{3})$/)
  if (!youtubeMatch) return null

  const code = Number(youtubeMatch[1])
  if (code >= 545) return 2026
  return 2025
}

function normalizeSnsPropertyPostDate(postDate: string | null | undefined, propertyNumber: string | null | undefined, storePlatform?: StoreSnsPropertyPlatform) {
  const rawDate = String(postDate || '').trim()
  if (!rawDate) return ''

  const propertyYear = getSnsPropertyYearFromPropertyNumber(propertyNumber, storePlatform)

  const isoDateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch
    const storedYear = Number(year)
    const fixedYear = propertyYear && storedYear < propertyYear ? propertyYear : storedYear
    return `${fixedYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const slashDateMatch = rawDate.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashDateMatch) {
    const [, year, month, day] = slashDateMatch
    const storedYear = Number(year)
    const fixedYear = propertyYear && storedYear < propertyYear ? propertyYear : storedYear
    return `${fixedYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const normalized = rawDate
    .replace(/\s+/g, '')
    .replace(/年/g, '/')
    .replace(/月/g, '/')
    .replace(/日/g, '')
    .replace(/\./g, '/')
    .replace(/-/g, '/')

  const monthDayMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!monthDayMatch) return rawDate

  if (!propertyYear) return rawDate

  const [, month, day] = monthDayMatch
  return `${propertyYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function sortSnsPropertyRowsByPropertyNumber<T extends { property_number: string; created_at?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (!a.property_number && !b.property_number) {
      return (b.created_at || '').localeCompare(a.created_at || '')
    }
    if (!a.property_number) return 1
    if (!b.property_number) return -1
    return b.property_number.localeCompare(a.property_number, 'ja')
  })
}

function SnsCellDropdown({
  value,
  options,
  onChange,
  onEdit,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  onEdit?: () => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (!boxRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    if (!open) return

    const updatePosition = () => {
      if (!boxRef.current) return
      const rect = boxRef.current.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom - 1,
        left: rect.left,
        width: Math.max(rect.width + 24, 120),
      })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  const mergedOptions = Array.from(new Set([...options, ...(value ? [value] : [])]))

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        className={`sns-dropdown-display${open ? ' is-open' : ''}`}
        title={value || '未設定'}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="sns-dropdown-text">{value || ''}</span>
        <span className="sns-dropdown-caret" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={menuRef} className="sns-dropdown-menu" style={menuStyle}>
          <button
            type="button"
            className={`sns-dropdown-option${value === '' ? ' is-active' : ''}`}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            -
          </button>
          {mergedOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`sns-dropdown-option${option === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            >
              {option}
            </button>
          ))}
          {onEdit && (
            <button
              type="button"
              className="sns-dropdown-edit-button"
              title="候補を編集"
              aria-label="候補を編集"
              onClick={() => {
                setOpen(false)
                onEdit()
              }}
            >
              ✎
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function SnsPropertyOptionEditorModal({
  editor,
  onClose,
  onChangeItem,
  onMoveItem,
  onRemoveItem,
  onAddItem,
  onSave,
}: {
  editor: SnsPropertyOptionEditorState
  onClose: () => void
  onChangeItem: (index: number, value: string) => void
  onMoveItem: (index: number, direction: 'up' | 'down') => void
  onRemoveItem: (index: number) => void
  onAddItem: () => void
  onSave: () => void
}) {
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-content progress-select-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{editor.title}の候補を編集</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="progress-select-editor-list">
          {editor.items.map((item, index) => (
            <div key={`${editor.field}-${index}`} className="progress-select-editor-row">
              <span className="progress-select-editor-grip" aria-hidden="true">⋮⋮</span>
              <input
                className="progress-select-editor-input"
                value={item}
                onChange={(e) => onChangeItem(index, e.target.value)}
                placeholder="候補名を入力"
              />
              <div className="progress-select-editor-actions">
                <button
                  type="button"
                  className="progress-select-editor-move-button"
                  onClick={() => onMoveItem(index, 'up')}
                  disabled={index === 0}
                  title="上へ移動"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="progress-select-editor-move-button"
                  onClick={() => onMoveItem(index, 'down')}
                  disabled={index === editor.items.length - 1}
                  title="下へ移動"
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                className="progress-select-editor-delete"
                onClick={() => onRemoveItem(index)}
                title="この候補を削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="progress-select-editor-add-wrap">
          <button type="button" className="secondary" onClick={onAddItem}>候補を追加</button>
        </div>

        <div className="form-actions" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" onClick={onClose}>キャンセル</button>
          <button type="button" className="primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  )
}

function SnsPropertyHeader({
  title,
  onEdit,
}: {
  title: string
  onEdit?: () => void
}) {
  return (
    <div className="sns-property-header-cell">
      <span>{title}</span>
      {onEdit && (
        <button
          type="button"
          className="sns-property-header-edit-button"
          title={`${title}の候補を編集`}
          aria-label={`${title}の候補を編集`}
          onClick={onEdit}
        >
          編集
        </button>
      )}
    </div>
  )
}

const defaultStockForm = { deadline: '', required_count: 1, label: '', note: '', achieved_count: 0 }

const DM_ACCOUNT_KARILUN = dmAccounts[0]
const DM_ACCOUNT_KEIHAN = dmAccounts[1]
const DM_ACCOUNT_NISHINOMIYA = dmAccounts[2]
const DM_ACCOUNT_YAO = dmAccounts[3]
const DM_ACCOUNT_KINDAI = dmAccounts[4]
const DM_ACCOUNT_KANGAKU = dmAccounts[5]
const MASTER_EMAIL = 'trg.yshini@gmail.com'
const DEFAULT_ALLOWED_EMAILS = [
  MASTER_EMAIL,
  'takara.webteam@gmail.com',
  'izumiyurina2322@gmail.com',
  'takarabaito3@gmail.com',
  'takarabaito1@gmail.com',
] as const

function isDateWithinRange(dateText: string, start: Date, end: Date): boolean {
  if (!dateText) return false
  const target = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(target.getTime())) return false
  return target >= start && target <= end
}

function formatDashboardScheduleDate(dateText: string, startTime?: string | null): string {
  if (!dateText) return '日付未設定'

  const target = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(target.getTime())) {
    return startTime ? `${dateText} ${startTime}` : dateText
  }

  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const baseText = `${target.getMonth() + 1}/${target.getDate()}(${weekdays[target.getDay()]})`
  return startTime ? `${baseText} ${startTime}` : baseText
}

type DmAreaLookup =
  | { mode: 'fixed'; area: string }
  | { mode: 'sheet'; sheetName: string }
  | { mode: 'blank' }
  | { mode: 'unknown' }

function getDmAreaLookup(account: string, propertyNumber: string): DmAreaLookup {
  const normalizedPropertyNumber = propertyNumber.trim().toUpperCase()

  if (account === DM_ACCOUNT_NISHINOMIYA) return { mode: 'fixed', area: '西宮市' }
  if (account === DM_ACCOUNT_YAO) return { mode: 'fixed', area: '八尾市' }
  if (account === DM_ACCOUNT_KINDAI) return { mode: 'fixed', area: '近大近く' }
  if (account === DM_ACCOUNT_KANGAKU) return { mode: 'fixed', area: '関学近く' }

  if (account === DM_ACCOUNT_KEIHAN) {
    return { mode: 'sheet', sheetName: '京阪' }
  }

  if (account === DM_ACCOUNT_KARILUN) {
    const prefix = normalizedPropertyNumber.charAt(0)
    if (prefix === 'K') return { mode: 'sheet', sheetName: 'TikTok(K000)' }
    if (prefix === 'G') return { mode: 'sheet', sheetName: 'INSUTA(G000)' }
    if (prefix === 'R' || prefix === 'Y') return { mode: 'blank' }
    return { mode: 'unknown' }
  }

  return { mode: 'unknown' }
}

const currency = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const integer = new Intl.NumberFormat('ja-JP')

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function buildDefaultAllowedAccounts(): AllowedAccount[] {
  return DEFAULT_ALLOWED_EMAILS.map((email) => ({
    id: email,
    email,
    is_master: email === MASTER_EMAIL,
    allow_outside_office: false,
    created_by: MASTER_EMAIL,
  }))
}

// WMO天気コード → 絵文字変換
function getWeatherEmoji(code: number | null | undefined): string {
  if (code === null || code === undefined) return ''
  if (code === 0) return '☀️'
  if (code === 1) return '🌤️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 55) return '🌦️'
  if (code <= 65) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌧️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

function getTaskItemPrimaryAssignee(item: TaskItem) {
  return item.assignees[0] || ''
}

function getUniqueTaskItemAssignees(assignees: string[]) {
  return Array.from(new Set(assignees.filter(Boolean)))
}

function getJstDateParts(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(baseDate)
  const year = Number(parts.find((part) => part.type === 'year')?.value || '0')
  const month = Number(parts.find((part) => part.type === 'month')?.value || '0')
  const day = Number(parts.find((part) => part.type === 'day')?.value || '0')

  return { year, month, day }
}

function buildMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function parseDateValue(value?: string | null) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return { year, month, day }
}

function buildRecurringDateInfo(value?: string | null) {
  const parsed = parseDateValue(value)
  if (!parsed) return { day: null, rule: null }

  const lastDay = getLastDayOfMonth(parsed.year, parsed.month)
  return {
    day: parsed.day,
    rule: (parsed.day === lastDay ? 'month_end' : 'same_day') as RecurringDateRule,
  }
}

function resolveRecurringDate(year: number, month: number, day?: number | null, rule?: RecurringDateRule | null) {
  if (!day || !rule) return ''

  const lastDay = getLastDayOfMonth(year, month)
  const resolvedDay = rule === 'month_end' ? lastDay : Math.min(day, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`
}

function normalizeTaskItemRecurringFields(
  form: Omit<TaskItem, 'id' | 'created_at'>,
  templateId?: string | null,
  generationMonth?: string | null,
  parentTemplateId?: string | null,
) {
  if (form.recurring_type !== 'monthly') {
    return {
      recurring_type: 'none' as TaskItemRecurrence,
      recurring_template_id: null,
      recurring_parent_template_id: null,
      recurring_generation_month: null,
      recurring_due_day: null,
      recurring_due_rule: null,
      recurring_work_day: null,
      recurring_work_rule: null,
      recurring_instance_key: null,
    }
  }

  const dueInfo = buildRecurringDateInfo(form.due_date)
  const workInfo = buildRecurringDateInfo(form.work_date)

  return {
    recurring_type: 'monthly' as TaskItemRecurrence,
    recurring_template_id: templateId || form.recurring_template_id || crypto.randomUUID(),
    recurring_parent_template_id: parentTemplateId || form.recurring_parent_template_id || null,
    recurring_generation_month: generationMonth || form.recurring_generation_month || buildMonthKey(getJstDateParts().year, getJstDateParts().month),
    recurring_due_day: dueInfo.day,
    recurring_due_rule: dueInfo.rule,
    recurring_work_day: workInfo.day,
    recurring_work_rule: workInfo.rule,
    recurring_instance_key: null,
  }
}

function buildTaskItemRows(form: Omit<TaskItem, 'id' | 'created_at'>) {
  const uniqueAssignees = getUniqueTaskItemAssignees(form.assignees)
  const assigneeRows = uniqueAssignees.length > 0 ? uniqueAssignees : ['']
  const now = getJstDateParts()
  const generationMonth = form.recurring_type === 'monthly'
    ? (form.recurring_generation_month || buildMonthKey(now.year, now.month))
    : null

  return assigneeRows.map((assignee) => {
    const rowTemplateId = form.recurring_type === 'monthly'
      ? (
          assigneeRows.length === 1 && form.recurring_template_id
            ? form.recurring_template_id
            : crypto.randomUUID()
        )
      : null
    const recurringFields = normalizeTaskItemRecurringFields(
      form,
      rowTemplateId,
      generationMonth,
      form.recurring_parent_template_id || null,
    )

    return {
      ...form,
      id: crypto.randomUUID(),
      assignees: assignee ? [assignee] : [],
      ...recurringFields,
      recurring_instance_key: recurringFields.recurring_type === 'monthly' && recurringFields.recurring_template_id && recurringFields.recurring_generation_month
        ? `${recurringFields.recurring_template_id}:${recurringFields.recurring_generation_month}`
        : null,
    }
  })
}

function buildTaskItemRecurringForm(form: Omit<TaskItem, 'id' | 'created_at'>, parentItem?: TaskItem | null) {
  if (!parentItem) {
    return {
      ...form,
      recurring_parent_template_id: null,
    }
  }

  if (parentItem.recurring_type === 'monthly' && parentItem.recurring_template_id) {
    return {
      ...form,
      recurring_type: 'monthly' as TaskItemRecurrence,
      recurring_parent_template_id: parentItem.recurring_template_id,
    }
  }

  return {
    ...form,
    recurring_type: 'none' as TaskItemRecurrence,
    recurring_parent_template_id: null,
    recurring_template_id: null,
    recurring_generation_month: null,
    recurring_due_day: null,
    recurring_due_rule: null,
    recurring_work_day: null,
    recurring_work_rule: null,
    recurring_instance_key: null,
  }
}

async function notifyTaskEvent(payload: {
  type: 'new' | 'updated' | 'deleted' | 'completed'
  taskName: string
  dueDate?: string
  workDate?: string
  priority?: Priority
  assignees: string[]
  creator?: string
  members: Member[]
}) {
  const notifySecret = import.meta.env.VITE_NOTIFY_SECRET as string | undefined
  const response = await fetch('/api/notify-task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(notifySecret ? { 'x-notify-secret': notifySecret } : {}),
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || 'Slack通知に失敗しました')
  }
}

function getSlackNotificationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'invalid_auth') {
    return 'Slackの接続キーが無効です。VercelのSLACK_BOT_TOKENを新しい値に更新してください。'
  }
  if (message === 'channel_not_found') {
    return 'Slackの通知先チャンネルが見つかりません。VercelのSLACK_CHANNEL_IDを確認してください。'
  }
  if (message === 'not_in_channel') {
    return 'Slackアプリが通知先チャンネルに入っていません。Slackでアプリをチャンネルに追加してください。'
  }
  return message || 'Slack通知に失敗しました。'
}

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const closeBushoModal = useCallback((selectedDate?: string) => {
    setShowModal(false)
    setEditingBushoId(null)
    setTaskError(null)
    setBushoForm({ ...defaultBushoForm, date: selectedDate || new Date().toISOString().slice(0, 10) })
  }, [])

  const [tasks, setTasks] = useState<Task[]>([])
  const [posts, setPosts] = useState<SnsPost[]>([])
  const [recruitment, setRecruitment] = useState<RecruitmentRecord[]>([])
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState('all')
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isPrimaryNavCollapsed, setIsPrimaryNavCollapsed] = useState(() => {
    return localStorage.getItem('primaryNavCollapsed') === 'true'
  })

  useEffect(() => {
    localStorage.setItem('primaryNavCollapsed', String(isPrimaryNavCollapsed))
    if (isPrimaryNavCollapsed) setIsMobileNavOpen(false)
  }, [isPrimaryNavCollapsed])

  // 新規追加フォーム
  const [taskForm, setTaskForm] = useState(defaultTaskForm)
  const [snsForm, setSnsForm] = useState(defaultSnsForm)
  const [recruitmentForm, setRecruitmentForm] = useState(defaultRecruitmentForm)

  // インライン編集
  const [taskInlineId, setTaskInlineId] = useState<string | null>(null)
  const [taskInlineForm, setTaskInlineForm] = useState<Omit<Task, 'id'>>(defaultTaskForm)
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('all')
  const [taskShowCompleted, setTaskShowCompleted] = useState(true)
  const [snsInlineId, setSnsInlineId] = useState<string | null>(null)
  const [snsInlineForm, setSnsInlineForm] = useState<Omit<SnsPost, 'id'>>(defaultSnsForm)
  const [recruitmentInlineId, setRecruitmentInlineId] = useState<string | null>(null)
  const [recruitmentInlineForm, setRecruitmentInlineForm] = useState<Omit<RecruitmentRecord, 'id'>>(defaultRecruitmentForm)

  // タスク管理
  const [taskItems, setTaskItems] = useState<TaskItem[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [taskItemForm, setTaskItemForm] = useState(defaultTaskItemForm)
  const [taskItemInlineId, setTaskItemInlineId] = useState<string | null>(null)
  const [taskItemInlineForm, setTaskItemInlineForm] = useState<Omit<TaskItem, 'id' | 'created_at'>>(defaultTaskItemForm)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskFilter, setTaskFilter] = useState<'all' | TaskItemStatus | 'overdue'>('all')
  const [taskItemAssigneeFilter, setTaskItemAssigneeFilter] = useState('all')
  const [taskItemShowCompleted, setTaskItemShowCompleted] = useState(false)
  const [expandedParentTaskIds, setExpandedParentTaskIds] = useState<string[]>([])
  const [taskError, setTaskError] = useState<string | null>(null)
  const [memoToView, setMemoToView] = useState<string | null>(null)
  const [snsMemoEditor, setSnsMemoEditor] = useState<SnsMemoEditorState | null>(null)
  const [snsMemoDraft, setSnsMemoDraft] = useState('')
  const [memberEditId, setMemberEditId] = useState<string | null>(null)
  const [memberEditSlack, setMemberEditSlack] = useState('')
  const [memberSettingOpen, setMemberSettingOpen] = useState(false)

  // 反響管理
  const [hankyoRecords, setHankyoRecords] = useState<HankyoRecord[]>([])
  const [hankyoForm, setHankyoForm] = useState(defaultHankyoForm)
  const [hankyoInlineId, setHankyoInlineId] = useState<string | null>(null)
  const [hankyoInlineForm, setHankyoInlineForm] = useState<Omit<HankyoRecord, 'id' | 'created_at' | 'updated_at'>>(defaultHankyoForm)
  const [hankyoSearch, setHankyoSearch] = useState('')
  const [hankyoMonthFilters, setHankyoMonthFilters] = useState<string[]>([String(new Date().getMonth() + 1)])
  const [hankyoAccountFilters, setHankyoAccountFilters] = useState<string[]>([])
  const [hankyoTriggerFilters, setHankyoTriggerFilters] = useState<string[]>([])
  const [hankyoMediaFilters, setHankyoMediaFilters] = useState<string[]>([])
  const [hankyoInquiryTypeFilters, setHankyoInquiryTypeFilters] = useState<string[]>([])
  const [hankyoContactMethodFilters, setHankyoContactMethodFilters] = useState<string[]>([])
  const [hankyoMoveInFilters, setHankyoMoveInFilters] = useState<string[]>([])
  const [hankyoStoreFilters, setHankyoStoreFilters] = useState<string[]>([])
  const [hankyoOpenFilter, setHankyoOpenFilter] = useState<string | null>(null)
  const [checkedHankyoIds, setCheckedHankyoIds] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)

  // DM管理
  const [dmRecords, setDmRecords] = useState<DMRecord[]>([])
  const [dmForm, setDmForm] = useState(defaultDmForm)
  const [dmInlineId, setDmInlineId] = useState<string | null>(null)
  const [dmInlineForm, setDmInlineForm] = useState<Omit<DMRecord, 'id' | 'created_at'>>(defaultDmForm)
  const [dmMonthFilter, setDmMonthFilter] = useState('all')
  const [dmAccountFilter, setDmAccountFilter] = useState('all')
  const [dmPage, setDmPage] = useState(1)
  const [dmAreaLoading, setDmAreaLoading] = useState(false)
  const [activeSnsPropertyPlatform, setActiveSnsPropertyPlatform] = useState<SnsPropertyPlatform>('sokanri')
  const [tiktokProperties, setTiktokProperties] = useState<TiktokPropertyRecord[]>([])
  const [instagramProperties, setInstagramProperties] = useState<InstagramPropertyRecord[]>([])
  const [youtubeProperties, setYoutubeProperties] = useState<YoutubePropertyRecord[]>([])
  const [recruitmentSnsProperties, setRecruitmentSnsProperties] = useState<RecruitmentSnsPropertyRecord[]>([])
  const [storeSnsProperties, setStoreSnsProperties] = useState<Record<StoreSnsPropertyPlatform, StoreSnsPropertyRecord[]>>({
    'keihan-karilun': [],
    'nishinomiya-karilun': [],
    nagase: [],
    nishikita: [],
    yao: [],
  })
  const [snsPropertySearch, setSnsPropertySearch] = useState<Record<SnsPropertyPlatform, string>>({
    sokanri: '',
    tiktok: '',
    instagram: '',
    youtube: '',
    'keihan-karilun': '',
    'nishinomiya-karilun': '',
    nagase: '',
    nishikita: '',
    yao: '',
    recruitment: '',
  })
  const [snsPropertyPage, setSnsPropertyPage] = useState<Record<SnsPropertyPlatform, number>>({
    sokanri: 1,
    tiktok: 1,
    instagram: 1,
    youtube: 1,
    'keihan-karilun': 1,
    'nishinomiya-karilun': 1,
    nagase: 1,
    nishikita: 1,
    yao: 1,
    recruitment: 1,
  })
  const [snsPropertyTotalCount, setSnsPropertyTotalCount] = useState<Record<SnsPropertyPlatform, number>>({
    sokanri: 0,
    tiktok: 0,
    instagram: 0,
    youtube: 0,
    'keihan-karilun': 0,
    'nishinomiya-karilun': 0,
    nagase: 0,
    nishikita: 0,
    yao: 0,
    recruitment: 0,
  })
  const [snsPropertyOptions, setSnsPropertyOptions] = useState<Record<SnsPropertySelectField, string[]>>(() => ({
    wp_registered: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.wp_registered,
      ...(getStoredSnsPropertyOptions('wp_registered') || []),
    ]),
    aos_registered: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.aos_registered,
      ...(getStoredSnsPropertyOptions('aos_registered') || []),
    ]),
    acquisition_source: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.acquisition_source,
      ...(getStoredSnsPropertyOptions('acquisition_source') || []),
    ]),
    tiktok_reserved: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.tiktok_reserved,
      ...(getStoredSnsPropertyOptions('tiktok_reserved') || []),
    ]),
    tiktok_wp: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.tiktok_wp,
      ...(getStoredSnsPropertyOptions('tiktok_wp') || []),
    ]),
    instagram_reserved: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.instagram_reserved,
      ...(getStoredSnsPropertyOptions('instagram_reserved') || []),
    ]),
    instagram_wp: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.instagram_wp,
      ...(getStoredSnsPropertyOptions('instagram_wp') || []),
    ]),
    youtube_reserved: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.youtube_reserved,
      ...(getStoredSnsPropertyOptions('youtube_reserved') || []),
    ]),
    youtube_wp: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.youtube_wp,
      ...(getStoredSnsPropertyOptions('youtube_wp') || []),
    ]),
    threads_post_date: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.threads_post_date,
      ...(getStoredSnsPropertyOptions('threads_post_date') || []),
    ]),
    post_text: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.post_text,
      ...(getStoredSnsPropertyOptions('post_text') || []),
    ]),
    post_reserved: normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS.post_reserved,
      ...(getStoredSnsPropertyOptions('post_reserved') || []),
    ]),
  }))
  const [snsPropertyOptionEditor, setSnsPropertyOptionEditor] = useState<SnsPropertyOptionEditorState | null>(null)
  const [snsPropertyCreatePlatform, setSnsPropertyCreatePlatform] = useState<SnsPropertyPlatform | null>(null)
  const [snsPropertyCreateSaving, setSnsPropertyCreateSaving] = useState(false)
  const [tiktokPropertyForm, setTiktokPropertyForm] = useState(defaultTiktokPropertyForm)
  const [instagramPropertyForm, setInstagramPropertyForm] = useState(defaultInstagramPropertyForm)
  const [youtubePropertyForm, setYoutubePropertyForm] = useState(defaultYoutubePropertyForm)
  const [storeSnsPropertyForm, setStoreSnsPropertyForm] = useState(defaultStoreSnsPropertyForm)
  const [recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm] = useState(defaultRecruitmentSnsPropertyForm)
  const [snsTiktokSheetSyncing, setSnsTiktokSheetSyncing] = useState(false)
  const [snsInstagramSheetSyncing, setSnsInstagramSheetSyncing] = useState(false)
  const [snsYoutubeSheetSyncing, setSnsYoutubeSheetSyncing] = useState(false)
  const [storeSnsSheetSyncing, setStoreSnsSheetSyncing] = useState<StoreSnsPropertyPlatform | null>(null)
  const snsPropertySheetSyncTimers = useRef<Partial<Record<Exclude<SnsPropertyPlatform, 'sokanri' | 'recruitment'>, number>>>({})
  const [snsPostingRules, setSnsPostingRules] = useState<SnsPostingRule[]>([])
  const [sokanriData, setSokanriData] = useState<Record<string, string[]>>({})
  const [sokanriLoading, setSokanriLoading] = useState(false)
  const [sokanriSettingsOpen, setSokanriSettingsOpen] = useState(false)
  const [sokanriWeekOffset, setSokanriWeekOffset] = useState(0)

  // ストック管理
  const [stockRecords, setStockRecords] = useState<StockRecord[]>([])
  const [stockForm, setStockForm] = useState(defaultStockForm)
  const [stockInlineId, setStockInlineId] = useState<string | null>(null)
  const [stockInlineForm, setStockInlineForm] = useState(defaultStockForm)
  const [stockCalendarMonth, setStockCalendarMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [stockAttendanceMap, setStockAttendanceMap] = useState<Record<string, string[]>>({})
  const [stockHonmachiDateMap, setStockHonmachiDateMap] = useState<Record<string, boolean>>({})
  const [weatherMap, setWeatherMap] = useState<Record<string, number>>({})
  const [bushoSchedules, setBushoSchedules] = useState<BushoSchedule[]>([])
  const [bushoForm, setBushoForm] = useState(defaultBushoForm)
  const [editingBushoId, setEditingBushoId] = useState<string | null>(null)
  const [bushoCalendarMonth, setBushoCalendarMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [bushoFilterDept, setBushoFilterDept] = useState<string>('全て')
  const [bushoSelectedDate, setBushoSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [jishaShukyakuRecords, setJishaShukyakuRecords] = useState<JishaShukyakuRecord[]>([])
  const [jishaViewMode, setJishaViewMode] = useState<'単月' | '累計'>('累計')
  const [jishaYear, setJishaYear] = useState(new Date().getFullYear())
  const [jishaStartMonth, setJishaStartMonth] = useState(1)
  const [jishaMonth, setJishaMonth] = useState(new Date().getMonth() + 1)
  const [jishaCellEditing, setJishaCellEditing] = useState<string | null>(null)
  const [jishaCellValue, setJishaCellValue] = useState('')
  const [jishaSavingCell, setJishaSavingCell] = useState<string | null>(null)
  const [jishaImporting, setJishaImporting] = useState(false)
  const [jishaImportDragActive, setJishaImportDragActive] = useState(false)
  const [jishaImportMessage, setJishaImportMessage] = useState('')
  const [jishaImportMessageType, setJishaImportMessageType] = useState<'success' | 'error'>('success')
  const jishaFileInputRef = useRef<HTMLInputElement | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [allowedAccounts, setAllowedAccounts] = useState<AllowedAccount[]>(buildDefaultAllowedAccounts())
  const [allowedAccountForm, setAllowedAccountForm] = useState('')
  const [allowedAccountSaving, setAllowedAccountSaving] = useState(false)
  const [allowedAccountMessage, setAllowedAccountMessage] = useState('')
  const [showAllowedAccountsModal, setShowAllowedAccountsModal] = useState(false)

  const isMasterUser = normalizeEmail(currentUserEmail || '') === MASTER_EMAIL
  const currentAllowedAccount = allowedAccounts.find((account) => normalizeEmail(account.email) === normalizeEmail(currentUserEmail || ''))
  const canUseOutsideOffice = Boolean(currentAllowedAccount?.allow_outside_office)

  async function fetchTasks() {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    if (data) setTasks(data as Task[])
  }

  async function fetchPosts() {
    const { data } = await supabase.from('sns_posts').select('*').order('created_at', { ascending: false })
    if (data) setPosts(data as SnsPost[])
  }

  async function fetchRecruitment() {
    const { data } = await supabase.from('recruitment').select('*').order('created_at', { ascending: false })
    if (data) setRecruitment(data as RecruitmentRecord[])
  }

  async function syncMonthlyRecurringTaskItems(items: TaskItem[]) {
    const { year, month } = getJstDateParts()
    const currentMonth = buildMonthKey(year, month)
    const recurringItems = items.filter((item) => item.recurring_type === 'monthly' && item.recurring_template_id)
    if (recurringItems.length === 0) return false

    const itemsByTemplate = recurringItems.reduce((acc, item) => {
      const key = item.recurring_template_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {} as Record<string, TaskItem[]>)

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
    }, {} as Record<string, TaskItem>)

    const currentMonthItemsByTemplate = recurringItems.reduce((acc, item) => {
      if (item.recurring_generation_month !== currentMonth || !item.recurring_template_id) return acc
      const key = item.recurring_template_id
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {} as Record<string, TaskItem[]>)

    const sourceRows = Object.values(latestItemByTemplate)
      .filter((item) => !currentMonthItemsByTemplate[item.recurring_template_id as string])
      .sort((a, b) => {
        if (!!a.parent_task_id === !!b.parent_task_id) return 0
        return a.parent_task_id ? 1 : -1
      })

    const newRowIdBySourceId = new Map<string, string>()
    const rowsToInsert: TaskItem[] = []

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
        completed_notified: false,
        slack_notified: false,
        parent_task_id: nextParentId,
        recurring_type: 'monthly',
        recurring_generation_month: currentMonth,
        recurring_instance_key: `${item.recurring_template_id}:${currentMonth}`,
      })

      newRowIdBySourceId.set(item.id, nextId)
    })

    if (rowsToInsert.length === 0) return false

    const { error } = await supabase.from('task_items').upsert(rowsToInsert, {
      onConflict: 'recurring_instance_key',
      ignoreDuplicates: true,
    })

    if (error) {
      console.error('Monthly recurring task sync error:', error)
      return false
    }

    return true
  }

  async function fetchTaskItems(skipSync = false) {
    const { data } = await supabase.from('task_items').select('*').order('created_at', { ascending: false })
    if (!data) return

    const items = data as TaskItem[]
    if (!skipSync) {
      const inserted = await syncMonthlyRecurringTaskItems(items)
      if (inserted) {
        await fetchTaskItems(true)
        return
      }
    }

    setTaskItems(items)
  }

  async function fetchMembers() {
    const { data } = await supabase.from('members').select('*').order('created_at')
    if (data) setMembers(data as Member[])
  }

  async function fetchHankyo() {
    const { data } = await supabase.from('hankyo').select('*').order('inquiry_date', { ascending: false }).order('created_at', { ascending: false })
    if (data) {
      setHankyoRecords(data as HankyoRecord[])
      const confirmedIds = new Set<string>((data as HankyoRecord[]).filter(r => r.confirmed).map(r => r.id))
      setCheckedHankyoIds(confirmedIds)
    }
  }

  async function fetchDm() {
    const { data } = await supabase.from('dm').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })
    if (data) setDmRecords(data as DMRecord[])
  }

  async function fetchSnsPropertyPage<T extends { property_number: string; created_at?: string }>(
    tableName: SnsPropertyTableName,
    platform: SnsPropertyPlatform,
    page: number,
    search: string,
    setter: React.Dispatch<React.SetStateAction<T[]>>,
  ) {
    const normalizedSearch = normalizeSnsPropertySearch(search)
    const pageInfo = buildSnsPropertyPageInfo(Number.MAX_SAFE_INTEGER, page)
    let query = supabase
      .from(tableName)
      .select('*', { count: 'exact' })
      .order('property_number', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (normalizedSearch) {
      query = query.ilike('property_number', `%${normalizedSearch}%`)
    }

    const { data, count, error } = await query.range(
      (pageInfo.currentPage - 1) * SNS_PROPERTY_PAGE_SIZE,
      pageInfo.currentPage * SNS_PROPERTY_PAGE_SIZE - 1,
    )

    if (error) {
      alert(`SNS物件データの読込に失敗しました。\n\n${error.message}`)
      return
    }

    const totalCount = count ?? 0
    const nextPageInfo = buildSnsPropertyPageInfo(totalCount, page)
    setSnsPropertyTotalCount((prev) => ({ ...prev, [platform]: totalCount }))
    if (nextPageInfo.currentPage !== page) {
      setSnsPropertyPage((prev) => ({ ...prev, [platform]: nextPageInfo.currentPage }))
    }
    setter(sortSnsPropertyRowsByPropertyNumber((data || []) as T[]))
  }

  const fetchTiktokProperties = useCallback(async () => {
    await fetchSnsPropertyPage('sns_tiktok_properties', 'tiktok', snsPropertyPage.tiktok, snsPropertySearch.tiktok, setTiktokProperties)
  }, [snsPropertyPage.tiktok, snsPropertySearch.tiktok])

  const fetchInstagramProperties = useCallback(async () => {
    await fetchSnsPropertyPage('sns_instagram_properties', 'instagram', snsPropertyPage.instagram, snsPropertySearch.instagram, setInstagramProperties)
  }, [snsPropertyPage.instagram, snsPropertySearch.instagram])

  const fetchYoutubeProperties = useCallback(async () => {
    await fetchSnsPropertyPage('sns_youtube_properties', 'youtube', snsPropertyPage.youtube, snsPropertySearch.youtube, setYoutubeProperties)
  }, [snsPropertyPage.youtube, snsPropertySearch.youtube])

  const fetchRecruitmentSnsProperties = useCallback(async () => {
    const normalizedSearch = snsPropertySearch.recruitment.trim()
    const pageInfo = buildSnsPropertyPageInfo(Number.MAX_SAFE_INTEGER, snsPropertyPage.recruitment)
    let query = supabase
      .from('sns_recruitment_properties')
      .select('*', { count: 'exact' })
      .order('post_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (normalizedSearch) {
      query = query.or(`title.ilike.%${normalizedSearch}%,property_number.ilike.%${normalizedSearch}%`)
    }

    const { data, count, error } = await query.range(
      (pageInfo.currentPage - 1) * SNS_PROPERTY_PAGE_SIZE,
      pageInfo.currentPage * SNS_PROPERTY_PAGE_SIZE - 1,
    )

    if (error) {
      alert(`採用一覧の読込に失敗しました。\n\n${error.message}`)
      return
    }

    const totalCount = count ?? 0
    const nextPageInfo = buildSnsPropertyPageInfo(totalCount, snsPropertyPage.recruitment)
    setSnsPropertyTotalCount((prev) => ({ ...prev, recruitment: totalCount }))
    if (nextPageInfo.currentPage !== snsPropertyPage.recruitment) {
      setSnsPropertyPage((prev) => ({ ...prev, recruitment: nextPageInfo.currentPage }))
    }
    setRecruitmentSnsProperties((data || []) as RecruitmentSnsPropertyRecord[])
  }, [snsPropertyPage.recruitment, snsPropertySearch.recruitment])

  const fetchStoreSnsProperties = useCallback(async (platform: StoreSnsPropertyPlatform) => {
    await fetchSnsPropertyPage(
      storeSnsPropertyTableMap[platform],
      platform,
      snsPropertyPage[platform],
      snsPropertySearch[platform],
      (rows) => {
        setStoreSnsProperties((prev) => ({ ...prev, [platform]: rows as StoreSnsPropertyRecord[] }))
      },
    )
  }, [snsPropertyPage, snsPropertySearch])

  const handleSnsPropertyPromoted = useCallback((target: 'tiktok' | 'instagram' | 'youtube' | 'recruitment' | StoreSnsPropertyPlatform) => {
    if (target === 'tiktok') {
      fetchTiktokProperties()
      scheduleSnsPropertySheetSync(target)
      return
    }
    if (target === 'instagram') {
      fetchInstagramProperties()
      scheduleSnsPropertySheetSync(target)
      return
    }
    if (storeSnsPropertyPlatforms.includes(target as StoreSnsPropertyPlatform)) {
      void fetchStoreSnsProperties(target as StoreSnsPropertyPlatform)
      scheduleSnsPropertySheetSync(target as StoreSnsPropertyPlatform)
      return
    }
    if (target === 'recruitment') {
      void fetchRecruitmentSnsProperties()
      return
    }
    fetchYoutubeProperties()
    scheduleSnsPropertySheetSync(target)
  }, [fetchInstagramProperties, fetchRecruitmentSnsProperties, fetchStoreSnsProperties, fetchTiktokProperties, fetchYoutubeProperties])

  const isStoreSnsPropertyPlatform = useCallback((platform: SnsPropertyPlatform): platform is StoreSnsPropertyPlatform => {
    return storeSnsPropertyPlatforms.includes(platform as StoreSnsPropertyPlatform)
  }, [])

  const fetchSokanriData = useCallback(async () => {
    setSokanriLoading(true)
    const base = new Date()
    base.setDate(base.getDate() + sokanriWeekOffset * 7)
    const todayStr = base.toISOString().slice(0, 10)
    const end = new Date(base)
    end.setDate(end.getDate() + 6)
    const endStr = end.toISOString().slice(0, 10)

    const { data: rules } = await supabase.from('sns_posting_rules').select('*')
    setSnsPostingRules((rules || []) as SnsPostingRule[])

    const result: Record<string, string[]> = {}
    const karilunMap = [
      { key: 'karilun-tiktok', table: 'sns_tiktok_properties' },
      { key: 'karilun-instagram', table: 'sns_instagram_properties' },
      { key: 'karilun-youtube', table: 'sns_youtube_properties' },
    ]

    for (const { key, table } of karilunMap) {
      const { data } = await supabase
        .from(table)
        .select('post_date,property_number')
        .gte('post_date', todayStr)
        .lte('post_date', endStr)

      result[key] = ((data || []) as { post_date?: string | null; property_number?: string | null }[])
        .map((row) => normalizeSnsPropertyPostDate(row.post_date, row.property_number).slice(0, 10))
        .filter((date): date is string => Boolean(date))
    }

    const storeMap = [
      { accountKey: 'keihan', table: 'sns_keihan_karilun_properties', platforms: ['tiktok', 'instagram'] },
      { accountKey: 'nishinomiya', table: 'sns_nishinomiya_karilun_properties', platforms: ['tiktok', 'instagram', 'youtube'] },
      { accountKey: 'nagase', table: 'sns_nagase_properties', platforms: ['tiktok', 'instagram', 'youtube'] },
      { accountKey: 'nishikita', table: 'sns_nishikita_properties', platforms: ['tiktok', 'instagram', 'youtube'] },
      { accountKey: 'yao', table: 'sns_yao_properties', platforms: ['tiktok', 'instagram', 'youtube'] },
    ]
    const reservedColMap: Record<string, 'tiktok_reserved' | 'instagram_reserved' | 'youtube_reserved' | 'threads_post_date'> = {
      tiktok: 'tiktok_reserved',
      instagram: 'instagram_reserved',
      youtube: 'youtube_reserved',
      threads: 'threads_post_date',
    }

    const prevYearTodayStr = `${Number(todayStr.slice(0, 4)) - 1}${todayStr.slice(4)}`
    const prevYearEndStr = `${Number(endStr.slice(0, 4)) - 1}${endStr.slice(4)}`

    for (const { accountKey, table, platforms } of storeMap) {
      const [{ data: rowsCurrent }, { data: rowsPrev }] = await Promise.all([
        supabase
          .from(table)
          .select('post_date,property_number,tiktok_reserved,instagram_reserved,youtube_reserved,threads_post_date')
          .gte('post_date', todayStr)
          .lte('post_date', endStr),
        supabase
          .from(table)
          .select('post_date,property_number,tiktok_reserved,instagram_reserved,youtube_reserved,threads_post_date')
          .gte('post_date', prevYearTodayStr)
          .lte('post_date', prevYearEndStr),
      ])
      const rows = [...(rowsCurrent || []), ...(rowsPrev || [])]

      const typedRows = (rows || []) as {
        post_date?: string | null
        property_number?: string | null
        tiktok_reserved?: string | null
        instagram_reserved?: string | null
        youtube_reserved?: string | null
        threads_post_date?: string | null
      }[]

      for (const platform of platforms) {
        const apKey = `${accountKey}-${platform}`
        const col = reservedColMap[platform]
        const byDate: Record<string, typeof typedRows> = {}
        for (const row of typedRows) {
          const date = normalizeSnsPropertyPostDate(row.post_date, row.property_number, accountKey as StoreSnsPropertyPlatform).slice(0, 10)
          if (!date || date < todayStr || date > endStr) continue
          if (!byDate[date]) byDate[date] = []
          byDate[date].push(row)
        }

        const doneDates: string[] = []
        for (const [date, dateRows] of Object.entries(byDate)) {
          const allDone = dateRows.every((row) => row[col] && String(row[col]).includes('〇'))
          if (allDone) doneDates.push(date)
        }
        result[apKey] = doneDates
      }
    }

    setSokanriData(result)
    setSokanriLoading(false)
  }, [sokanriWeekOffset])

  async function saveSokanriRule(apKey: string, dayOfWeek: number, checked: boolean) {
    if (checked) {
      await supabase.from('sns_posting_rules').upsert({ account_platform_key: apKey, rule_type: 'weekday', day_of_week: dayOfWeek })
    } else {
      await supabase.from('sns_posting_rules').delete().eq('account_platform_key', apKey).eq('day_of_week', dayOfWeek)
    }
    const { data } = await supabase.from('sns_posting_rules').select('*')
    setSnsPostingRules((data || []) as SnsPostingRule[])
  }

  async function saveIntervalRule(apKey: string, intervalDays: number, referenceDate: string) {
    await supabase
      .from('sns_posting_rules')
      .delete()
      .eq('account_platform_key', apKey)
      .eq('rule_type', 'interval')

    await supabase.from('sns_posting_rules').insert({
      account_platform_key: apKey,
      rule_type: 'interval',
      interval_days: intervalDays,
      reference_date: referenceDate,
      day_of_week: null,
    })

    const { data } = await supabase.from('sns_posting_rules').select('*')
    setSnsPostingRules((data || []) as SnsPostingRule[])
  }

  async function deleteIntervalRule(apKey: string) {
    await supabase
      .from('sns_posting_rules')
      .delete()
      .eq('account_platform_key', apKey)
      .eq('rule_type', 'interval')

    const { data } = await supabase.from('sns_posting_rules').select('*')
    setSnsPostingRules((data || []) as SnsPostingRule[])
  }

  function getSokanriCellStatus(apKey: string, date: Date): '✅' | '⚠️' | '─' {
    const dayOfWeek = date.getDay()
    const dateStr = date.toISOString().slice(0, 10)

    const hasWeekdayRule = snsPostingRules.some(
      (rule) => rule.account_platform_key === apKey && rule.rule_type === 'weekday' && rule.day_of_week === dayOfWeek,
    )

    const intervalRule = snsPostingRules.find(
      (rule) => rule.account_platform_key === apKey && rule.rule_type === 'interval' && rule.reference_date && rule.interval_days,
    )
    let hasIntervalRule = false
    if (intervalRule?.reference_date && intervalRule.interval_days) {
      const ref = new Date(intervalRule.reference_date)
      const target = new Date(dateStr)
      const diffDays = Math.round((target.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24))
      hasIntervalRule = diffDays >= 0 && diffDays % intervalRule.interval_days === 0
    }

    if (!hasWeekdayRule && !hasIntervalRule) return '─'

    const done = (sokanriData[apKey] || []).includes(dateStr)
    return done ? '✅' : '⚠️'
  }

  const sokanriDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + sokanriWeekOffset * 7 + index)
    return date
  })

  async function fetchStock() {
    const { data } = await supabase.from('stock').select('*').order('deadline', { ascending: true })
    if (data) setStockRecords(data as StockRecord[])
  }

  async function fetchBusho() {
    const { data, error } = await supabase.from('busho_schedules').select('*').order('date', { ascending: true })
    if (error) {
      setTaskError(`部署予定の読込失敗: ${error.message}`)
      return
    }
    setBushoSchedules(data as BushoSchedule[])
  }

  async function fetchJishaShukyaku() {
    const { data } = await supabase.from('jisha_shukyaku').select('*')
    if (data) setJishaShukyakuRecords(data as JishaShukyakuRecord[])
  }

  async function importJishaExcelFiles(files: File[]) {
    if (files.length === 0) return

    setJishaImporting(true)
    setJishaImportMessage('')
    setJishaImportMessageType('success')
    setJishaImportDragActive(false)

    try {
      const nextRecords = [...jishaShukyakuRecords]
      let latestImportedMonth = 0

      for (const file of files) {
        const media = getJishaMediaFromFileName(file.name)
        if (!media) {
          throw new Error(`ファイル名「${file.name}」から媒体名を判断できませんでした。`)
        }

        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })
        const rows = extractJishaRowsFromWorkbook(workbook)

        if (rows.length === 0) {
          throw new Error(`ファイル「${file.name}」に「1月」「2月」のような月タブが見つかりませんでした。`)
        }

        latestImportedMonth = Math.max(
          latestImportedMonth,
          ...rows.map((row) => row.month),
        )

        for (const row of rows) {
          const existingIndex = nextRecords.findIndex((record) =>
            record.year === jishaYear &&
            record.month === row.month &&
            record.media === media &&
            record.row_type === row.rowType,
          )

          if (existingIndex >= 0) {
            const existing = nextRecords[existingIndex]
            const hasChanged = JISHA_METRIC_FIELDS.some((field) => existing[field] !== row.values[field])
            if (!hasChanged) continue

            const { data, error } = await supabase
              .from('jisha_shukyaku')
              .update(row.values)
              .eq('id', existing.id)
              .select()
              .single()

            if (error) throw error
            if (data) nextRecords[existingIndex] = data as JishaShukyakuRecord
            continue
          }

          const insertPayload = {
            year: jishaYear,
            month: row.month,
            media,
            row_type: row.rowType,
            hankyo_count: row.values.hankyo_count,
            hankyo_raikyo: row.values.hankyo_raikyo,
            shinki_count: row.values.shinki_count,
            keiyaku_count: row.values.keiyaku_count,
            koken_uriaage: row.values.koken_uriaage,
          }

          const { data, error } = await supabase.from('jisha_shukyaku').insert(insertPayload).select().single()
          if (error) throw error
          if (data) nextRecords.push(data as JishaShukyakuRecord)
        }
      }

      setJishaShukyakuRecords(nextRecords)
      if (latestImportedMonth > 0) {
        setJishaMonth(latestImportedMonth)
        setJishaViewMode('単月')
      }
      await fetchJishaShukyaku()
      setJishaImportMessageType('success')
      setJishaImportMessage(`最終更新: ${new Date().toLocaleString('ja-JP')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Excelの取込に失敗しました。'
      setJishaImportMessageType('error')
      setJishaImportMessage(`取込に失敗しました: ${message}`)
    } finally {
      setJishaImporting(false)
      if (jishaFileInputRef.current) jishaFileInputRef.current.value = ''
    }
  }

  // Open-Meteo から大阪の天気取得（APIキー不要）
  async function fetchAllowedAccounts() {
    const fallback = buildDefaultAllowedAccounts()
    const { data, error } = await supabase
      .from('allowed_accounts')
      .select('*')
      .order('is_master', { ascending: false })
      .order('email', { ascending: true })

    if (error) {
      setAllowedAccounts(fallback)
      return fallback
    }

    const rows = (data as AllowedAccount[] | null)?.map((row) => ({
      ...row,
      email: normalizeEmail(row.email),
      allow_outside_office: Boolean(row.allow_outside_office),
    })) ?? []

    if (rows.length === 0) {
      setAllowedAccounts(fallback)
      return fallback
    }

    setAllowedAccounts(rows)
    return rows
  }

  const getSnsPropertySelectOptions = useCallback((field: SnsPropertySelectField) => {
    if (field === 'acquisition_source') {
      return snsPropertyOptions.acquisition_source
    }

    const storeValues = Object.values(storeSnsProperties).flatMap((rows) => rows.map((item) => {
      const value = item[field as keyof StoreSnsPropertyRecord]
      return typeof value === 'string' ? value : ''
    }))
    const recruitmentValues = recruitmentSnsProperties.map((item) => {
      const value = item[field as keyof RecruitmentSnsPropertyRecord]
      return typeof value === 'string' ? value : ''
    })

    const recordValues = field === 'wp_registered'
      ? [
          ...tiktokProperties.map((item) => item.wp_registered),
          ...instagramProperties.map((item) => item.wp_registered),
          ...youtubeProperties.map((item) => item.wp_registered),
        ]
      : field === 'aos_registered'
        ? tiktokProperties.map((item) => item.aos_registered)
        : field === 'post_reserved'
          ? recruitmentValues
          : field === 'youtube_reserved'
            ? [...storeValues, ...recruitmentValues]
            : storeValues

    return normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS[field],
      ...snsPropertyOptions[field],
      ...recordValues,
    ])
  }, [instagramProperties, recruitmentSnsProperties, snsPropertyOptions, storeSnsProperties, tiktokProperties, youtubeProperties])

  const activeSnsPropertyTotalCount = snsPropertyTotalCount[activeSnsPropertyPlatform]
  const activeSnsPropertyCurrentPage = snsPropertyPage[activeSnsPropertyPlatform]
  const activeSnsPropertyPageInfo = buildSnsPropertyPageInfo(activeSnsPropertyTotalCount, activeSnsPropertyCurrentPage)

  function updateSnsPropertySearch(platform: SnsPropertyPlatform, value: string) {
    setSnsPropertySearch((prev) => ({ ...prev, [platform]: value }))
    setSnsPropertyPage((prev) => ({ ...prev, [platform]: 1 }))
  }

  function moveSnsPropertyPage(platform: SnsPropertyPlatform, nextPage: number) {
    setSnsPropertyPage((prev) => ({ ...prev, [platform]: Math.max(1, nextPage) }))
  }

  function renderSnsPropertyPagination() {
    return (
      <div className="sns-property-pagination">
        <button
          type="button"
          onClick={() => moveSnsPropertyPage(activeSnsPropertyPlatform, activeSnsPropertyPageInfo.currentPage - 1)}
          disabled={activeSnsPropertyPageInfo.currentPage <= 1}
        >
          前へ
        </button>
        <button
          type="button"
          onClick={() => moveSnsPropertyPage(activeSnsPropertyPlatform, activeSnsPropertyPageInfo.currentPage + 1)}
          disabled={activeSnsPropertyPageInfo.currentPage >= activeSnsPropertyPageInfo.totalPages}
        >
          次へ
        </button>
        <span className="sns-property-page-info">
          {activeSnsPropertyTotalCount === 0
            ? '0件'
            : `${activeSnsPropertyPageInfo.from}-${activeSnsPropertyPageInfo.to}件 / 全${activeSnsPropertyTotalCount}件`}
        </span>
        <span className="sns-property-page-info">
          {activeSnsPropertyPageInfo.currentPage} / {activeSnsPropertyPageInfo.totalPages}ページ
        </span>
      </div>
    )
  }

  function getSnsPropertyPlatformByTable(tableName: SnsPropertyTableName) {
    if (tableName === 'sns_tiktok_properties') return 'tiktok'
    if (tableName === 'sns_instagram_properties') return 'instagram'
    if (tableName === 'sns_youtube_properties') return 'youtube'
    if (tableName === 'sns_recruitment_properties') return 'recruitment'

    return (Object.keys(storeSnsPropertyTableMap) as StoreSnsPropertyPlatform[])
      .find((platform) => storeSnsPropertyTableMap[platform] === tableName) || null
  }

  function scheduleSnsPropertySheetSync(platform: 'tiktok' | 'instagram' | 'youtube' | StoreSnsPropertyPlatform) {
    const existingTimer = snsPropertySheetSyncTimers.current[platform]
    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }

    snsPropertySheetSyncTimers.current[platform] = window.setTimeout(() => {
      delete snsPropertySheetSyncTimers.current[platform]

      if (platform === 'tiktok') {
        void syncTiktokPropertiesToSheet({ silent: true })
      } else if (platform === 'instagram') {
        void syncInstagramPropertiesToSheet({ silent: true })
      } else if (platform === 'youtube') {
        void syncYoutubePropertiesToSheet({ silent: true })
      } else {
        void syncStoreSnsPropertiesToSheet(platform, { silent: true })
      }
    }, 3000)
  }

  function scheduleSnsPropertySheetSyncByTable(tableName: SnsPropertyTableName) {
    const platform = getSnsPropertyPlatformByTable(tableName)
    if (platform && platform !== 'recruitment') scheduleSnsPropertySheetSync(platform)
  }

  async function updateRecruitmentSnsPropertyRow(
    id: string,
    field: keyof Omit<RecruitmentSnsPropertyRecord, 'id' | 'created_at'>,
    value: string,
  ) {
    const payload = field === 'post_date'
      ? { [field]: value || null }
      : { [field]: value }
    const { error } = await supabase.from('sns_recruitment_properties').update(payload).eq('id', id)

    if (error) {
      alert(`保存に失敗しました。\n\n${error.message}`)
      return
    }

    setRecruitmentSnsProperties((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    )
  }

  async function updateStoreSnsPropertyRow(
    platform: StoreSnsPropertyPlatform,
    id: string,
    field: keyof Omit<StoreSnsPropertyRecord, 'id' | 'created_at'>,
    value: string,
  ) {
    const tableName = storeSnsPropertyTableMap[platform]
    const payload = field === 'post_date'
      ? { [field]: value || null }
      : { [field]: value }
    const { error } = await supabase.from(tableName).update(payload).eq('id', id)

    if (error) {
      alert(`保存に失敗しました。\n\n${error.message}`)
      return
    }

    setStoreSnsProperties((prev) => ({
      ...prev,
      [platform]: prev[platform].map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }))
    scheduleSnsPropertySheetSync(platform)
  }

  async function syncStoreSnsPropertiesToSheet(platform: StoreSnsPropertyPlatform, options?: { silent?: boolean }) {
    const label = snsPropertyTabs.find((tab) => tab.key === platform)?.label || '店舗'
    if (!options?.silent) {
      const confirmed = window.confirm(`${label}の一覧をスプレッドシートへ上書きしますか？`)
      if (!confirmed) return
    }

    setStoreSnsSheetSyncing(platform)
    try {
      const params = new URLSearchParams({ platform })
      const response = await fetch(`/api/sync-store-sns-property-sheet?${params.toString()}`, { method: 'POST' })
      const data = await response.json() as { ok?: boolean; count?: number; sheetName?: string; message?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '反映に失敗しました。')
      }

      if (!options?.silent) {
        alert(`スプレッドシート「${data.sheetName || ''}」へ反映しました。\n反映件数: ${data.count ?? 0}件`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '反映に失敗しました。'
      if (options?.silent) {
        console.error('スプレッドシート自動反映に失敗しました。', message)
      } else {
        alert(`スプレッドシート反映に失敗しました。\n\n${message}`)
      }
    } finally {
      setStoreSnsSheetSyncing(null)
    }
  }

  function renderStoreSnsPropertySection(platform: StoreSnsPropertyPlatform) {
    const rows = storeSnsProperties[platform]
    const title = snsPropertyTabs.find((tab) => tab.key === platform)?.title || 'SNS物件管理'
    const tableName = storeSnsPropertyTableMap[platform]
    const isKeihanKarilun = platform === 'keihan-karilun'
    const isNishinomiyaKarilun = platform === 'nishinomiya-karilun'
    const hidesThreadsPostDate = isNishinomiyaKarilun || platform === 'nishikita'
    const emptyColSpan = 16 - (isKeihanKarilun ? 2 : 0) - (hidesThreadsPostDate ? 1 : 0)

    return (
      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>{title}</h2></div>
          <div className="sns-property-toolbar">
            <input
              className="sns-property-search-input"
              value={snsPropertySearch[platform]}
              onChange={(e) => updateSnsPropertySearch(platform, e.target.value)}
              placeholder="番号で検索"
            />
            {snsPropertySearch[platform] && (
              <button type="button" className="secondary" onClick={() => updateSnsPropertySearch(platform, '')}>×</button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => void syncStoreSnsPropertiesToSheet(platform)}
              disabled={storeSnsSheetSyncing === platform}
            >
              {storeSnsSheetSyncing === platform ? '反映中...' : '今すぐ反映'}
            </button>
            <button type="button" className="primary" onClick={() => openSnsPropertyCreate(platform)}>新規登録</button>
          </div>
        </div>
        <div className="table-wrap sns-property-table-wrap">
          <table className="compact-list-table sns-property-table">
            <thead>
              <tr>
                <th className="sns-col-memo">メモ</th>
                <th className="sns-col-date">投稿日</th>
                <th className="sns-col-plan">{isKeihanKarilun ? '場所' : '種別'}</th>
                <th className="sns-col-property-name">物件名</th>
                <th className="sns-col-room">号室</th>
                <th className="sns-col-code">番号</th>
                <th className="sns-col-link">資料</th>
                <th className="sns-col-check">
                  <SnsPropertyHeader title="Tiktok予約" onEdit={() => openSnsPropertyOptionEditor('tiktok_reserved', 'Tiktok予約')} />
                </th>
                <th className="sns-col-check">
                  <SnsPropertyHeader title="TiktokWP" onEdit={() => openSnsPropertyOptionEditor('tiktok_wp', 'TiktokWP')} />
                </th>
                <th className="sns-col-check">
                  <SnsPropertyHeader title="INSTA予約" onEdit={() => openSnsPropertyOptionEditor('instagram_reserved', 'INSTA予約')} />
                </th>
                <th className="sns-col-check">
                  <SnsPropertyHeader title="INSTA WP" onEdit={() => openSnsPropertyOptionEditor('instagram_wp', 'INSTA WP')} />
                </th>
                {!isKeihanKarilun && (
                  <>
                    <th className="sns-col-check">
                      <SnsPropertyHeader title="YouTube予約" onEdit={() => openSnsPropertyOptionEditor('youtube_reserved', 'YouTube予約')} />
                    </th>
                    <th className="sns-col-check">
                      <SnsPropertyHeader title="YouTube WP" onEdit={() => openSnsPropertyOptionEditor('youtube_wp', 'YouTube WP')} />
                    </th>
                  </>
                )}
                {!hidesThreadsPostDate && (
                  <th className="sns-col-date">
                    <SnsPropertyHeader title="threads投稿日" onEdit={() => openSnsPropertyOptionEditor('threads_post_date', 'threads投稿日')} />
                  </th>
                )}
                <th className="sns-col-post-text">
                  <SnsPropertyHeader title="投稿文" onEdit={() => openSnsPropertyOptionEditor('post_text', '投稿文')} />
                </th>
                <th className="sns-col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={emptyColSpan} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="row-hoverable">
                  <td className="sns-col-memo">{renderSnsMemoCell(tableName, r.id, r.memo)}</td>
                  <td className="sns-col-date">{renderSnsTextInput(`${r.id}:post_date`, normalizeSnsPropertyPostDate(r.post_date, r.property_number, platform), (value) => updateStoreSnsPropertyRow(platform, r.id, 'post_date', value), { type: 'date' })}</td>
                  <td className="sns-col-plan">
                    {isKeihanKarilun
                      ? renderSnsTextInput(`${r.id}:category`, r.category, (value) => updateStoreSnsPropertyRow(platform, r.id, 'category', value))
                      : renderSnsSelect(r.category, [...SNS_PROPERTY_CATEGORY_OPTIONS], (value) => updateStoreSnsPropertyRow(platform, r.id, 'category', value))}
                  </td>
                  <td className="sns-col-property-name">{renderSnsTextInput(`${r.id}:property_name`, r.property_name, (value) => updateStoreSnsPropertyRow(platform, r.id, 'property_name', value))}</td>
                  <td className="sns-col-room">{renderSnsTextInput(`${r.id}:room_number`, r.room_number, (value) => updateStoreSnsPropertyRow(platform, r.id, 'room_number', value))}</td>
                  <td className="sns-col-code">{renderSnsTextInput(`${r.id}:property_number`, r.property_number, (value) => updateStoreSnsPropertyRow(platform, r.id, 'property_number', value))}</td>
                  <td className="sns-col-link" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="sns-link-button" title={r.document_url || '資料URLを入力'} onClick={() => editStoreSnsPropertyUrl(platform, r.id, r.document_url)}>
                      🔗
                    </button>
                  </td>
                  <td className="sns-col-check">{renderSnsSelect(r.tiktok_reserved, getSnsPropertySelectOptions('tiktok_reserved'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'tiktok_reserved', value), () => openSnsPropertyOptionEditor('tiktok_reserved', 'Tiktok予約'))}</td>
                  <td className="sns-col-check">{renderSnsSelect(r.tiktok_wp, getSnsPropertySelectOptions('tiktok_wp'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'tiktok_wp', value), () => openSnsPropertyOptionEditor('tiktok_wp', 'TiktokWP'))}</td>
                  <td className="sns-col-check">{renderSnsSelect(r.instagram_reserved, getSnsPropertySelectOptions('instagram_reserved'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'instagram_reserved', value), () => openSnsPropertyOptionEditor('instagram_reserved', 'INSTA予約'))}</td>
                  <td className="sns-col-check">{renderSnsSelect(r.instagram_wp, getSnsPropertySelectOptions('instagram_wp'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'instagram_wp', value), () => openSnsPropertyOptionEditor('instagram_wp', 'INSTA WP'))}</td>
                  {!isKeihanKarilun && (
                    <>
                      <td className="sns-col-check">{renderSnsSelect(r.youtube_reserved, getSnsPropertySelectOptions('youtube_reserved'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'youtube_reserved', value), () => openSnsPropertyOptionEditor('youtube_reserved', 'YouTube予約'))}</td>
                      <td className="sns-col-check">{renderSnsSelect(r.youtube_wp, getSnsPropertySelectOptions('youtube_wp'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'youtube_wp', value), () => openSnsPropertyOptionEditor('youtube_wp', 'YouTube WP'))}</td>
                    </>
                  )}
                  {!hidesThreadsPostDate && (
                    <td className="sns-col-date">{renderSnsSelect(r.threads_post_date, getSnsPropertySelectOptions('threads_post_date'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'threads_post_date', value), () => openSnsPropertyOptionEditor('threads_post_date', 'threads投稿日'))}</td>
                  )}
                  <td className="sns-col-post-text">{renderSnsSelect(r.post_text, getSnsPropertySelectOptions('post_text'), (value) => updateStoreSnsPropertyRow(platform, r.id, 'post_text', value), () => openSnsPropertyOptionEditor('post_text', '投稿文'))}</td>
                  <td className="sns-col-actions">
                    <div className="row-actions">
                      <button className="danger" onClick={() => confirmAndDeleteRecord(tableName, r.id, () => fetchStoreSnsProperties(platform), 'このレコードを削除しますか？', () => scheduleSnsPropertySheetSync(platform))}>削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {renderSnsPropertyPagination()}
      </section>
    )
  }

  async function fetchSavedSnsPropertyOptions(field: SnsPropertySelectField) {
    if (field === 'acquisition_source') {
      return FIXED_ACQUISITION_SOURCE_OPTIONS
    }

    const localOptions = getStoredSnsPropertyOptions(field) || []
    const { data, error } = await supabase
      .from('sns_property_select_options')
      .select('id, field, label, sort_order, created_at')
      .eq('field', field)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      if (isMissingSnsPropertyOptionTableError(error)) {
        return normalizeSnsPropertyOptions(localOptions)
      }
      throw error
    }

    const dbOptions = ((data || []) as SnsPropertySelectOptionRow[]).map((item) => item.label)
    return normalizeSnsPropertyOptions([
      ...localOptions,
      ...dbOptions,
    ])
  }

  async function saveSnsPropertyOptionsToDatabase(field: SnsPropertySelectField, options: string[]) {
    const normalizedOptions = normalizeSnsPropertyOptions(options)
    const { error: deleteError } = await supabase
      .from('sns_property_select_options')
      .delete()
      .eq('field', field)

    if (deleteError) {
      if (isMissingSnsPropertyOptionTableError(deleteError)) return false
      throw deleteError
    }

    const rows = normalizedOptions.map((label, index) => ({
      field,
      label,
      sort_order: index,
    }))

    const { error: insertError } = await supabase
      .from('sns_property_select_options')
      .insert(rows)

    if (insertError) {
      if (isMissingSnsPropertyOptionTableError(insertError)) return false
      throw insertError
    }

    return true
  }

  async function fetchAllSnsPropertyOptionValues(field: SnsPropertySelectField) {
    if (field === 'acquisition_source') {
      return FIXED_ACQUISITION_SOURCE_OPTIONS
    }

    if (field !== 'wp_registered' && field !== 'aos_registered') {
      return []
    }

    const tableTargets = field === 'wp_registered'
      ? [
          'sns_tiktok_properties',
          'sns_instagram_properties',
          'sns_youtube_properties',
        ] as const
      : ['sns_tiktok_properties'] as const

    const results = await Promise.all(
      tableTargets.map(async (tableName) => {
        const { data, error } = await supabase.from(tableName).select(field)
        if (error) throw error
        return (data || []).map((item) => {
          const value = field === 'wp_registered'
            ? ('wp_registered' in item ? item.wp_registered : '')
            : ('aos_registered' in item ? item.aos_registered : '')
          return String(value || '')
        })
      }),
    )

    return normalizeSnsPropertyOptions(results.flat())
  }

  async function refreshSnsPropertyOptions(field: SnsPropertySelectField) {
    const savedOptions = await fetchSavedSnsPropertyOptions(field)
    const dbOptions = await fetchAllSnsPropertyOptionValues(field)
    const nextOptions = normalizeSnsPropertyOptions([
      ...SNS_PROPERTY_DEFAULT_OPTIONS[field],
      ...savedOptions,
      ...dbOptions,
    ])
    saveStoredSnsPropertyOptions(field, nextOptions)
    setSnsPropertyOptions((prev) => ({ ...prev, [field]: nextOptions }))
    return nextOptions
  }

  async function openSnsPropertyOptionEditor(field: SnsPropertySelectField, title: string) {
    let currentOptions = getSnsPropertySelectOptions(field)
    try {
      currentOptions = await refreshSnsPropertyOptions(field)
    } catch (error) {
      console.error(error)
    }

    setSnsPropertyOptionEditor({
      field,
      title,
      items: currentOptions.length > 0 ? [...currentOptions] : [''],
    })
  }

  function updateSnsPropertyOptionItem(index: number, value: string) {
    setSnsPropertyOptionEditor((prev) => {
      if (!prev) return prev
      const nextItems = [...prev.items]
      nextItems[index] = value
      return { ...prev, items: nextItems }
    })
  }

  function addSnsPropertyOptionItem() {
    setSnsPropertyOptionEditor((prev) => {
      if (!prev) return prev
      return { ...prev, items: [...prev.items, ''] }
    })
  }

  function removeSnsPropertyOptionItem(index: number) {
    setSnsPropertyOptionEditor((prev) => {
      if (!prev) return prev
      const nextItems = prev.items.filter((_, itemIndex) => itemIndex !== index)
      return { ...prev, items: nextItems.length > 0 ? nextItems : [''] }
    })
  }

  function moveSnsPropertyOptionItem(index: number, direction: 'up' | 'down') {
    setSnsPropertyOptionEditor((prev) => {
      if (!prev) return prev
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.items.length) return prev

      const nextItems = [...prev.items]
      const [movedItem] = nextItems.splice(index, 1)
      nextItems.splice(targetIndex, 0, movedItem)
      return { ...prev, items: nextItems }
    })
  }

  async function saveSnsPropertyOptionItems() {
    if (!snsPropertyOptionEditor) return

    const nextOptions = normalizeSnsPropertyOptions(snsPropertyOptionEditor.items)
    if (nextOptions.length === 0) {
      alert('候補を1つ以上入れてください。')
      return
    }

    try {
      await saveSnsPropertyOptionsToDatabase(snsPropertyOptionEditor.field, nextOptions)
    } catch (error) {
      console.error(error)
      alert('候補の保存に失敗しました。時間をおいてもう一度お試しください。')
      return
    }

    saveStoredSnsPropertyOptions(snsPropertyOptionEditor.field, nextOptions)
    setSnsPropertyOptions((prev) => ({ ...prev, [snsPropertyOptionEditor.field]: nextOptions }))
    setSnsPropertyOptionEditor(null)
  }

  async function updateSnsPropertyRow<T extends { id: string }>(
    tableName: SnsPropertyTableName,
    id: string,
    field: string,
    value: string,
    setter: React.Dispatch<React.SetStateAction<T[]>>,
  ) {
    const payload = field === 'post_date' ? { [field]: value || null } : { [field]: value }
    const { error } = await supabase.from(tableName).update(payload).eq('id', id)

    if (error) {
      alert(`保存に失敗しました。\n\n${error.message}`)
      return
    }

    setter((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
    scheduleSnsPropertySheetSyncByTable(tableName)
  }

  function renderSnsTextInput(
    cellKey: string,
    value: string,
    onSave: (value: string) => void,
    options?: { type?: 'text' | 'date'; placeholder?: string },
  ) {
    return (
      <input
        key={`${cellKey}:${value}`}
        className={`progress-cell-input sns-cell-input${options?.type === 'date' ? ' is-date' : ''}`}
        type={options?.type || 'text'}
        defaultValue={value || ''}
        title={value || options?.placeholder || ''}
        placeholder={options?.placeholder}
        onBlur={(event) => {
          const nextValue = event.target.value
          if (nextValue !== (value || '')) onSave(nextValue)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
    )
  }

  function renderSnsSelect(
    value: string,
    options: string[],
    onSave: (value: string) => void,
    onEdit?: () => void,
  ) {
    return <SnsCellDropdown value={value} options={options} onChange={onSave} onEdit={onEdit} />
  }

  function renderSnsMemoCell(
    tableName: SnsPropertyTableName,
    id: string,
    memo: string,
  ) {
    return (
      <button
        type="button"
        className="memo-icon-button"
        title={memo ? 'クリックでメモ表示・編集' : 'クリックでメモ追加'}
        onClick={() => {
          setSnsMemoEditor({ tableName, id, value: memo || '' })
          setSnsMemoDraft(memo || '')
        }}
      >
        {memo ? '📝' : '＋'}
      </button>
    )
  }

  async function saveSnsMemo() {
    if (!snsMemoEditor) return

    const nextValue = snsMemoDraft

    if (snsMemoEditor.tableName === 'sns_tiktok_properties') {
      await updateSnsPropertyRow(snsMemoEditor.tableName, snsMemoEditor.id, 'memo', nextValue, setTiktokProperties)
    } else if (snsMemoEditor.tableName === 'sns_instagram_properties') {
      await updateSnsPropertyRow(snsMemoEditor.tableName, snsMemoEditor.id, 'memo', nextValue, setInstagramProperties)
    } else if (snsMemoEditor.tableName === 'sns_youtube_properties') {
      await updateSnsPropertyRow(snsMemoEditor.tableName, snsMemoEditor.id, 'memo', nextValue, setYoutubeProperties)
    } else if (snsMemoEditor.tableName === 'sns_recruitment_properties') {
      await updateRecruitmentSnsPropertyRow(snsMemoEditor.id, 'memo', nextValue)
    } else {
      const platform = (Object.keys(storeSnsPropertyTableMap) as StoreSnsPropertyPlatform[])
        .find((key) => storeSnsPropertyTableMap[key] === snsMemoEditor.tableName)

      if (platform) {
        const { error } = await supabase
          .from(snsMemoEditor.tableName)
          .update({ memo: nextValue })
          .eq('id', snsMemoEditor.id)

        if (error) {
          alert(`保存に失敗しました。\n\n${error.message}`)
          return
        }

        setStoreSnsProperties((prev) => ({
          ...prev,
          [platform]: prev[platform].map((item) => (item.id === snsMemoEditor.id ? { ...item, memo: nextValue } : item)),
        }))
        scheduleSnsPropertySheetSync(platform)
      }
    }

    setSnsMemoEditor(null)
    setSnsMemoDraft('')
  }

  async function editSnsPropertyUrl(
    tableName: SnsPropertyTableName,
    id: string,
    currentValue: string,
    setter: React.Dispatch<React.SetStateAction<any[]>>,
  ) {
    const nextValue = window.prompt('資料URLを入力してください', currentValue || '')
    if (nextValue === null) return
    await updateSnsPropertyRow(tableName, id, 'document_url', nextValue.trim(), setter)
  }

  async function editStoreSnsPropertyUrl(
    platform: StoreSnsPropertyPlatform,
    id: string,
    currentValue: string,
  ) {
    const nextValue = window.prompt('資料URLを入力してください', currentValue || '')
    if (nextValue === null) return

    const tableName = storeSnsPropertyTableMap[platform]
    const value = nextValue.trim()
    const { error } = await supabase.from(tableName).update({ document_url: value }).eq('id', id)

    if (error) {
      alert(`保存に失敗しました。\n\n${error.message}`)
      return
    }

    setStoreSnsProperties((prev) => ({
      ...prev,
      [platform]: prev[platform].map((item) => (item.id === id ? { ...item, document_url: value } : item)),
    }))
    scheduleSnsPropertySheetSync(platform)
  }

  async function syncTiktokPropertiesToSheet(options?: { silent?: boolean }) {
    if (!options?.silent) {
      const confirmed = window.confirm('Karilun｜TikTokの一覧をスプレッドシート「TikTok(K000)」へ上書きしますか？')
      if (!confirmed) return
    }

    setSnsTiktokSheetSyncing(true)
    try {
      const response = await fetch('/api/sync-sns-tiktok-sheet', { method: 'POST' })
      const data = await response.json() as { ok?: boolean; count?: number; message?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '反映に失敗しました。')
      }

      if (!options?.silent) {
        alert(`スプレッドシートへ反映しました。\n反映件数: ${data.count ?? 0}件`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '反映に失敗しました。'
      if (options?.silent) {
        console.error('スプレッドシート自動反映に失敗しました。', message)
      } else {
        alert(`スプレッドシート反映に失敗しました。\n\n${message}`)
      }
    } finally {
      setSnsTiktokSheetSyncing(false)
    }
  }

  async function syncInstagramPropertiesToSheet(options?: { silent?: boolean }) {
    if (!options?.silent) {
      const confirmed = window.confirm('Karilun｜Instagramの一覧をスプレッドシート「INSTA(G000)」へ上書きしますか？')
      if (!confirmed) return
    }

    setSnsInstagramSheetSyncing(true)
    try {
      const response = await fetch('/api/sync-sns-instagram-sheet', { method: 'POST' })
      const data = await response.json() as { ok?: boolean; count?: number; message?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '反映に失敗しました。')
      }

      if (!options?.silent) {
        alert(`スプレッドシートへ反映しました。\n反映件数: ${data.count ?? 0}件`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '反映に失敗しました。'
      if (options?.silent) {
        console.error('スプレッドシート自動反映に失敗しました。', message)
      } else {
        alert(`スプレッドシート反映に失敗しました。\n\n${message}`)
      }
    } finally {
      setSnsInstagramSheetSyncing(false)
    }
  }

  async function syncYoutubePropertiesToSheet(options?: { silent?: boolean }) {
    if (!options?.silent) {
      const confirmed = window.confirm('Karilun｜YouTubeの一覧をスプレッドシート「YouTube(R/Y000)」へ上書きしますか？')
      if (!confirmed) return
    }

    setSnsYoutubeSheetSyncing(true)
    try {
      const response = await fetch('/api/sync-sns-youtube-sheet', { method: 'POST' })
      const data = await response.json() as { ok?: boolean; count?: number; message?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || '反映に失敗しました。')
      }

      if (!options?.silent) {
        alert(`スプレッドシートへ反映しました。\n反映件数: ${data.count ?? 0}件`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '反映に失敗しました。'
      if (options?.silent) {
        console.error('スプレッドシート自動反映に失敗しました。', message)
      } else {
        alert(`スプレッドシート反映に失敗しました。\n\n${message}`)
      }
    } finally {
      setSnsYoutubeSheetSyncing(false)
    }
  }

  async function fetchGoogleUserEmail(token: string) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      const userInfo = await res.json() as { email?: string }
      return userInfo.email ? normalizeEmail(userInfo.email) : null
    } catch {
      return null
    }
  }

  async function applyLoginAccess(token: string, options?: { saveSession?: boolean; expiresIn?: number }) {
    setAuthLoading(true)
    setAuthError('')
    setAllowedAccountMessage('')

    if (options?.saveSession) {
      saveToken(token, options.expiresIn ?? 3600)
    }

    const accounts = await fetchAllowedAccounts()
    const email = await fetchGoogleUserEmail(token)

    if (!email) {
      clearToken()
      setCurrentUserEmail(null)
      setAuthError('Googleアカウントの確認に失敗しました。もう一度ログインしてください。')
      setAuthLoading(false)
      return
    }

    const canOpen = accounts.some((account) => normalizeEmail(account.email) === email)

    if (!canOpen) {
      clearToken()
      setCurrentUserEmail(null)
      setAuthError(`このアカウント（${email}）はまだ閲覧を許可していません。`)
      setAuthLoading(false)
      return
    }

    localStorage.setItem('gcal_hint', email)
    setCurrentUserEmail(email)
    setAuthLoading(false)
  }

  async function addAllowedAccount() {
    if (!isMasterUser) return

    const email = normalizeEmail(allowedAccountForm)
    if (!email) {
      setAllowedAccountMessage('追加したいGoogleアカウントを入力してください。')
      return
    }

    if (allowedAccounts.some((account) => normalizeEmail(account.email) === email)) {
      setAllowedAccountMessage('そのGoogleアカウントはすでに登録されています。')
      return
    }

    setAllowedAccountSaving(true)
    setAllowedAccountMessage('')

    const { error } = await supabase.from('allowed_accounts').insert({
      email,
      is_master: email === MASTER_EMAIL,
      allow_outside_office: false,
      created_by: currentUserEmail,
    })

    if (error) {
      setAllowedAccountMessage(`追加できませんでした: ${error.message}`)
      setAllowedAccountSaving(false)
      return
    }

    await fetchAllowedAccounts()
    setAllowedAccountForm('')
    setAllowedAccountSaving(false)
    setAllowedAccountMessage('Googleアカウントを追加しました。')
  }

  async function toggleOutsideOfficeAccess(account: AllowedAccount) {
    if (!isMasterUser) return

    setAllowedAccountSaving(true)
    setAllowedAccountMessage('')

    const nextValue = !account.allow_outside_office
    const { error } = await supabase
      .from('allowed_accounts')
      .update({ allow_outside_office: nextValue })
      .eq('email', normalizeEmail(account.email))

    if (error) {
      setAllowedAccountMessage(`保存できませんでした: ${error.message}`)
      setAllowedAccountSaving(false)
      return
    }

    setAllowedAccounts((accounts) => accounts.map((item) => (
      normalizeEmail(item.email) === normalizeEmail(account.email)
        ? { ...item, allow_outside_office: nextValue }
        : item
    )))
    setAllowedAccountSaving(false)
    setAllowedAccountMessage(nextValue ? '社外からも開けるようにしました。' : '社内Wi-Fiのみ開ける設定に戻しました。')
  }

  async function removeAllowedAccount(emailToRemove: string) {
    if (!isMasterUser) return

    const email = normalizeEmail(emailToRemove)
    if (email === MASTER_EMAIL) {
      setAllowedAccountMessage('マスターアカウントは削除できません。')
      return
    }

    setAllowedAccountSaving(true)
    setAllowedAccountMessage('')

    const { error } = await supabase.from('allowed_accounts').delete().eq('email', email)

    if (error) {
      setAllowedAccountMessage(`削除できませんでした: ${error.message}`)
      setAllowedAccountSaving(false)
      return
    }

    await fetchAllowedAccounts()
    setAllowedAccountSaving(false)
    setAllowedAccountMessage('Googleアカウントを削除しました。')
  }

  function logoutFromApp() {
    clearToken()
    localStorage.removeItem('gcal_hint')
    setCurrentUserEmail(null)
    setAuthError('')
    setAllowedAccountMessage('')
  }

  function formatDateForApi(date: Date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
  }

  function addDays(date: Date, days: number) {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    return next
  }

  function isDateBefore(a: string, b: string) {
    return a < b
  }

  function isDateAfter(a: string, b: string) {
    return a > b
  }

  async function fetchWeatherRange(startDate: string, endDate: string, endpoint: 'forecast' | 'archive') {
    if (isDateAfter(startDate, endDate)) return

    const baseUrl = endpoint === 'archive'
      ? 'https://archive-api.open-meteo.com/v1/archive'
      : 'https://api.open-meteo.com/v1/forecast'
    const url = `${baseUrl}?latitude=34.6937&longitude=135.5022&daily=weather_code&timezone=Asia%2FTokyo&start_date=${startDate}&end_date=${endDate}`
    const res = await fetch(url)
    if (!res.ok) return

    const data = await res.json() as { daily?: { time: string[]; weather_code: (number | null)[] } }
    if (data.daily?.time && data.daily?.weather_code) {
      const map: Record<string, number> = {}
      data.daily.time.forEach((date, i) => {
        const code = data.daily!.weather_code[i]
        if (code !== null && code !== undefined) map[date] = code
      })
      setWeatherMap(prev => ({ ...prev, ...map }))
    }
  }

  async function fetchWeather(yearMonth: string) {
    const [y, m] = yearMonth.split('-').map(Number)
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const today = new Date()
    const todayDate = formatDateForApi(today)
    const forecastLimit = formatDateForApi(addDays(today, 15))
    try {
      if (isDateBefore(startDate, todayDate)) {
        const archiveEndDate = isDateBefore(endDate, todayDate) ? endDate : formatDateForApi(addDays(today, -1))
        await fetchWeatherRange(startDate, archiveEndDate, 'archive')
      }

      if (!isDateAfter(endDate, todayDate) && !isDateBefore(endDate, todayDate)) {
        await fetchWeatherRange(todayDate, todayDate, 'forecast')
      } else if (!isDateBefore(endDate, todayDate)) {
        const forecastStartDate = isDateBefore(startDate, todayDate) ? todayDate : startDate
        const forecastEndDate = isDateAfter(endDate, forecastLimit) ? forecastLimit : endDate
        await fetchWeatherRange(forecastStartDate, forecastEndDate, 'forecast')
      }
    } catch { /* 天気取得失敗時は無視 */ }
  }

  async function fetchStockAttendance(yearMonth: string) {
    setStockAttendanceMap({})
    setStockHonmachiDateMap({})

    const token = getSavedToken()
    if (!token) {
      return
    }

    const [y, m] = yearMonth.split('-').map(Number)
    const startDateText = `${y}-${String(m).padStart(2, '0')}-01`
    const endDateText = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
    const monthLastDay = new Date(y, m, 0).getDate()
    const dateTexts = Array.from({ length: monthLastDay }, (_, index) => (
      `${y}-${String(m).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    ))
    const eventsByMember: Record<string, Record<string, TaskReportCalendarEvent[]>> = {}
    const loadedCalendarIds = new Set<string>()
    const formatJapanDate = (dateTime: string) => {
      const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(dateTime))
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      return `${values.year}-${values.month}-${values.day}`
    }

    await Promise.all(
      [...STOCK_ATTENDANCE_MEMBERS, STOCK_HONMACHI_MEMBER].map(async (member) => {
        try {
          const params = new URLSearchParams({
            timeMin: `${startDateText}T00:00:00+09:00`,
            timeMax: `${endDateText}T00:00:00+09:00`,
            timeZone: 'Asia/Tokyo',
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '2500',
          })
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(member.calendarId)}/events?${params.toString()}`
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
          if (res.status === 401 || res.status === 403) {
            clearToken()
            return
          }
          if (!res.ok) return

          const data = await res.json() as {
            items?: { summary?: string; start?: { dateTime?: string; date?: string } }[]
          }
          loadedCalendarIds.add(member.calendarId)
          const eventsByDate: Record<string, TaskReportCalendarEvent[]> = {}
          ;(data.items || []).forEach((event) => {
            const dateText = event.start?.date
              || (event.start?.dateTime ? formatJapanDate(event.start.dateTime) : '')
            if (!dateText) return
            if (!eventsByDate[dateText]) eventsByDate[dateText] = []
            eventsByDate[dateText].push({ summary: event.summary || '', isAllDay: !!event.start?.date })
          })
          eventsByMember[member.calendarId] = eventsByDate
        } catch {
          eventsByMember[member.calendarId] = {}
        }
      }),
    )

    const nextMap: Record<string, string[]> = {}
    const nextHonmachiDateMap: Record<string, boolean> = {}
    dateTexts.forEach((dateText) => {
      const workingMembers: string[] = STOCK_ATTENDANCE_MEMBERS.filter((member) => {
        if (!loadedCalendarIds.has(member.calendarId)) return false
        const events = eventsByMember[member.calendarId]?.[dateText] || []
        if (hasTaskReportDayOff(events)) return false
        return true
      }).map((member) => member.badge)

      const honmachiEvents = eventsByMember[STOCK_HONMACHI_MEMBER.calendarId]?.[dateText] || []
      const isHonmachiWorkDay = loadedCalendarIds.has(STOCK_HONMACHI_MEMBER.calendarId)
        && honmachiEvents.some((event) => event.summary.includes('本町'))

      if (isHonmachiWorkDay) {
        workingMembers.push(STOCK_HONMACHI_MEMBER.badge)
        nextHonmachiDateMap[dateText] = true
      }

      if (workingMembers.length > 0) nextMap[dateText] = workingMembers
    })

    setStockAttendanceMap(nextMap)
    setStockHonmachiDateMap(nextHonmachiDateMap)
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      setCurrentUserEmail(MASTER_EMAIL)
      setAuthLoading(false)
      fetchAllowedAccounts()
      return
    }

    const savedToken = getSavedToken()
    if (!savedToken) {
      setAuthLoading(false)
      fetchAllowedAccounts()
      return
    }

    void applyLoginAccess(savedToken)
  }, [])

  useEffect(() => {
    return () => {
      Object.values(snsPropertySheetSyncTimers.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer)
      })
    }
  }, [])

  useEffect(() => {
    if (!currentUserEmail) return

    fetchTasks()
    fetchPosts()
    fetchRecruitment()
    fetchTaskItems()
    fetchMembers()
    fetchHankyo()
    fetchDm()
    fetchStock()
    fetchBusho()
    fetchJishaShukyaku()

    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sns_posts' }, fetchPosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recruitment' }, fetchRecruitment)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_items' }, () => { void fetchTaskItems() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserEmail])

  useEffect(() => {
    if (!currentUserEmail || activePage !== 'snsproperty') return

    if (activeSnsPropertyPlatform === 'sokanri') {
      void fetchSokanriData()
      return
    }
    if (activeSnsPropertyPlatform === 'tiktok') {
      void fetchTiktokProperties()
      return
    }
    if (activeSnsPropertyPlatform === 'instagram') {
      void fetchInstagramProperties()
      return
    }
    if (activeSnsPropertyPlatform === 'youtube') {
      void fetchYoutubeProperties()
      return
    }
    if (activeSnsPropertyPlatform === 'recruitment') {
      void fetchRecruitmentSnsProperties()
      return
    }
    if (isStoreSnsPropertyPlatform(activeSnsPropertyPlatform)) {
      void fetchStoreSnsProperties(activeSnsPropertyPlatform)
    }
  }, [
    activePage,
    activeSnsPropertyPlatform,
    currentUserEmail,
    fetchSokanriData,
    fetchRecruitmentSnsProperties,
    fetchStoreSnsProperties,
    fetchInstagramProperties,
    fetchTiktokProperties,
    fetchYoutubeProperties,
    isStoreSnsPropertyPlatform,
  ])

  useEffect(() => {
    if (!currentUserEmail || activePage !== 'snsproperty') return
    void refreshSnsPropertyOptions('wp_registered')
    void refreshSnsPropertyOptions('aos_registered')
  }, [activePage, currentUserEmail])

  const yearOptions = Array.from(
    new Set([
      new Date().getFullYear(),
      ...tasks.flatMap((task) => [getYear(task.taskDate), getYear(task.dueDate)]),
      ...posts.map((post) => getYear(post.postDate)),
      ...recruitment.map((record) => getYear(record.date)),
    ]),
  )
    .filter(Boolean)
    .sort((a, b) => b - a)

  const filteredRecruitment = recruitment.filter((record) =>
    matchesYearMonth(record.date, selectedYear, selectedMonth),
  )
  const ongoingTasks = tasks
    .filter((task) => task.status === '作業中')
    .sort((a, b) => {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      return (b.taskDate || '').localeCompare(a.taskDate || '')
    })

  // 案件一覧: フィルター＋ソート（①優先度 ②期日近い順 ③案件日順）
  const priorityOrder: Record<Priority, number> = { 高: 0, 中: 1, 低: 2 }
  const filteredAndSortedTasks = tasks
    .filter((task) => {
      if (!taskShowCompleted && task.status === '完了') return false
      if (taskAssigneeFilter !== 'all' && !(task.assignees || []).includes(taskAssigneeFilter)) return false
      return true
    })
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 99
      const pb = priorityOrder[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      return (b.taskDate || '').localeCompare(a.taskDate || '')
    })

  // 単発は完了時一括・継続は月次累積で集計
  const taskSavingsTotal = tasks.reduce((sum, task) => sum + calcTaskSavings(task, selectedYear, selectedMonth), 0)

  const recruitmentSummary = filteredRecruitment.reduce(
    (acc, record) => {
      acc.costReduction += record.costReduction
      return acc
    },
    { costReduction: 0 },
  )
  const jishaStoreSalesTotal = jishaShukyakuRecords
    .filter((record) => {
      if (record.row_type !== '実績') return false
      if (record.year !== selectedYear) return false
      if (selectedMonth !== 'all' && record.month !== Number(selectedMonth)) return false
      return true
    })
    .reduce((sum, record) => sum + record.koken_uriaage, 0)
  const totalContribution = jishaStoreSalesTotal + taskSavingsTotal + recruitmentSummary.costReduction
  const dashboardToday = new Date()
  dashboardToday.setHours(0, 0, 0, 0)
  const dashboardLimit = new Date(dashboardToday)
  dashboardLimit.setDate(dashboardLimit.getDate() + 3)
  const dashboardWeeklyLimit = new Date(dashboardToday)
  dashboardWeeklyLimit.setDate(dashboardWeeklyLimit.getDate() + 7)
  const webTeamTasks = taskItems
    .filter((item) => {
      if (!item.due_date) return false
      if (item.status === '完了') return false
      const dueDate = new Date(`${item.due_date}T00:00:00`)
      return dueDate >= dashboardToday && dueDate <= dashboardLimit
    })
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))

  // タスク管理 計算
  const weeklySchedules = [
    ...tasks
      .filter((task) => task.dueDate && task.status !== '完了' && isDateWithinRange(task.dueDate, dashboardToday, dashboardWeeklyLimit))
      .map((task): WeeklyScheduleItem => ({
        id: `task-${task.id}`,
        source: '案件管理',
        date: task.dueDate,
        title: task.name,
        detail: `${task.department} / ${task.taskType}`,
      })),
    ...taskItems
      .filter((item) => item.due_date && item.status !== '完了' && isDateWithinRange(item.due_date, dashboardToday, dashboardWeeklyLimit))
      .map((item): WeeklyScheduleItem => ({
        id: `task-item-${item.id}`,
        source: 'タスク管理',
        date: item.due_date,
        title: item.name,
        detail: `${getTaskItemPrimaryAssignee(item) || '担当者未設定'} / 作成者: ${item.creator || '未設定'}`,
      })),
    ...bushoSchedules
      .filter((schedule) => schedule.date && isDateWithinRange(schedule.date, dashboardToday, dashboardWeeklyLimit))
      .map((schedule): WeeklyScheduleItem => ({
        id: `busho-${schedule.id}`,
        source: '部署予定',
        date: schedule.date,
        start_time: schedule.start_time ?? undefined,
        title: schedule.title,
        detail: schedule.note ? `${schedule.department} / ${schedule.note}` : schedule.department,
      })),
  ].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date)
    if (dateCompare !== 0) return dateCompare
    return (a.start_time || '99:99').localeCompare(b.start_time || '99:99')
  })

  const today = new Date().toISOString().split('T')[0]
  const filteredTaskItems = taskItems
    .filter((item) => {
      if (taskSearch && !item.name.includes(taskSearch)) return false
      if (!taskItemShowCompleted && item.status === taskItemStatuses[2]) return false
      if (taskItemAssigneeFilter !== 'all' && getTaskItemPrimaryAssignee(item) !== taskItemAssigneeFilter) return false
      if (taskFilter === 'overdue') {
        if (!item.due_date || item.status === taskItemStatuses[2]) return false
        return item.due_date < today
      }
      if (taskFilter !== 'all' && item.status !== taskFilter) return false
      return true
    })
    .sort((a, b) => {
      const pOrder: Record<Priority, number> = { 高: 0, 中: 1, 低: 2 }
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1
      const pd = pOrder[a.priority] - pOrder[b.priority]
      if (pd !== 0) return pd
      return (b.created_at || '').localeCompare(a.created_at || '')
    })

  const filteredTaskItemIdSet = new Set(filteredTaskItems.map((item) => item.id))
  const taskItemsById = new Map(taskItems.map((item) => [item.id, item]))
  const childTaskItemsByParent = filteredTaskItems.reduce<Record<string, TaskItem[]>>((acc, item) => {
    if (!item.parent_task_id) return acc
    if (!acc[item.parent_task_id]) acc[item.parent_task_id] = []
    acc[item.parent_task_id].push(item)
    return acc
  }, {})
  const extraParentTaskItems = filteredTaskItems
    .map((item) => (item.parent_task_id ? taskItemsById.get(item.parent_task_id) ?? null : null))
    .filter((item): item is TaskItem => !!item && !filteredTaskItemIdSet.has(item.id))
  const taskItemsToRender = [...filteredTaskItems.filter((item) => !item.parent_task_id), ...extraParentTaskItems]
    .sort((a, b) => {
      const pOrder: Record<Priority, number> = { 高: 0, 中: 1, 低: 2 }
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1
      const pd = pOrder[a.priority] - pOrder[b.priority]
      if (pd !== 0) return pd
      return (b.created_at || '').localeCompare(a.created_at || '')
    })

  // 新規追加ハンドラ
  const isParentTaskExpanded = (taskId: string) => expandedParentTaskIds.includes(taskId)
  const toggleParentTaskExpanded = (taskId: string) => {
    setExpandedParentTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ))
  }

  const handleTaskSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTaskError(null)
    const { error } = await supabase.from('tasks').insert({ ...normalizeTask(taskForm), id: crypto.randomUUID() })
    if (error) { setTaskError(`追加失敗: ${error.message}`); return }
    setTaskForm(defaultTaskForm)
    fetchTasks()
    setShowModal(false)
  }

  const handleTaskItemSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTaskError(null)
    const parentItem = taskItemForm.parent_task_id
      ? taskItems.find((item) => item.id === taskItemForm.parent_task_id) || null
      : null
    const normalizedForm = buildTaskItemRecurringForm(taskItemForm, parentItem)
    const rows = buildTaskItemRows(normalizedForm)
    const { error } = await supabase.from('task_items').insert(rows)
    if (error) { 
      setTaskError(`追加失敗: ${error.message} (データベース構成を確認してください)`)
      console.error('Task Item Insert Error:', error)
      return 
    }
    try {
      await notifyTaskEvent({
        type: 'new',
        taskName: taskItemForm.name,
        dueDate: taskItemForm.due_date,
        workDate: taskItemForm.work_date,
        priority: taskItemForm.priority,
        assignees: taskItemForm.assignees,
        creator: taskItemForm.creator,
        members,
      })
    } catch (notifyError) {
      setTaskError(`タスクは追加されましたが、Slack通知に失敗しました: ${getSlackNotificationErrorMessage(notifyError)}`)
    }
    setTaskItemForm({ ...defaultTaskItemForm, date: new Date().toISOString().split('T')[0] })
    fetchTaskItems()
    setShowModal(false)
  }

  const updateTaskItemStatus = async (id: string, status: TaskItemStatus) => {
    const item = taskItems.find((t) => t.id === id)
    if (!item) return

    const completedNotified = status === '完了'
      ? item.completed_notified
      : false

    await supabase.from('task_items').update({ status, completed_notified: completedNotified }).eq('id', id)

    if (status === '完了' && !item.completed_notified) {
      notifyTaskEvent({
        type: 'completed',
        taskName: item.name,
        dueDate: item.due_date,
        workDate: item.work_date,
        priority: item.priority,
        assignees: item.assignees,
        creator: item.creator,
        members,
      }).catch((notifyError) => {
        setTaskError(`Slack通知に失敗しました: ${getSlackNotificationErrorMessage(notifyError)}`)
      })

      await supabase.from('task_items').update({ completed_notified: true }).eq('id', id)
    }

    fetchTaskItems()
  }

  const saveTaskItemInline = async () => {
    if (!taskItemInlineId) return
    setTaskError(null)
    const currentItem = taskItems.find((item) => item.id === taskItemInlineId)
    const currentAssignee = currentItem ? getTaskItemPrimaryAssignee(currentItem) : ''
    const selectedAssignees = getUniqueTaskItemAssignees(taskItemInlineForm.assignees)
    const nextPrimaryAssignee = currentAssignee && selectedAssignees.includes(currentAssignee)
      ? currentAssignee
      : (selectedAssignees[0] || '')
    const additionalAssignees = selectedAssignees.filter((assignee) => assignee !== nextPrimaryAssignee)
    const parentItem = taskItemInlineForm.parent_task_id
      ? taskItems.find((item) => item.id === taskItemInlineForm.parent_task_id) || null
      : null
    const recurringForm = buildTaskItemRecurringForm({
      ...taskItemInlineForm,
      assignees: selectedAssignees,
      parent_task_id: taskItemInlineForm.parent_task_id || null,
      recurring_type: taskItemInlineForm.recurring_type || 'none',
    }, parentItem)
    const normalizedRecurringFields = normalizeTaskItemRecurringFields(
      recurringForm,
      currentItem?.recurring_template_id || taskItemInlineForm.recurring_template_id || null,
      currentItem?.recurring_generation_month || taskItemInlineForm.recurring_generation_month || null,
      recurringForm.recurring_parent_template_id || null,
    )
    const updatePayload = {
      ...taskItemInlineForm,
      assignees: nextPrimaryAssignee ? [nextPrimaryAssignee] : [],
      ...normalizedRecurringFields,
      recurring_instance_key: normalizedRecurringFields.recurring_type === 'monthly'
        && normalizedRecurringFields.recurring_template_id
        && normalizedRecurringFields.recurring_generation_month
        ? `${normalizedRecurringFields.recurring_template_id}:${normalizedRecurringFields.recurring_generation_month}`
        : null,
    }
    const { error } = await supabase.from('task_items').update(updatePayload).eq('id', taskItemInlineId)
    if (error) {
      setTaskError(`更新失敗: ${error.message}`)
      console.error('Task Item Update Error:', error)
      return
    }

    if (currentItem && !currentItem.parent_task_id) {
      const childItems = taskItems.filter((item) => item.parent_task_id === currentItem.id)
      for (const childItem of childItems) {
        const childForm = buildTaskItemRecurringForm({
          date: childItem.date || '',
          name: childItem.name,
          priority: childItem.priority || '中',
          due_date: childItem.due_date || '',
          work_date: childItem.work_date || '',
          memo: childItem.memo || '',
          assignees: getUniqueTaskItemAssignees(childItem.assignees),
          creator: childItem.creator || '',
          status: childItem.status,
          parent_task_id: childItem.parent_task_id || null,
          recurring_type: normalizedRecurringFields.recurring_type,
          recurring_template_id: childItem.recurring_template_id || null,
          recurring_parent_template_id: normalizedRecurringFields.recurring_type === 'monthly'
            ? (normalizedRecurringFields.recurring_template_id || null)
            : null,
          recurring_generation_month: childItem.recurring_generation_month || normalizedRecurringFields.recurring_generation_month || null,
          recurring_due_day: childItem.recurring_due_day ?? null,
          recurring_due_rule: childItem.recurring_due_rule ?? null,
          recurring_work_day: childItem.recurring_work_day ?? null,
          recurring_work_rule: childItem.recurring_work_rule ?? null,
          recurring_instance_key: childItem.recurring_instance_key || null,
        }, {
          ...currentItem,
          recurring_type: normalizedRecurringFields.recurring_type,
          recurring_template_id: normalizedRecurringFields.recurring_template_id || null,
        })

        const childRecurringFields = normalizeTaskItemRecurringFields(
          childForm,
          childItem.recurring_template_id || (normalizedRecurringFields.recurring_type === 'monthly' ? crypto.randomUUID() : null),
          childItem.recurring_generation_month || normalizedRecurringFields.recurring_generation_month || null,
          normalizedRecurringFields.recurring_type === 'monthly' ? (normalizedRecurringFields.recurring_template_id || null) : null,
        )

        const childUpdatePayload = {
          recurring_type: childRecurringFields.recurring_type,
          recurring_template_id: childRecurringFields.recurring_template_id,
          recurring_parent_template_id: childRecurringFields.recurring_parent_template_id,
          recurring_generation_month: childRecurringFields.recurring_generation_month,
          recurring_due_day: childRecurringFields.recurring_due_day,
          recurring_due_rule: childRecurringFields.recurring_due_rule,
          recurring_work_day: childRecurringFields.recurring_work_day,
          recurring_work_rule: childRecurringFields.recurring_work_rule,
          recurring_instance_key: childRecurringFields.recurring_type === 'monthly'
            && childRecurringFields.recurring_template_id
            && childRecurringFields.recurring_generation_month
            ? `${childRecurringFields.recurring_template_id}:${childRecurringFields.recurring_generation_month}`
            : null,
        }

        const { error: childUpdateError } = await supabase.from('task_items').update(childUpdatePayload).eq('id', childItem.id)
        if (childUpdateError) {
          setTaskError(`子タスク更新失敗: ${childUpdateError.message}`)
          console.error('Task Item Child Update Error:', childUpdateError)
          return
        }
      }
    }
    if (additionalAssignees.length > 0) {
      const insertRows = additionalAssignees.map((assignee) => {
        const recurringFields = normalizeTaskItemRecurringFields(
          recurringForm,
          recurringForm.recurring_type === 'monthly' ? crypto.randomUUID() : null,
          currentItem?.recurring_generation_month || taskItemInlineForm.recurring_generation_month || null,
          recurringForm.recurring_parent_template_id || null,
        )

        return {
          ...taskItemInlineForm,
          id: crypto.randomUUID(),
          assignees: [assignee],
          ...recurringFields,
          recurring_instance_key: recurringFields.recurring_type === 'monthly'
            && recurringFields.recurring_template_id
            && recurringFields.recurring_generation_month
            ? `${recurringFields.recurring_template_id}:${recurringFields.recurring_generation_month}`
            : null,
        }
      })
      const { error: insertError } = await supabase.from('task_items').insert(insertRows)
      if (insertError) {
        setTaskError(`担当者追加の保存に失敗しました: ${insertError.message}`)
        console.error('Task Item Additional Insert Error:', insertError)
        return
      }
    }

    notifyTaskEvent({
      type: 'updated',
      taskName: taskItemInlineForm.name,
      dueDate: taskItemInlineForm.due_date,
      workDate: taskItemInlineForm.work_date,
      priority: taskItemInlineForm.priority,
      assignees: selectedAssignees,
      creator: taskItemInlineForm.creator,
      members,
    }).catch((notifyError) => {
      setTaskError(`Slack通知に失敗しました: ${getSlackNotificationErrorMessage(notifyError)}`)
    })

    if (currentItem && currentItem.status !== '完了' && taskItemInlineForm.status === '完了' && !currentItem.completed_notified) {
      await supabase.from('task_items').update({ completed_notified: true }).eq('id', taskItemInlineId)
      notifyTaskEvent({
        type: 'completed',
        taskName: taskItemInlineForm.name,
        dueDate: taskItemInlineForm.due_date,
        workDate: taskItemInlineForm.work_date,
        priority: taskItemInlineForm.priority,
        assignees: selectedAssignees,
        creator: taskItemInlineForm.creator,
        members,
      }).catch((notifyError) => {
        setTaskError(`Slack通知に失敗しました: ${getSlackNotificationErrorMessage(notifyError)}`)
      })
    }

    if (currentItem && currentItem.status === '完了' && taskItemInlineForm.status !== '完了') {
      await supabase.from('task_items').update({ completed_notified: false }).eq('id', taskItemInlineId)
    }

    setTaskItemInlineId(null)
    fetchTaskItems()
  }

  const startTaskItemInline = (item: TaskItem) => {
    setTaskItemInlineId(item.id)
    setTaskItemInlineForm({
      date: item.date || '',
      name: item.name,
      priority: item.priority || '中',
      due_date: item.due_date || '',
      work_date: item.work_date || '',
      memo: item.memo || '',
      assignees: getUniqueTaskItemAssignees(item.assignees),
      creator: item.creator || '',
      status: item.status,
      parent_task_id: item.parent_task_id || null,
      recurring_type: item.recurring_type || 'none',
      recurring_template_id: item.recurring_template_id || null,
      recurring_parent_template_id: item.recurring_parent_template_id || null,
      recurring_generation_month: item.recurring_generation_month || null,
      recurring_due_day: item.recurring_due_day ?? null,
      recurring_due_rule: item.recurring_due_rule ?? null,
      recurring_work_day: item.recurring_work_day ?? null,
      recurring_work_rule: item.recurring_work_rule ?? null,
      recurring_instance_key: item.recurring_instance_key || null,
    })
  }

  const deleteTaskItemWithChildren = async (item: TaskItem) => {
    const itemsToDelete = [item, ...taskItems.filter((child) => child.parent_task_id === item.id)]
    const deleteIds = itemsToDelete.map((target) => target.id)
    const childCount = itemsToDelete.length - 1
    const message = childCount > 0
      ? 'この親タスクと子タスクを本当に削除しますか？'
      : 'このタスクを本当に削除しますか？'

    const confirmed = window.confirm(message)
    if (!confirmed) return

    await supabase.from('task_items').delete().in('id', deleteIds)

    itemsToDelete.forEach((target) => {
      notifyTaskEvent({
        type: 'deleted',
        taskName: target.name,
        dueDate: target.due_date,
        workDate: target.work_date,
        priority: target.priority,
        assignees: target.assignees,
        creator: target.creator,
        members,
      }).catch((notifyError) => {
        setTaskError(`Slack通知に失敗しました: ${getSlackNotificationErrorMessage(notifyError)}`)
      })
    })

    fetchTaskItems()
  }

  const saveMemberSlack = async (id: string) => {
    await supabase.from('members').update({ slack_user_id: memberEditSlack }).eq('id', id)
    setMemberEditId(null)
    fetchMembers()
  }

  // ===== Google Sheets からエリアを取得 =====
  async function fetchAreaFromSheets(account: string, propertyNumber: string): Promise<string> {
    const normalizedPropertyNumber = propertyNumber.trim()
    if (!normalizedPropertyNumber) return ''

    const lookup = getDmAreaLookup(account, normalizedPropertyNumber)

    if (lookup.mode === 'fixed') return lookup.area
    if (lookup.mode === 'blank') return ''
    if (lookup.mode === 'unknown') return '\u4e0d\u660e'

    try {
      const params = new URLSearchParams({
        sheetName: lookup.sheetName,
        propertyNumber: normalizedPropertyNumber,
      })
      const response = await fetch(`/api/dm-area?${params.toString()}`)
      if (!response.ok) return '\u4e0d\u660e'
      const data = await response.json() as { area?: string }
      return (data.area || '').trim() || '\u4e0d\u660e'
    } catch {
      return '\u4e0d\u660e'
    }
  }

  // ===== DM管理ハンドラー =====
  const handleDmSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('dm').insert({ ...dmForm, id: crypto.randomUUID() })
    setDmForm({ ...defaultDmForm, date: new Date().toISOString().split('T')[0] })
    setDmPage(1)
    fetchDm()
  }

  const handleDmAccountChange = (account: string) => {
    setDmForm((current) => ({ ...current, account, area: '' }))
  }


  const startDmInline = (r: DMRecord) => {
    setDmInlineId(r.id)
    setDmInlineForm({
      date: r.date || '',
      account: r.account || '',
      sns: r.sns || '',
      area: r.area || '',
      property_number: r.property_number || '',
    })
  }

  const saveDmInline = async () => {
    if (!dmInlineId) return
    await supabase.from('dm').update(dmInlineForm).eq('id', dmInlineId)
    setDmInlineId(null)
    fetchDm()
  }

  async function getNextSnsPropertyNumber(platform: SnsPropertyPlatform) {
    if (platform === 'recruitment') {
      const { data, error } = await supabase
        .from('sns_recruitment_properties')
        .select('property_number')

      if (error) throw error

      const maxValue = (data || []).reduce((max, row) => {
        const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)

      return String(maxValue + 1)
    }

    if (platform === 'tiktok' || platform === 'instagram' || platform === 'youtube') {
      const tableName =
        platform === 'tiktok'
          ? 'sns_tiktok_properties'
          : platform === 'instagram'
            ? 'sns_instagram_properties'
            : 'sns_youtube_properties'
      const prefix = platform === 'tiktok' ? 'K' : platform === 'instagram' ? 'G' : 'Y'
      const digits = platform === 'tiktok' ? 4 : 3
      const { data, error } = await supabase
        .from(tableName)
        .select('property_number')
        .ilike('property_number', `${prefix}%`)

      if (error) throw error

      const maxValue = (data || []).reduce((max, row) => {
        const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)

      return `${prefix}${String(maxValue + 1).padStart(digits, '0')}`
    }

    const tableName = storeSnsPropertyTableMap[platform as StoreSnsPropertyPlatform]
    const { data, error } = await supabase
      .from(tableName)
      .select('property_number')

    if (error) throw error

    const maxValue = (data || []).reduce((max, row) => {
      const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0)

    return String(maxValue + 1)
  }

  async function openSnsPropertyCreate(platform: SnsPropertyPlatform) {
    try {
      if (platform === 'recruitment') {
        const nextPropertyNumber = await getNextSnsPropertyNumber(platform)
        setRecruitmentSnsPropertyForm({ ...defaultRecruitmentSnsPropertyForm, property_number: nextPropertyNumber })
        setSnsPropertyCreatePlatform(platform)
        return
      }

      const nextPropertyNumber = await getNextSnsPropertyNumber(platform)

      if (platform === 'tiktok') {
        setTiktokPropertyForm({ ...defaultTiktokPropertyForm, property_number: nextPropertyNumber })
      } else if (platform === 'instagram') {
        setInstagramPropertyForm({ ...defaultInstagramPropertyForm, property_number: nextPropertyNumber })
      } else if (platform === 'youtube') {
        setYoutubePropertyForm({ ...defaultYoutubePropertyForm, property_number: nextPropertyNumber })
      } else if (isStoreSnsPropertyPlatform(platform)) {
        setStoreSnsPropertyForm({ ...defaultStoreSnsPropertyForm, property_number: nextPropertyNumber })
      }

      setSnsPropertyCreatePlatform(platform)
    } catch (error) {
      const message = error instanceof Error ? error.message : '番号を作れませんでした。'
      alert(`番号の自動入力に失敗しました。\n\n${message}`)
    }
  }

  function closeSnsPropertyCreate() {
    setSnsPropertyCreatePlatform(null)
    setTiktokPropertyForm(defaultTiktokPropertyForm)
    setInstagramPropertyForm(defaultInstagramPropertyForm)
    setYoutubePropertyForm(defaultYoutubePropertyForm)
    setStoreSnsPropertyForm(defaultStoreSnsPropertyForm)
    setRecruitmentSnsPropertyForm(defaultRecruitmentSnsPropertyForm)
  }

  function prepareSnsPropertyPayload<T extends { post_date: string }>(form: T) {
    return {
      ...form,
      post_date: form.post_date || null,
    }
  }

  async function saveSnsPropertyCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!snsPropertyCreatePlatform) return

    setSnsPropertyCreateSaving(true)
    try {
      if (snsPropertyCreatePlatform === 'tiktok') {
        const { data, error } = await supabase
          .from('sns_tiktok_properties')
          .insert([prepareSnsPropertyPayload(tiktokPropertyForm)])
          .select()
          .single()
        if (error || !data) throw new Error(error?.message || 'データを作成できませんでした。')
        setSnsPropertySearch((prev) => ({ ...prev, tiktok: '' }))
        setSnsPropertyPage((prev) => ({ ...prev, tiktok: 1 }))
        setSnsPropertyTotalCount((prev) => ({ ...prev, tiktok: prev.tiktok + 1 }))
        setTiktokProperties((prev) => [data as TiktokPropertyRecord, ...prev])
        scheduleSnsPropertySheetSync('tiktok')
      } else if (snsPropertyCreatePlatform === 'instagram') {
        const { data, error } = await supabase
          .from('sns_instagram_properties')
          .insert([prepareSnsPropertyPayload(instagramPropertyForm)])
          .select()
          .single()
        if (error || !data) throw new Error(error?.message || 'データを作成できませんでした。')
        setSnsPropertySearch((prev) => ({ ...prev, instagram: '' }))
        setSnsPropertyPage((prev) => ({ ...prev, instagram: 1 }))
        setSnsPropertyTotalCount((prev) => ({ ...prev, instagram: prev.instagram + 1 }))
        setInstagramProperties((prev) => [data as InstagramPropertyRecord, ...prev])
        scheduleSnsPropertySheetSync('instagram')
      } else if (snsPropertyCreatePlatform === 'youtube') {
        const { data, error } = await supabase
          .from('sns_youtube_properties')
          .insert([prepareSnsPropertyPayload(youtubePropertyForm)])
          .select()
          .single()
        if (error || !data) throw new Error(error?.message || 'データを作成できませんでした。')
        setSnsPropertySearch((prev) => ({ ...prev, youtube: '' }))
        setSnsPropertyPage((prev) => ({ ...prev, youtube: 1 }))
        setSnsPropertyTotalCount((prev) => ({ ...prev, youtube: prev.youtube + 1 }))
        setYoutubeProperties((prev) => [data as YoutubePropertyRecord, ...prev])
        scheduleSnsPropertySheetSync('youtube')
      } else if (isStoreSnsPropertyPlatform(snsPropertyCreatePlatform)) {
        const platform = snsPropertyCreatePlatform
        const { data, error } = await supabase
          .from(storeSnsPropertyTableMap[platform])
          .insert([storeSnsPropertyForm])
          .select()
          .single()
        if (error || !data) throw new Error(error?.message || 'データを作成できませんでした。')
        setSnsPropertySearch((prev) => ({ ...prev, [platform]: '' }))
        setSnsPropertyPage((prev) => ({ ...prev, [platform]: 1 }))
        setSnsPropertyTotalCount((prev) => ({ ...prev, [platform]: prev[platform] + 1 }))
        setStoreSnsProperties((prev) => ({
          ...prev,
          [platform]: [data as StoreSnsPropertyRecord, ...prev[platform]],
        }))
        scheduleSnsPropertySheetSync(platform)
      } else if (snsPropertyCreatePlatform === 'recruitment') {
        const propertyNumber = recruitmentSnsPropertyForm.property_number || await getNextSnsPropertyNumber('recruitment')
        const { data, error } = await supabase
          .from('sns_recruitment_properties')
          .insert([prepareSnsPropertyPayload({ ...recruitmentSnsPropertyForm, property_number: propertyNumber })])
          .select()
          .single()
        if (error || !data) throw new Error(error?.message || 'データを作成できませんでした。')
        setSnsPropertySearch((prev) => ({ ...prev, recruitment: '' }))
        setSnsPropertyPage((prev) => ({ ...prev, recruitment: 1 }))
        setSnsPropertyTotalCount((prev) => ({ ...prev, recruitment: prev.recruitment + 1 }))
        setRecruitmentSnsProperties((prev) => [data as RecruitmentSnsPropertyRecord, ...prev])
      }

      closeSnsPropertyCreate()
    } catch (error) {
      const message = error instanceof Error ? error.message : '登録に失敗しました。'
      alert(`新規登録に失敗しました。\n\n${message}`)
    } finally {
      setSnsPropertyCreateSaving(false)
    }
  }

  function renderSnsPropertyCreateInput<T extends Record<string, string>>(
    label: string,
    field: keyof T,
    form: T,
    setForm: React.Dispatch<React.SetStateAction<T>>,
    options?: { type?: 'text' | 'date'; textarea?: boolean },
  ) {
    return (
      <label className="form-label">
        {label}
        {options?.textarea ? (
          <textarea
            rows={3}
            value={form[field] || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
          />
        ) : (
          <input
            type={options?.type || 'text'}
            value={form[field] || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
          />
        )}
      </label>
    )
  }

  function renderSnsPropertyCreateSelect<T extends Record<string, string>>(
    label: string,
    field: keyof T,
    form: T,
    setForm: React.Dispatch<React.SetStateAction<T>>,
    options: string[],
  ) {
    return (
      <label className="form-label">
        {label}
        <select
          value={form[field] || ''}
          onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
        >
          <option value="">未設定</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    )
  }

  function renderSnsPropertyCreateFields() {
    if (snsPropertyCreatePlatform === 'tiktok') {
      return (
        <>
          {renderSnsPropertyCreateInput('メモ', 'memo', tiktokPropertyForm, setTiktokPropertyForm, { textarea: true })}
          {renderSnsPropertyCreateSelect('WP登録', 'wp_registered', tiktokPropertyForm, setTiktokPropertyForm, getSnsPropertySelectOptions('wp_registered'))}
          {renderSnsPropertyCreateSelect('AOS登録', 'aos_registered', tiktokPropertyForm, setTiktokPropertyForm, getSnsPropertySelectOptions('aos_registered'))}
          {renderSnsPropertyCreateInput('投稿日', 'post_date', tiktokPropertyForm, setTiktokPropertyForm, { type: 'date' })}
          {renderSnsPropertyCreateInput('物件番号', 'property_number', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('間取り', 'floor_plan', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('家賃', 'rent', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('エリア', 'area', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('最寄り駅', 'nearest_station', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('資料URL', 'document_url', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('物件名', 'property_name', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('号室', 'room_number', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('住所', 'address', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateSelect('資料取得先', 'acquisition_source', tiktokPropertyForm, setTiktokPropertyForm, getSnsPropertySelectOptions('acquisition_source'))}
          {renderSnsPropertyCreateInput('管理会社', 'management_company', tiktokPropertyForm, setTiktokPropertyForm)}
          {renderSnsPropertyCreateInput('連絡先', 'contact', tiktokPropertyForm, setTiktokPropertyForm)}
        </>
      )
    }

    if (snsPropertyCreatePlatform === 'instagram') {
      return (
        <>
          {renderSnsPropertyCreateInput('メモ', 'memo', instagramPropertyForm, setInstagramPropertyForm, { textarea: true })}
          {renderSnsPropertyCreateSelect('WP登録', 'wp_registered', instagramPropertyForm, setInstagramPropertyForm, getSnsPropertySelectOptions('wp_registered'))}
          {renderSnsPropertyCreateSelect('種別', 'category', instagramPropertyForm, setInstagramPropertyForm, [...SNS_PROPERTY_CATEGORY_OPTIONS])}
          {renderSnsPropertyCreateInput('投稿日', 'post_date', instagramPropertyForm, setInstagramPropertyForm, { type: 'date' })}
          {renderSnsPropertyCreateInput('物件番号', 'property_number', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('間取り', 'floor_plan', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('家賃', 'rent', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('エリア', 'area', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('最寄り駅', 'nearest_station', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('資料URL', 'document_url', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('物件名', 'property_name', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('号室', 'room_number', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('住所', 'address', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateSelect('資料取得先', 'acquisition_source', instagramPropertyForm, setInstagramPropertyForm, getSnsPropertySelectOptions('acquisition_source'))}
          {renderSnsPropertyCreateInput('管理会社', 'management_company', instagramPropertyForm, setInstagramPropertyForm)}
          {renderSnsPropertyCreateInput('連絡先', 'contact', instagramPropertyForm, setInstagramPropertyForm)}
        </>
      )
    }

    if (snsPropertyCreatePlatform === 'youtube') {
      return (
        <>
          {renderSnsPropertyCreateInput('メモ', 'memo', youtubePropertyForm, setYoutubePropertyForm, { textarea: true })}
          {renderSnsPropertyCreateSelect('WP登録', 'wp_registered', youtubePropertyForm, setYoutubePropertyForm, getSnsPropertySelectOptions('wp_registered'))}
          {renderSnsPropertyCreateInput('投稿日', 'post_date', youtubePropertyForm, setYoutubePropertyForm, { type: 'date' })}
          {renderSnsPropertyCreateInput('物件番号', 'property_number', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateInput('資料URL', 'document_url', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateInput('物件名', 'property_name', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateInput('号室', 'room_number', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateInput('住所', 'address', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateSelect('資料取得先', 'acquisition_source', youtubePropertyForm, setYoutubePropertyForm, getSnsPropertySelectOptions('acquisition_source'))}
          {renderSnsPropertyCreateInput('管理会社', 'management_company', youtubePropertyForm, setYoutubePropertyForm)}
          {renderSnsPropertyCreateInput('連絡先', 'contact', youtubePropertyForm, setYoutubePropertyForm)}
        </>
      )
    }

    if (snsPropertyCreatePlatform && isStoreSnsPropertyPlatform(snsPropertyCreatePlatform)) {
      const isKeihanKarilun = snsPropertyCreatePlatform === 'keihan-karilun'
      const hidesThreadsPostDate = snsPropertyCreatePlatform === 'nishinomiya-karilun' || snsPropertyCreatePlatform === 'nishikita'

      return (
        <>
          {renderSnsPropertyCreateInput('メモ', 'memo', storeSnsPropertyForm, setStoreSnsPropertyForm, { textarea: true })}
          {renderSnsPropertyCreateInput('投稿日', 'post_date', storeSnsPropertyForm, setStoreSnsPropertyForm, { type: 'date' })}
          {isKeihanKarilun
            ? renderSnsPropertyCreateInput('場所', 'category', storeSnsPropertyForm, setStoreSnsPropertyForm)
            : renderSnsPropertyCreateSelect('種別', 'category', storeSnsPropertyForm, setStoreSnsPropertyForm, [...SNS_PROPERTY_CATEGORY_OPTIONS])}
          {renderSnsPropertyCreateInput('物件名', 'property_name', storeSnsPropertyForm, setStoreSnsPropertyForm)}
          {renderSnsPropertyCreateInput('号室', 'room_number', storeSnsPropertyForm, setStoreSnsPropertyForm)}
          {renderSnsPropertyCreateInput('番号', 'property_number', storeSnsPropertyForm, setStoreSnsPropertyForm)}
          {renderSnsPropertyCreateInput('資料URL', 'document_url', storeSnsPropertyForm, setStoreSnsPropertyForm)}
          {renderSnsPropertyCreateSelect('Tiktok予約', 'tiktok_reserved', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('tiktok_reserved'))}
          {renderSnsPropertyCreateSelect('TiktokWP', 'tiktok_wp', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('tiktok_wp'))}
          {renderSnsPropertyCreateSelect('INSTA予約', 'instagram_reserved', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('instagram_reserved'))}
          {renderSnsPropertyCreateSelect('INSTA WP', 'instagram_wp', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('instagram_wp'))}
          {!isKeihanKarilun && renderSnsPropertyCreateSelect('YouTube予約', 'youtube_reserved', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('youtube_reserved'))}
          {!isKeihanKarilun && renderSnsPropertyCreateSelect('YouTube WP', 'youtube_wp', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('youtube_wp'))}
          {!hidesThreadsPostDate && renderSnsPropertyCreateSelect('threads投稿日', 'threads_post_date', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('threads_post_date'))}
          {renderSnsPropertyCreateSelect('投稿文', 'post_text', storeSnsPropertyForm, setStoreSnsPropertyForm, getSnsPropertySelectOptions('post_text'))}
        </>
      )
    }

    if (snsPropertyCreatePlatform === 'recruitment') {
      return (
        <>
          {renderSnsPropertyCreateInput('メモ', 'memo', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm, { textarea: true })}
          {renderSnsPropertyCreateInput('投稿予定日', 'post_date', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm, { type: 'date' })}
          {renderSnsPropertyCreateSelect('投稿種類', 'category', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm, ['リール', 'フィード'])}
          {renderSnsPropertyCreateInput('タイトル', 'title', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm)}
          {renderSnsPropertyCreateSelect('投稿予約', 'post_reserved', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm, getSnsPropertySelectOptions('post_reserved'))}
          {renderSnsPropertyCreateSelect('YouTube予約', 'youtube_reserved', recruitmentSnsPropertyForm, setRecruitmentSnsPropertyForm, getSnsPropertySelectOptions('youtube_reserved'))}
        </>
      )
    }

    return null
  }

  // ===== ストック管理ハンドラー =====
  const handleStockSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('stock').insert({ ...stockForm, id: crypto.randomUUID() })
    setStockForm(defaultStockForm)
    setShowModal(false)
    fetchStock()
  }

  const handleBushoSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setTaskError(null)
    const payload = {
      ...bushoForm,
      start_time: bushoForm.start_time || null,
    }
    const { error } = editingBushoId
      ? await supabase.from('busho_schedules').update(payload).eq('id', editingBushoId)
      : await supabase.from('busho_schedules').insert({ ...payload, id: crypto.randomUUID() })
    if (error) {
      setTaskError(`部署予定の${editingBushoId ? '更新' : '追加'}失敗: ${error.message}`)
      return
    }
    setBushoForm(defaultBushoForm)
    setEditingBushoId(null)
    setShowModal(false)
    fetchBusho()
  }

  const startBushoEdit = (schedule: BushoSchedule) => {
    setTaskError(null)
    setEditingBushoId(schedule.id)
    setBushoSelectedDate(schedule.date)
    setBushoForm({
      date: schedule.date,
      start_time: schedule.start_time || '',
      title: schedule.title,
      department: schedule.department,
      note: schedule.note || '',
    })
    setShowModal(true)
  }

  const resetBushoModal = () => closeBushoModal(bushoSelectedDate || new Date().toISOString().slice(0, 10))

  const startStockInline = (r: StockRecord) => {
    setStockInlineId(r.id)
    setStockInlineForm({ deadline: r.deadline, required_count: r.required_count, label: r.label, note: r.note, achieved_count: r.achieved_count })
  }

  const saveStockInline = async () => {
    if (!stockInlineId) return
    await supabase.from('stock').update(stockInlineForm).eq('id', stockInlineId)
    setStockInlineId(null)
    fetchStock()
  }

  const moveStockMonth = (delta: number) => {
    const [y, m] = stockCalendarMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setStockCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  useEffect(() => {
    const propertyNumber = dmForm.property_number.trim()

    if (!propertyNumber) {
      setDmAreaLoading(false)
      setDmForm((current) => (current.area ? { ...current, area: '' } : current))
      return
    }

    let cancelled = false
    setDmAreaLoading(true)

    const timer = window.setTimeout(async () => {
      try {
        const area = await fetchAreaFromSheets(dmForm.account, propertyNumber)
        if (!cancelled) {
          setDmForm((current) => {
            if (current.property_number.trim() !== propertyNumber || current.account !== dmForm.account) return current
            return { ...current, area }
          })
        }
      } finally {
        if (!cancelled) setDmAreaLoading(false)
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dmForm.account, dmForm.property_number])

  // ストックカレンダーの月が変わったら天気を取得
  useEffect(() => {
    if (hankyoOpenFilter === null) return
    const close = () => setHankyoOpenFilter(null)
    const timer = window.setTimeout(() => {
      document.addEventListener('click', close)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', close)
    }
  }, [hankyoOpenFilter])

  useEffect(() => {
    fetchWeather(stockCalendarMonth)
  }, [stockCalendarMonth])

  useEffect(() => {
    if (!currentUserEmail || activePage !== 'stock') return
    fetchStockAttendance(stockCalendarMonth)
  }, [currentUserEmail, activePage, stockCalendarMonth])

  const confirmAndDeleteRecord = async (
    tableName: string,
    id: string,
    refresh: () => void,
    message = '本当に削除しますか？',
    afterDelete?: () => void | Promise<void>,
  ) => {
    const confirmed = window.confirm(message)
    if (!confirmed) return

    await supabase.from(tableName).delete().eq('id', id)
    refresh()
    await afterDelete?.()
  }

  // 反響管理ハンドラー
  const handleHankyoSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('hankyo').insert({ ...hankyoForm, id: crypto.randomUUID() })
    setHankyoForm({ ...defaultHankyoForm, inquiry_date: new Date().toISOString().split('T')[0] })
    fetchHankyo()
    setShowModal(false)
  }

  const startHankyoInline = (r: HankyoRecord) => {
    setHankyoInlineId(r.id)
    setHankyoInlineForm({
      inquiry_date: r.inquiry_date || '',
      account: r.account || '',
      trigger: r.trigger || '',
      media: r.media || '',
      inquiry_type: r.inquiry_type || '',
      customer_name: r.customer_name || '',
      contact_method: r.contact_method || '',
      move_in_timing: r.move_in_timing || '',
      store: r.store || '',
      area: r.area || '',
      note: r.note || '',
    })
  }

  const saveHankyoInline = async () => {
    if (!hankyoInlineId) return
    await supabase.from('hankyo').update({ ...hankyoInlineForm, updated_at: new Date().toISOString() }).eq('id', hankyoInlineId)
    setHankyoInlineId(null)
    fetchHankyo()
  }

  const duplicateHankyo = (r: HankyoRecord) => {
    setHankyoForm({
      inquiry_date: new Date().toISOString().split('T')[0],
      account: r.account,
      trigger: r.trigger,
      media: r.media,
      inquiry_type: r.inquiry_type,
      customer_name: '',
      contact_method: r.contact_method,
      move_in_timing: r.move_in_timing,
      store: r.store,
      area: r.area,
      note: r.note,
    })
    setShowModal(true)
  }

  // DM管理 フィルタリング & ページネーション
  const filteredDm = dmRecords.filter((r) => {
    if (dmMonthFilter !== 'all' && r.date) {
      const m = new Date(r.date).getMonth() + 1
      if (String(m) !== dmMonthFilter) return false
    }
    if (dmAccountFilter !== 'all' && r.account !== dmAccountFilter) return false
    return true
  })
  const dmTotalPages = Math.max(1, Math.ceil(filteredDm.length / DM_PAGE_SIZE))
  const paginatedDm = filteredDm.slice((dmPage - 1) * DM_PAGE_SIZE, dmPage * DM_PAGE_SIZE)

  // 反響管理 フィルタリング & ページネーション
  const filteredHankyo = hankyoRecords.filter((r) => {
    if (hankyoSearch && !r.customer_name.includes(hankyoSearch)) return false
    if (hankyoMonthFilters.length > 0 && r.inquiry_date) {
      const m = String(new Date(r.inquiry_date).getMonth() + 1)
      if (!hankyoMonthFilters.includes(m)) return false
    }
    if (hankyoAccountFilters.length > 0 && !hankyoAccountFilters.includes(r.account ?? '')) return false
    if (hankyoTriggerFilters.length > 0 && !hankyoTriggerFilters.includes(r.trigger ?? '')) return false
    if (hankyoMediaFilters.length > 0 && !hankyoMediaFilters.includes(r.media ?? '')) return false
    if (hankyoInquiryTypeFilters.length > 0 && !hankyoInquiryTypeFilters.includes(r.inquiry_type ?? '')) return false
    if (hankyoContactMethodFilters.length > 0 && !hankyoContactMethodFilters.includes(r.contact_method ?? '')) return false
    if (hankyoMoveInFilters.length > 0 && !hankyoMoveInFilters.includes(r.move_in_timing ?? '')) return false
    if (hankyoStoreFilters.length > 0 && !hankyoStoreFilters.includes(r.store ?? '')) return false
    return true
  })

  const handleSnsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('sns_posts').insert({ ...normalizePost(snsForm), id: crypto.randomUUID() })
    setSnsForm(defaultSnsForm)
    fetchPosts()
    setShowModal(false)
  }

  const handleRecruitmentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('recruitment').insert({ ...normalizeRecruitment(recruitmentForm), id: crypto.randomUUID() })
    setRecruitmentForm(defaultRecruitmentForm)
    fetchRecruitment()
    setShowModal(false)
  }

  // インライン編集 開始
  const startTaskInline = (task: Task) => {
    setTaskInlineId(task.id)
    setTaskInlineForm({
      taskDate: task.taskDate || '',
      assignees: task.assignees || [],
      department: task.department,
      name: task.name,
      content: task.content || '',
      taskType: task.taskType,
      dueDate: task.dueDate || '',
      priority: task.priority || '中',
      status: task.status,
      savings: task.savings,
      note: task.note || '',
    })
  }
  const startSnsInline = (post: SnsPost) => {
    setSnsInlineId(post.id)
    setSnsInlineForm({ postDate: post.postDate, platform: post.platform, account: post.account, comments: post.comments, saves: post.saves })
  }
  const startRecruitmentInline = (record: RecruitmentRecord) => {
    setRecruitmentInlineId(record.id)
    setRecruitmentInlineForm({ date: record.date, platform: record.platform, department: record.department, jobType: record.jobType, costReduction: record.costReduction })
  }

  // インライン編集 保存
  const saveTaskInline = async () => {
    if (!taskInlineId) return
    let formToSave = { ...taskInlineForm }
    // 継続案件を完了にした際、完了日が未設定なら今日をセット
    if (formToSave.taskType === '継続' && formToSave.status === '完了' && !formToSave.dueDate) {
      formToSave = { ...formToSave, dueDate: new Date().toISOString().split('T')[0] }
    }
    await supabase.from('tasks').update(normalizeTask(formToSave)).eq('id', taskInlineId)
    setTaskInlineId(null)
    fetchTasks()
  }
  const saveSnsInline = async () => {
    if (!snsInlineId) return
    await supabase.from('sns_posts').update(normalizePost(snsInlineForm)).eq('id', snsInlineId)
    setSnsInlineId(null)
    fetchPosts()
  }
  const saveRecruitmentInline = async () => {
    if (!recruitmentInlineId) return
    await supabase.from('recruitment').update(normalizeRecruitment(recruitmentInlineForm)).eq('id', recruitmentInlineId)
    setRecruitmentInlineId(null)
    fetchRecruitment()
  }

  // ステータスのみ即時更新（行を編集モードにしなくてもOK）
  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    const task = tasks.find((t) => t.id === id)
    const updateData: Partial<Task> = { status }
    // 継続案件を完了にした際、完了日が未設定なら今日をセット
    if (status === '完了' && task?.taskType === '継続' && !task?.dueDate) {
      updateData.dueDate = new Date().toISOString().split('T')[0]
    }
    await supabase.from('tasks').update(updateData).eq('id', id)
    fetchTasks()
  }

  const googleLogin = useGoogleLogin({
    scope: GOOGLE_LOGIN_SCOPE,
    prompt: 'select_account',
    onSuccess: async (res) => {
      await applyLoginAccess(res.access_token, {
        saveSession: true,
        expiresIn: res.expires_in ?? 3600,
      })
    },
    onError: () => {
      clearToken()
      setCurrentUserEmail(null)
      setAuthError('Googleログインに失敗しました。もう一度お試しください。')
      setAuthLoading(false)
    },
  })

  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
    return (
      <div className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">WEB Strategic Team</p>
          <h1>この管理ツールはGoogleログインが必要です</h1>
          <p className="intro">Vercelの環境変数に `VITE_GOOGLE_CLIENT_ID` が入っていないため、ログイン画面を出せません。</p>
        </section>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">WEB Strategic Team</p>
          <h1>ログイン確認中です</h1>
          <p className="intro">少しだけお待ちください。</p>
        </section>
      </div>
    )
  }

  if (!currentUserEmail) {
    return (
      <div className="auth-screen">
        <section className="auth-card">
          <p className="eyebrow">WEB Strategic Team</p>
          <h1>Googleログインが必要です</h1>
          <p className="intro">許可されているGoogleアカウントだけ、この管理ツールを開けます。</p>
          {authError && <p className="auth-error">{authError}</p>}
          <button className="primary auth-login-button" onClick={() => googleLogin()}>Googleでログイン</button>
        </section>
      </div>
    )
  }

  return (
    <OfficeNetworkGate allowOutsideOffice={canUseOutsideOffice}>
      <div className={`app-shell${isPrimaryNavCollapsed ? ' nav-collapsed' : ''}`}>
      <div className="auth-topbar">
        <div className="auth-user-box auth-user-box-top">
          <span className="auth-user-email">{currentUserEmail}</span>
          {isMasterUser && (
            <button
              className="auth-master-button"
              onClick={() => {
                setAllowedAccountMessage('')
                setShowAllowedAccountsModal(true)
              }}
            >
              マスター
            </button>
          )}
          <button className="secondary" onClick={logoutFromApp}>ログアウト</button>
        </div>
      </div>
      <header className="app-header">
        <div>
          <p className="eyebrow">WEB Strategic Team</p>
          <h1>WEB戦略チーム管理表</h1>
          <p className="intro">社内依頼、SNS運用、採用導線をひとつの画面で追える管理ツール</p>
        </div>
        <div className="header-panel header-panel-auth">
          <button
            type="button"
            className="nav-collapse-button"
            aria-expanded={!isPrimaryNavCollapsed}
            aria-controls="primary-nav"
            onClick={() => setIsPrimaryNavCollapsed((current) => !current)}
          >
            {isPrimaryNavCollapsed ? 'タブ一覧を表示' : 'タブ一覧を非表示'}
          </button>
          <label>
            年
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}年</option>
              ))}
            </select>
          </label>
          <label>
            月
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              <option value="all">全年月</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={String(month)}>{month}月</option>
              ))}
            </select>
          </label>
          <div className="auth-user-box">
            <span className="auth-user-email">{currentUserEmail}</span>
            {isMasterUser && <span className="auth-master-badge">マスター</span>}
            <button className="secondary" onClick={logoutFromApp}>ログアウト</button>
          </div>
        </div>
      </header>

      <div className="nav-control-row">
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-expanded={isMobileNavOpen}
          aria-controls="primary-nav"
          onClick={() => setIsMobileNavOpen((current) => !current)}
        >
          <span>メニュー</span>
          <strong>{TAB_ITEMS.find((item) => item.key === activePage)?.label ?? 'ページ'}</strong>
        </button>
      </div>

      <nav
        id="primary-nav"
        className={`tab-nav${isMobileNavOpen ? ' mobile-open' : ''}${isPrimaryNavCollapsed ? ' is-collapsed' : ''}`}
        aria-label="主要メニュー"
        aria-hidden={isPrimaryNavCollapsed}
      >
        {TAB_ITEMS.map((item) => (
          <button
            key={item.key}
            className={activePage === item.key ? 'active' : ''}
            onClick={() => {
              setActivePage(item.key)
              setShowModal(false)
              setIsMobileNavOpen(false)
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="page-content">
        {activePage === 'dashboard' && (
          <section className="dashboard-grid">
            <div className="stat-card strong"><span>総貢献額</span><strong>{currency.format(totalContribution)}</strong><small>店舗売上 + 案件削減額 + 採用削減額</small></div>
            <div className="stat-card"><span>店舗売上</span><strong>{currency.format(jishaStoreSalesTotal)}</strong><small>自社集客売上の実績合計</small></div>
            <div className="stat-card"><span>案件削減額</span><strong>{currency.format(taskSavingsTotal)}</strong><small>案件管理の削減額合計</small></div>
            <div className="stat-card"><span>採用削減額</span><strong>{currency.format(recruitmentSummary.costReduction)}</strong><small>採用管理の削減額合計</small></div>

            <section className="panel dashboard-list-panel dashboard-full-panel">
              <div className="panel-heading"><div><h2>1週間の予定</h2><p>1週間以内の期日と予定をまとめて表示</p></div></div>
              <div className="ongoing-list">
                {weeklySchedules.length === 0 && <p className="empty-text">1週間以内の予定はありません。</p>}
                {weeklySchedules.map((item) => (
                  <article className="ongoing-item dashboard-schedule-item" key={item.id}>
                    <div className="dashboard-schedule-main">
                      <span className="schedule-source-badge">{item.source}</span>
                      <strong>{item.title}</strong>
                      <p className="dashboard-schedule-detail">{item.detail}</p>
                    </div>
                    <div className="dashboard-schedule-date">
                      <span>{formatDashboardScheduleDate(item.date, item.start_time)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel dashboard-list-panel">
              <div className="panel-heading"><div><h2>WEBチームタスク</h2><p>今日から3日以内が期日のタスク</p></div></div>
              <div className="ongoing-list">
                {webTeamTasks.length === 0 && <p className="empty-text">期日が3日以内のタスクはありません。</p>}
                {webTeamTasks.map((item) => (
                  <article className="ongoing-item dashboard-task-item dashboard-compact-item" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.memo || 'メモなし'}</p>
                    </div>
                    <div>
                      <span>担当: {getTaskItemPrimaryAssignee(item) || '未設定'}</span>
                      <span>設定者: {item.creator || '未設定'}</span>
                      <span>期日: {item.due_date}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel dashboard-list-panel">
              <div className="panel-heading"><div><h2>進行中案件</h2><p>ステータスが「作業中」の案件一覧</p></div></div>
              <div className="ongoing-list">
                {ongoingTasks.length === 0 && <p className="empty-text">該当する進行中案件はありません。</p>}
                {ongoingTasks.map((task) => (
                  <article className="ongoing-item dashboard-task-item dashboard-compact-item" key={task.id}>
                    <div><strong>{task.name}</strong><p>{task.department} / {task.taskType} / 優先度: {task.priority}</p></div>
                    <div><span>担当: {(task.assignees || []).join('・')}</span><span>期日: {task.dueDate}</span></div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        )}

        {/* ===== 案件管理 ===== */}
        {activePage === 'tasks' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading">
                <div><h2>案件一覧</h2><p>行をクリックして直接編集・現状はその場で変更可能</p></div>
                <div className="task-toolbar">
                  <select
                    value={taskAssigneeFilter}
                    onChange={(e) => setTaskAssigneeFilter(e.target.value)}
                  >
                    <option value="all">全担当者</option>
                    {assigneeOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <label className="task-show-completed">
                    <input
                      type="checkbox"
                      checked={taskShowCompleted}
                      onChange={(e) => setTaskShowCompleted(e.target.checked)}
                    />
                    完了を表示
                  </label>
                </div>
              </div>
              <div className="table-wrap">
                <table className="compact-list-table">
                  <thead>
                    <tr>
                      <th>案件日</th><th>担当者</th><th>依頼部署</th><th>案件名</th><th>案件内容</th>
                      <th>種類</th><th>期日</th><th>優先度</th><th>現状</th><th>削減額</th><th>補足</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedTasks.length === 0 && (
                      <tr><td colSpan={12} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>該当する案件がありません</td></tr>
                    )}
                    {filteredAndSortedTasks.map((task) => {
                      const isEditing = taskInlineId === task.id
                      const f = taskInlineForm
                      return (
                        <tr
                          key={task.id}
                          className={isEditing ? 'row-editing' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startTaskInline(task) }}
                        >
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.taskDate} onChange={(e) => setTaskInlineForm({ ...f, taskDate: e.target.value })} /> : task.taskDate}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <div className="inline-checkbox-group">{assigneeOptions.map((a) => (
                                  <label key={a} className="inline-checkbox-item">
                                    <input type="checkbox" checked={f.assignees.includes(a)} onChange={(e) => {
                                      const next = e.target.checked ? [...f.assignees, a] : f.assignees.filter((x) => x !== a)
                                      setTaskInlineForm({ ...f, assignees: next })
                                    }} />{a}
                                  </label>
                                ))}</div>
                              : (task.assignees || []).join('・')}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.department} onChange={(e) => setTaskInlineForm({ ...f, department: e.target.value as Department })}>{departments.map((d) => <option key={d}>{d}</option>)}</select> : task.department}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" value={f.name} onChange={(e) => setTaskInlineForm({ ...f, name: e.target.value })} /> : task.name}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" value={f.content} onChange={(e) => setTaskInlineForm({ ...f, content: e.target.value })} /> : <span className="cell-truncate" title={task.content}>{task.content}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.taskType} onChange={(e) => setTaskInlineForm({ ...f, taskType: e.target.value as TaskType })}>{taskTypes.map((t) => <option key={t}>{t}</option>)}</select> : task.taskType}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.dueDate} onChange={(e) => setTaskInlineForm({ ...f, dueDate: e.target.value })} /> : task.dueDate}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.priority} onChange={(e) => setTaskInlineForm({ ...f, priority: e.target.value as Priority })}>{priorityOptions.map((p) => <option key={p}>{p}</option>)}</select>
                              : <span className={`priority priority-${task.priority}`}>{task.priority}</span>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              className={`status-select status-${isEditing ? f.status : task.status}`}
                              value={isEditing ? f.status : task.status}
                              onChange={async (e) => {
                                const newStatus = e.target.value as TaskStatus
                                if (isEditing) {
                                  setTaskInlineForm({ ...f, status: newStatus })
                                } else {
                                  await updateTaskStatus(task.id, newStatus)
                                }
                              }}
                            >
                              {taskStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.savings} onChange={(e) => setTaskInlineForm({ ...f, savings: Number(e.target.value) })} /> : currency.format(task.savings)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" value={f.note} onChange={(e) => setTaskInlineForm({ ...f, note: e.target.value })} /> : <span className="cell-truncate" title={task.note}>{task.note}</span>}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveTaskInline}>保存</button>
                                  <button className="secondary" onClick={() => setTaskInlineId(null)}>×</button>
                                </>
                              ) : (
                                <button className="danger" onClick={() => confirmAndDeleteRecord('tasks', task.id, fetchTasks, 'この業務管理の項目を本当に削除しますか？')}>削除</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ===== タスク管理 ===== */}
        {activePage === 'taskmanagement' && (
          <section className="taskmanagement-page">
            {/* ヘッダー: 検索・フィルター・自分設定 */}
            <div className="tm-toolbar">
              <select className="tm-filter-select" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value as 'all' | TaskItemStatus | 'overdue')}>
                <option value="all">すべて</option>
                <option value={taskItemStatuses[0]}>未着手</option>
                <option value={taskItemStatuses[1]}>進行中</option>
                <option value={taskItemStatuses[2]}>完了</option>
                <option value="overdue">期限切れ</option>
              </select>
              <input className="tm-search" placeholder="タスク名で検索..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
              <select className="tm-filter-select" value={taskItemAssigneeFilter} onChange={(e) => setTaskItemAssigneeFilter(e.target.value)}>
                <option value="all">担当者一覧</option>
                {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
              <label className="tm-completed-toggle">
                <input type="checkbox" checked={taskItemShowCompleted} onChange={(e) => setTaskItemShowCompleted(e.target.checked)} />
                完了表示
              </label>
            </div>
            {taskError && <p className="error-msg">{taskError}</p>}

            {/* タスク一覧テーブル */}
            <section className="panel tm-table-panel">
              <div className="table-wrap">
                <table className="tm-table">
                  <colgroup>
                    <col className="tm-col-date" />
                    <col className="tm-col-memo" />
                    <col className="tm-col-name" />
                    <col className="tm-col-pri" />
                    <col className="tm-col-work" />
                    <col className="tm-col-due" />
                    <col className="tm-col-repeat" />
                    <col className="tm-col-assign" />
                    <col className="tm-col-creator" />
                    <col className="tm-col-status" />
                    <col className="tm-col-action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>日付</th><th>メモ</th><th>タスク名</th><th>優先度</th><th>作業日</th><th>期日</th><th>繰返</th>
                      <th>担当者</th><th>設定者</th><th>ステータス</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTaskItems.length === 0 && (
                      <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '24px' }}>タスクがありません</td></tr>
                    )}
                    {taskItemsToRender.map((item) => {
                      const isEditing = taskItemInlineId === item.id
                      const f = taskItemInlineForm
                      const overdue = item.due_date && item.due_date < today && item.status !== '完了'
                      const childItems = childTaskItemsByParent[item.id] || []
                      const showChildren = isParentTaskExpanded(item.id)
                      return (
                        <Fragment key={item.id}>
                        <tr className={`${isEditing ? 'row-editing' : 'row-hoverable'} ${overdue ? 'row-overdue' : ''}`}
                          onClick={() => {
                            if (!isEditing) startTaskItemInline(item)
                          }}>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.date} onChange={(e) => setTaskItemInlineForm({ ...f, date: e.target.value })} /> : item.date}
                          </td>
                          <td onClick={(e) => { e.stopPropagation(); if (!isEditing && item.memo) setMemoToView(item.memo) }}>
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', minHeight: '24px', cursor: (!isEditing && item.memo) ? 'pointer' : 'default' }}>
                              {isEditing 
                                ? <input className="inline-input" placeholder="メモ" value={f.memo} onChange={(e) => setTaskItemInlineForm({ ...f, memo: e.target.value })} onClick={(e) => e.stopPropagation()} />
                                : (item.memo ? <span className="memo-icon" title="メモを表示" onClick={(e) => { e.stopPropagation(); setMemoToView(item.memo) }}>📝</span> : <span style={{ color: '#ccc' }}>-</span>)
                              }
                            </div>
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            <div className="tm-name-cell">
                              <div className="tm-name-main">
                                {overdue && <span className="tag-overdue">期限切れ</span>}
                                {isEditing ? <input className="inline-input tm-name-input" value={f.name} onChange={(e) => setTaskItemInlineForm({ ...f, name: e.target.value })} /> : item.name}
                              </div>
                              {childItems.length > 0 && (
                                <button
                                  type="button"
                                  className="tm-child-toggle"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleParentTaskExpanded(item.id)
                                  }}
                                >
                                  <span className="tm-child-toggle-label">{showChildren ? '閉じる' : '子タスク'}</span>
                                  <span className="tm-child-badge">{childItems.length}</span>
                                </button>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.priority} onChange={(e) => setTaskItemInlineForm({ ...f, priority: e.target.value as Priority })}>{priorityOptions.map((p) => <option key={p}>{p}</option>)}</select>
                              : <span className={`priority priority-${item.priority}`}>{item.priority}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.work_date} onChange={(e) => setTaskItemInlineForm({ ...f, work_date: e.target.value })} /> : item.work_date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.due_date} onChange={(e) => setTaskItemInlineForm({ ...f, due_date: e.target.value })} /> : item.due_date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? (
                              <select
                                className="inline-select"
                                value={f.parent_task_id ? 'none' : (f.recurring_type || 'none')}
                                disabled={!!f.parent_task_id}
                                onChange={(e) => setTaskItemInlineForm({ ...f, recurring_type: e.target.value as TaskItemRecurrence })}
                              >
                                <option value="none">なし</option>
                                <option value="monthly">毎月</option>
                              </select>
                            ) : (
                              item.recurring_type === 'monthly' ? '毎月' : '-'
                            )}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? (
                                <><div className="inline-checkbox-group">{members.map((m) => (<label key={m.id} className="inline-checkbox-item"><input type="checkbox" checked={f.assignees.includes(m.name)} onChange={(e) => { const next = e.target.checked ? [...f.assignees, m.name] : f.assignees.filter((name) => name !== m.name); setTaskItemInlineForm({ ...f, assignees: getUniqueTaskItemAssignees(next) }) }} />{m.name}</label>))}</div><select style={{ display: 'none' }}
                                  className="inline-select"
                                  value={f.assignees[0] || ''}
                                  onChange={(e) => setTaskItemInlineForm({ ...f, assignees: e.target.value ? [e.target.value] : [] })}
                                >
                                  <option value="">未設定</option>
                                  {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                                </select></>
                              )
                              : getTaskItemPrimaryAssignee(item)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <div className="inline-checkbox-group">{members.map((m) => (
                                  <label key={m.id} className="inline-checkbox-item">
                                    <input type="checkbox" checked={f.creator === m.name} onChange={() => setTaskItemInlineForm({ ...f, creator: m.name })} />{m.name}
                                  </label>
                                ))}</div>
                              : item.creator}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select className={`status-select status-ti-${isEditing ? f.status : item.status}`}
                              value={isEditing ? f.status : item.status}
                              onChange={async (e) => {
                                const s = e.target.value as TaskItemStatus
                                if (isEditing) setTaskItemInlineForm({ ...f, status: s })
                                else await updateTaskItemStatus(item.id, s)
                              }}>
                              {taskItemStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveTaskItemInline}>保存</button>
                                  <button className="secondary" onClick={() => setTaskItemInlineId(null)}>×</button>
                                </>
                              ) : (
                                <button className="danger" onClick={() => deleteTaskItemWithChildren(item)}>削除</button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {showChildren && childItems.map((child) => {
                          const childEditing = taskItemInlineId === child.id
                          const childForm = taskItemInlineForm
                          const childOverdue = child.due_date && child.due_date < today && child.status !== '完了'
                          return (
                            <Fragment key={child.id}>
                            <tr className={`tm-child-row ${childEditing ? 'row-editing' : 'row-hoverable'} ${childOverdue ? 'row-overdue' : ''}`}
                              onClick={() => {
                                if (!childEditing) startTaskItemInline(child)
                              }}>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing ? <input className="inline-input" type="date" value={childForm.date} onChange={(e) => setTaskItemInlineForm({ ...childForm, date: e.target.value })} /> : child.date}
                              </td>
                              <td onClick={(e) => { e.stopPropagation(); if (!childEditing && child.memo) setMemoToView(child.memo) }}>
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', minHeight: '24px', cursor: (!childEditing && child.memo) ? 'pointer' : 'default' }}>
                                  {childEditing
                                    ? <input className="inline-input" placeholder="メモ" value={childForm.memo} onChange={(e) => setTaskItemInlineForm({ ...childForm, memo: e.target.value })} onClick={(e) => e.stopPropagation()} />
                                    : (child.memo ? <span className="memo-icon" title="メモを表示" onClick={(e) => { e.stopPropagation(); setMemoToView(child.memo) }}>📝</span> : <span style={{ color: '#ccc' }}>-</span>)
                                  }
                                </div>
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                <div className="tm-name-cell">
                                  <div className="tm-name-main">
                                    <span className="tm-child-badge">子</span>
                                    {childOverdue && <span className="tag-overdue">期限切れ</span>}
                                    {childEditing ? <input className="inline-input tm-name-input" value={childForm.name} onChange={(e) => setTaskItemInlineForm({ ...childForm, name: e.target.value })} /> : child.name}
                                  </div>
                                </div>
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing
                                  ? <select className="inline-select" value={childForm.priority} onChange={(e) => setTaskItemInlineForm({ ...childForm, priority: e.target.value as Priority })}>{priorityOptions.map((p) => <option key={p}>{p}</option>)}</select>
                                  : <span className={`priority priority-${child.priority}`}>{child.priority}</span>}
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing ? <input className="inline-input" type="date" value={childForm.work_date} onChange={(e) => setTaskItemInlineForm({ ...childForm, work_date: e.target.value })} /> : child.work_date}
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing ? <input className="inline-input" type="date" value={childForm.due_date} onChange={(e) => setTaskItemInlineForm({ ...childForm, due_date: e.target.value })} /> : child.due_date}
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing ? (
                                  <select className="inline-select" value={childForm.recurring_type || 'none'} disabled>
                                    <option value="none">なし</option>
                                    <option value="monthly">毎月</option>
                                  </select>
                                ) : (child.recurring_type === 'monthly' ? '毎月' : '-')}
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing
                                  ? (
                                    <><div className="inline-checkbox-group">{members.map((m) => (<label key={m.id} className="inline-checkbox-item"><input type="checkbox" checked={childForm.assignees.includes(m.name)} onChange={(e) => { const next = e.target.checked ? [...childForm.assignees, m.name] : childForm.assignees.filter((name) => name !== m.name); setTaskItemInlineForm({ ...childForm, assignees: getUniqueTaskItemAssignees(next) }) }} />{m.name}</label>))}</div><select style={{ display: 'none' }}
                                      className="inline-select"
                                      value={childForm.assignees[0] || ''}
                                      onChange={(e) => setTaskItemInlineForm({ ...childForm, assignees: e.target.value ? [e.target.value] : [] })}
                                    >
                                      <option value="">未設定</option>
                                      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                                    </select></>
                                  )
                                  : getTaskItemPrimaryAssignee(child)}
                              </td>
                              <td onClick={(e) => childEditing && e.stopPropagation()}>
                                {childEditing
                                  ? <div className="inline-checkbox-group">{members.map((m) => (
                                      <label key={m.id} className="inline-checkbox-item">
                                        <input type="checkbox" checked={childForm.creator === m.name} onChange={() => setTaskItemInlineForm({ ...childForm, creator: m.name })} />{m.name}
                                      </label>
                                    ))}</div>
                                  : child.creator}
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <select className={`status-select status-ti-${childEditing ? childForm.status : child.status}`}
                                  value={childEditing ? childForm.status : child.status}
                                  onChange={async (e) => {
                                    const s = e.target.value as TaskItemStatus
                                    if (childEditing) setTaskItemInlineForm({ ...childForm, status: s })
                                    else await updateTaskItemStatus(child.id, s)
                                  }}>
                                  {taskItemStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <div className="row-actions">
                                  {childEditing ? (
                                    <>
                                      <button className="primary" onClick={saveTaskItemInline}>保存</button>
                                      <button className="secondary" onClick={() => setTaskItemInlineId(null)}>×</button>
                                    </>
                                  ) : (
                                    <button className="danger" onClick={() => deleteTaskItemWithChildren(child)}>削除</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            </Fragment>
                          )
                        })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* メンバー管理 */}
            <section className="panel">
              <h2 style={{ margin: '0 0 4px' }}>メンバー設定</h2>
              <p style={{ margin: '0 0 12px', color: 'var(--gray-400)', fontSize: '0.82rem' }}>SlackユーザーIDを設定すると@メンションで通知されます</p>
              <button
                className="secondary"
                onClick={() => setMemberSettingOpen(o => !o)}
                style={{ marginBottom: memberSettingOpen ? '16px' : '0' }}
              >
                {memberSettingOpen ? '▲ メンバー一覧を閉じる' : '▼ メンバー一覧を開く'}
              </button>
              {memberSettingOpen && (
                <div className="member-slack-list">
                  {members.map((m) => (
                    <div key={m.id} className="member-slack-row">
                      <span className="member-slack-name">{m.name}</span>
                      {memberEditId === m.id ? (
                        <>
                          <input className="inline-input" placeholder="SlackユーザーID（例: U12345678）" value={memberEditSlack} onChange={(e) => setMemberEditSlack(e.target.value)} style={{ flex: 1 }} />
                          <button className="primary" onClick={() => saveMemberSlack(m.id)}>保存</button>
                          <button className="secondary" onClick={() => setMemberEditId(null)}>×</button>
                        </>
                      ) : (
                        <>
                          <span className="member-slack-id">{m.slack_user_id || '未設定'}</span>
                          <button className="secondary" onClick={() => { setMemberEditId(m.id); setMemberEditSlack(m.slack_user_id) }}>編集</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

          </section>
        )}

        {/* ===== SNS投稿管理 ===== */}
        {activePage === 'sns' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>SNS投稿一覧</h2><p>行をクリックして直接編集</p></div></div>
              <div className="table-wrap">
                <table className="compact-list-table">
                  <thead>
                    <tr><th>投稿日</th><th>媒体</th><th>アカウント</th><th>コメント</th><th>保存</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {posts.map((post) => {
                      const isEditing = snsInlineId === post.id
                      const f = snsInlineForm
                      return (
                        <tr
                          key={post.id}
                          className={isEditing ? 'row-editing' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startSnsInline(post) }}
                        >
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.postDate} onChange={(e) => setSnsInlineForm({ ...f, postDate: e.target.value })} /> : post.postDate}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.platform} onChange={(e) => setSnsInlineForm({ ...f, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p}>{p}</option>)}</select> : post.platform}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.account} onChange={(e) => setSnsInlineForm({ ...f, account: e.target.value })}>{snsAccounts.map((a) => <option key={a}>{a}</option>)}</select> : post.account}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.comments} onChange={(e) => setSnsInlineForm({ ...f, comments: Number(e.target.value) })} /> : integer.format(post.comments)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.saves} onChange={(e) => setSnsInlineForm({ ...f, saves: Number(e.target.value) })} /> : integer.format(post.saves)}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveSnsInline}>保存</button>
                                  <button className="secondary" onClick={() => setSnsInlineId(null)}>×</button>
                                </>
                              ) : (
                                <button className="danger" onClick={() => confirmAndDeleteRecord('sns_posts', post.id, fetchPosts, 'このSNS記録を本当に削除しますか？')}>削除</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activePage === 'snsproperty' && (
          <>
            <div className="sns-property-subtabs">
              {snsPropertyTabs.map((tab) => (
                <button
                  key={tab.key}
                  className={activeSnsPropertyPlatform === tab.key ? 'active' : ''}
                  onClick={() => { setActiveSnsPropertyPlatform(tab.key) }}
                >{tab.label}</button>
              ))}
            </div>

            {activeSnsPropertyPlatform === 'sokanri' && (
              <section className="panel table-panel sokanri-panel">
                <div className="sokanri-header">
                  <h2>総管理</h2>
                  <div className="sokanri-week-nav">
                    <button
                      type="button"
                      className="sokanri-nav-btn"
                      onClick={() => setSokanriWeekOffset((prev) => prev - 1)}
                    >
                      ← 前の週
                    </button>
                    {sokanriWeekOffset < 0 && (
                      <button
                        type="button"
                        className="sokanri-nav-btn sokanri-nav-today"
                        onClick={() => setSokanriWeekOffset(0)}
                      >
                        今週へ戻る
                      </button>
                    )}
                    <button
                      type="button"
                      className="sokanri-nav-btn"
                      onClick={() => setSokanriWeekOffset((prev) => prev + 1)}
                      disabled={sokanriWeekOffset >= 0}
                    >
                      次の週 →
                    </button>
                  </div>
                  <button type="button" className="sokanri-settings-btn" onClick={() => setSokanriSettingsOpen(true)}>
                    ⚙ 投稿ルール設定
                  </button>
                </div>

                {sokanriLoading ? (
                  <div>読み込み中...</div>
                ) : (
                  <div className="table-wrap">
                    <table className="sokanri-table">
                      <thead>
                        <tr>
                          <th className="sokanri-th-account">アカウント</th>
                          <th className="sokanri-th-platform">媒体</th>
                          {sokanriDays.map((date) => (
                            <th
                              key={date.toISOString()}
                              className={`sokanri-th-day${date.getDay() === 0 ? ' sokanri-sunday' : date.getDay() === 6 ? ' sokanri-saturday' : ''}`}
                            >
                              <div>{date.getMonth() + 1}/{date.getDate()}</div>
                              <div className="sokanri-day-label">{DAY_LABELS[date.getDay()]}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {SOKANRI_ROWS.map((row) => {
                          const platStyle = PLATFORM_LABEL_STYLE[row.platform]
                          return (
                            <tr key={row.apKey} style={{ backgroundColor: row.accountColor }}>
                              <td className="sokanri-td-account">{row.account}</td>
                              <td className="sokanri-td-platform">
                                <span className="sokanri-platform-badge" style={{ backgroundColor: platStyle.bg, color: platStyle.color }}>
                                  {row.platform}
                                </span>
                              </td>
                              {sokanriDays.map((date) => {
                                const status = getSokanriCellStatus(row.apKey, date)
                                return (
                                  <td
                                    key={date.toISOString()}
                                    className={`sokanri-td-cell sokanri-status-${status === '✅' ? 'done' : status === '⚠️' ? 'warn' : 'none'}`}
                                  >
                                    {status}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {sokanriSettingsOpen && (
                  <div className="modal-overlay" onClick={() => setSokanriSettingsOpen(false)}>
                    <div className="modal-content sokanri-settings-modal" onClick={(event) => event.stopPropagation()}>
                      <div className="modal-header">
                        <h3 className="modal-title">投稿ルール設定</h3>
                        <button className="modal-close" onClick={() => setSokanriSettingsOpen(false)}>×</button>
                      </div>
                      <div className="sokanri-settings-body">
                        <p className="sokanri-settings-desc">各アカウント×媒体の投稿曜日にチェックを入れてください。</p>
                        <table className="sokanri-settings-table">
                          <thead>
                            <tr>
                              <th>アカウント</th>
                              <th>媒体</th>
                              {DAY_LABELS.map((label, index) => <th key={index}>{label}</th>)}
                              <th>間隔指定</th>
                            </tr>
                          </thead>
                          <tbody>
                            {SOKANRI_ROWS.map((row) => {
                              const intervalRule = snsPostingRules.find(
                                (rule) => rule.account_platform_key === row.apKey && rule.rule_type === 'interval',
                              )

                              return (
                                <tr key={row.apKey} style={{ backgroundColor: row.accountColor }}>
                                  <td>{row.account}</td>
                                  <td>
                                    <span className="sokanri-platform-badge" style={{ backgroundColor: PLATFORM_LABEL_STYLE[row.platform].bg, color: PLATFORM_LABEL_STYLE[row.platform].color }}>
                                      {row.platform}
                                    </span>
                                  </td>
                                  {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
                                    const checked = snsPostingRules.some(
                                      (rule) => rule.account_platform_key === row.apKey && rule.rule_type === 'weekday' && rule.day_of_week === dayOfWeek,
                                    )
                                    return (
                                      <td key={dayOfWeek} className="sokanri-settings-check">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(event) => void saveSokanriRule(row.apKey, dayOfWeek, event.target.checked)}
                                        />
                                      </td>
                                    )
                                  })}
                                  <td className="sokanri-settings-interval">
                                    {intervalRule ? (
                                      <div className="sokanri-interval-active">
                                        <span className="sokanri-interval-badge">
                                          {intervalRule.reference_date}〜 {intervalRule.interval_days}日ごと
                                        </span>
                                        <button
                                          type="button"
                                          className="sokanri-interval-delete"
                                          onClick={() => void deleteIntervalRule(row.apKey)}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="sokanri-interval-form">
                                        <input
                                          type="date"
                                          className="sokanri-interval-input-date"
                                          defaultValue={new Date().toISOString().slice(0, 10)}
                                          id={`interval-date-${row.apKey}`}
                                        />
                                        <input
                                          type="number"
                                          className="sokanri-interval-input-days"
                                          defaultValue="3"
                                          min="1"
                                          max="30"
                                          id={`interval-days-${row.apKey}`}
                                        />
                                        <span>日ごと</span>
                                        <button
                                          type="button"
                                          className="sokanri-interval-save"
                                          onClick={() => {
                                            const dateEl = document.getElementById(`interval-date-${row.apKey}`) as HTMLInputElement | null
                                            const daysEl = document.getElementById(`interval-days-${row.apKey}`) as HTMLInputElement | null
                                            if (dateEl && daysEl && daysEl.value) {
                                              void saveIntervalRule(row.apKey, parseInt(daysEl.value, 10), dateEl.value)
                                            }
                                          }}
                                        >
                                          設定
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeSnsPropertyPlatform === 'tiktok' && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div><h2>Karilun｜TikTok 物件管理</h2></div>
                  <div className="sns-property-toolbar">
                    <input
                      className="sns-property-search-input"
                      value={snsPropertySearch.tiktok}
                      onChange={(e) => updateSnsPropertySearch('tiktok', e.target.value)}
                      placeholder="物件番号で検索"
                    />
                    {snsPropertySearch.tiktok && (
                      <button type="button" className="secondary" onClick={() => updateSnsPropertySearch('tiktok', '')}>×</button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void syncTiktokPropertiesToSheet()}
                      disabled={snsTiktokSheetSyncing}
                    >
                      {snsTiktokSheetSyncing ? '反映中...' : '今すぐ反映'}
                    </button>
                    <button type="button" className="primary" onClick={() => openSnsPropertyCreate('tiktok')}>新規登録</button>
                  </div>
                </div>
                <div className="table-wrap sns-property-table-wrap">
                  <table className="compact-list-table sns-property-table">
                    <thead>
                      <tr>
                        <th className="sns-col-memo">メモ</th>
                        <th className="sns-col-check">
                          <SnsPropertyHeader title="WP登録" />
                        </th>
                        <th className="sns-col-check">
                          <SnsPropertyHeader title="AOS登録" />
                        </th>
                        <th className="sns-col-date">投稿日</th>
                        <th className="sns-col-code">物件番号</th><th className="sns-col-plan">間取り</th><th className="sns-col-rent">家賃</th><th className="sns-col-area">エリア</th>
                        <th className="sns-col-station">最寄り駅</th><th className="sns-col-link">資料</th><th className="sns-col-property-name">物件名</th><th className="sns-col-room">号室</th>
                        <th className="sns-col-address">住所</th><th className="sns-col-source">資料取得先</th><th className="sns-col-company">管理会社</th><th className="sns-col-contact">連絡先</th><th className="sns-col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiktokProperties.length === 0 && (
                        <tr><td colSpan={17} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                      )}
                      {tiktokProperties.map((r) => {
                        return (
                          <tr key={r.id} className="row-hoverable">
                            <td className="sns-col-memo">{renderSnsMemoCell('sns_tiktok_properties', r.id, r.memo)}</td>
                            <td className="sns-col-check">{renderSnsSelect(r.wp_registered, getSnsPropertySelectOptions('wp_registered'), (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'wp_registered', value, setTiktokProperties), () => openSnsPropertyOptionEditor('wp_registered', 'WP登録'))}</td>
                            <td className="sns-col-check">{renderSnsSelect(r.aos_registered, getSnsPropertySelectOptions('aos_registered'), (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'aos_registered', value, setTiktokProperties), () => openSnsPropertyOptionEditor('aos_registered', 'AOS登録'))}</td>
                            <td className="sns-col-date">{renderSnsTextInput(`${r.id}:post_date`, normalizeSnsPropertyPostDate(r.post_date, r.property_number), (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'post_date', value, setTiktokProperties), { type: 'date' })}</td>
                            <td className="sns-col-code">{renderSnsTextInput(`${r.id}:property_number`, r.property_number, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'property_number', value, setTiktokProperties))}</td>
                            <td className="sns-col-plan">{renderSnsTextInput(`${r.id}:floor_plan`, r.floor_plan, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'floor_plan', value, setTiktokProperties))}</td>
                            <td className="sns-col-rent">{renderSnsTextInput(`${r.id}:rent`, r.rent, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'rent', value, setTiktokProperties))}</td>
                            <td className="sns-col-area">{renderSnsTextInput(`${r.id}:area`, r.area, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'area', value, setTiktokProperties))}</td>
                            <td className="sns-col-station">{renderSnsTextInput(`${r.id}:nearest_station`, r.nearest_station, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'nearest_station', value, setTiktokProperties))}</td>
                            <td className="sns-col-link" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="sns-link-button" title={r.document_url || '資料URLを入力'} onClick={() => editSnsPropertyUrl('sns_tiktok_properties', r.id, r.document_url, setTiktokProperties)}>
                                🔗
                              </button>
                            </td>
                            <td className="sns-col-property-name">{renderSnsTextInput(`${r.id}:property_name`, r.property_name, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'property_name', value, setTiktokProperties))}</td>
                            <td className="sns-col-room">{renderSnsTextInput(`${r.id}:room_number`, r.room_number, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'room_number', value, setTiktokProperties))}</td>
                            <td className="sns-col-address">{renderSnsTextInput(`${r.id}:address`, r.address, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'address', value, setTiktokProperties))}</td>
                            <td className="sns-col-source">{renderSnsSelect(r.acquisition_source, getSnsPropertySelectOptions('acquisition_source'), (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'acquisition_source', value, setTiktokProperties), () => openSnsPropertyOptionEditor('acquisition_source', '資料取得先'))}</td>
                            <td className="sns-col-company">{renderSnsTextInput(`${r.id}:management_company`, r.management_company, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'management_company', value, setTiktokProperties))}</td>
                            <td className="sns-col-contact">{renderSnsTextInput(`${r.id}:contact`, r.contact, (value) => updateSnsPropertyRow('sns_tiktok_properties', r.id, 'contact', value, setTiktokProperties))}</td>
                            <td className="sns-col-actions">
                              <div className="row-actions">
                                <button className="danger" onClick={() => confirmAndDeleteRecord('sns_tiktok_properties', r.id, fetchTiktokProperties, 'このレコードを削除しますか？', () => scheduleSnsPropertySheetSync('tiktok'))}>削除</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {renderSnsPropertyPagination()}
              </section>
            )}

            {activeSnsPropertyPlatform === 'instagram' && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div><h2>Karilun｜Instagram 物件管理</h2></div>
                  <div className="sns-property-toolbar">
                    <input
                      className="sns-property-search-input"
                      value={snsPropertySearch.instagram}
                      onChange={(e) => updateSnsPropertySearch('instagram', e.target.value)}
                      placeholder="物件番号で検索"
                    />
                    {snsPropertySearch.instagram && (
                      <button type="button" className="secondary" onClick={() => updateSnsPropertySearch('instagram', '')}>×</button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void syncInstagramPropertiesToSheet()}
                      disabled={snsInstagramSheetSyncing}
                    >
                      {snsInstagramSheetSyncing ? '反映中...' : '今すぐ反映'}
                    </button>
                    <button type="button" className="primary" onClick={() => openSnsPropertyCreate('instagram')}>新規登録</button>
                  </div>
                </div>
                <div className="table-wrap sns-property-table-wrap">
                  <table className="compact-list-table sns-property-table">
                    <thead>
                      <tr>
                        <th className="sns-col-memo">メモ</th><th className="sns-col-check"><SnsPropertyHeader title="WP登録" /></th><th className="sns-col-plan">種別</th><th className="sns-col-date">投稿日</th>
                        <th className="sns-col-code">物件番号</th><th className="sns-col-plan">間取り</th><th className="sns-col-rent">家賃</th><th className="sns-col-area">エリア</th>
                        <th className="sns-col-station">最寄り駅</th><th className="sns-col-link">資料</th><th className="sns-col-property-name">物件名</th><th className="sns-col-room">号室</th>
                        <th className="sns-col-address">住所</th><th className="sns-col-source">資料取得先</th><th className="sns-col-company">管理会社</th><th className="sns-col-contact">連絡先</th><th className="sns-col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {instagramProperties.length === 0 && (
                        <tr><td colSpan={17} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                      )}
                      {instagramProperties.map((r) => {
                        return (
                          <tr key={r.id} className="row-hoverable">
                            <td className="sns-col-memo">{renderSnsMemoCell('sns_instagram_properties', r.id, r.memo)}</td>
                            <td className="sns-col-check">{renderSnsSelect(r.wp_registered, getSnsPropertySelectOptions('wp_registered'), (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'wp_registered', value, setInstagramProperties), () => openSnsPropertyOptionEditor('wp_registered', 'WP登録'))}</td>
                            <td className="sns-col-plan">{renderSnsSelect(r.category, [...SNS_PROPERTY_CATEGORY_OPTIONS], (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'category', value, setInstagramProperties))}</td>
                            <td className="sns-col-date">{renderSnsTextInput(`${r.id}:post_date`, normalizeSnsPropertyPostDate(r.post_date, r.property_number), (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'post_date', value, setInstagramProperties), { type: 'date' })}</td>
                            <td className="sns-col-code">{renderSnsTextInput(`${r.id}:property_number`, r.property_number, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'property_number', value, setInstagramProperties))}</td>
                            <td className="sns-col-plan">{renderSnsTextInput(`${r.id}:floor_plan`, r.floor_plan, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'floor_plan', value, setInstagramProperties))}</td>
                            <td className="sns-col-rent">{renderSnsTextInput(`${r.id}:rent`, r.rent, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'rent', value, setInstagramProperties))}</td>
                            <td className="sns-col-area">{renderSnsTextInput(`${r.id}:area`, r.area, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'area', value, setInstagramProperties))}</td>
                            <td className="sns-col-station">{renderSnsTextInput(`${r.id}:nearest_station`, r.nearest_station, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'nearest_station', value, setInstagramProperties))}</td>
                            <td className="sns-col-link" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="sns-link-button" title={r.document_url || '資料URLを入力'} onClick={() => editSnsPropertyUrl('sns_instagram_properties', r.id, r.document_url, setInstagramProperties)}>
                                🔗
                              </button>
                            </td>
                            <td className="sns-col-property-name">{renderSnsTextInput(`${r.id}:property_name`, r.property_name, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'property_name', value, setInstagramProperties))}</td>
                            <td className="sns-col-room">{renderSnsTextInput(`${r.id}:room_number`, r.room_number, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'room_number', value, setInstagramProperties))}</td>
                            <td className="sns-col-address">{renderSnsTextInput(`${r.id}:address`, r.address, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'address', value, setInstagramProperties))}</td>
                            <td className="sns-col-source">{renderSnsSelect(r.acquisition_source, getSnsPropertySelectOptions('acquisition_source'), (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'acquisition_source', value, setInstagramProperties), () => openSnsPropertyOptionEditor('acquisition_source', '資料取得先'))}</td>
                            <td className="sns-col-company">{renderSnsTextInput(`${r.id}:management_company`, r.management_company, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'management_company', value, setInstagramProperties))}</td>
                            <td className="sns-col-contact">{renderSnsTextInput(`${r.id}:contact`, r.contact, (value) => updateSnsPropertyRow('sns_instagram_properties', r.id, 'contact', value, setInstagramProperties))}</td>
                            <td className="sns-col-actions">
                              <div className="row-actions">
                                <button className="danger" onClick={() => confirmAndDeleteRecord('sns_instagram_properties', r.id, fetchInstagramProperties, 'このレコードを削除しますか？', () => scheduleSnsPropertySheetSync('instagram'))}>削除</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {renderSnsPropertyPagination()}
              </section>
            )}

            {activeSnsPropertyPlatform === 'youtube' && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div><h2>Karilun｜YouTube 物件管理</h2></div>
                  <div className="sns-property-toolbar">
                    <input
                      className="sns-property-search-input"
                      value={snsPropertySearch.youtube}
                      onChange={(e) => updateSnsPropertySearch('youtube', e.target.value)}
                      placeholder="物件番号で検索"
                    />
                    {snsPropertySearch.youtube && (
                      <button type="button" className="secondary" onClick={() => updateSnsPropertySearch('youtube', '')}>×</button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void syncYoutubePropertiesToSheet()}
                      disabled={snsYoutubeSheetSyncing}
                    >
                      {snsYoutubeSheetSyncing ? '反映中...' : '今すぐ反映'}
                    </button>
                    <button type="button" className="primary" onClick={() => openSnsPropertyCreate('youtube')}>新規登録</button>
                  </div>
                </div>
                <div className="table-wrap sns-property-table-wrap">
                  <table className="compact-list-table sns-property-table">
                    <thead>
                      <tr>
                        <th className="sns-col-memo">メモ</th><th className="sns-col-check"><SnsPropertyHeader title="WP登録" /></th><th className="sns-col-date">投稿日</th><th className="sns-col-code">物件番号</th>
                        <th className="sns-col-link">資料</th><th className="sns-col-property-name">物件名</th><th className="sns-col-room">号室</th>
                        <th className="sns-col-address">住所</th><th className="sns-col-source">資料取得先</th><th className="sns-col-company">管理会社</th><th className="sns-col-contact">連絡先</th><th className="sns-col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {youtubeProperties.length === 0 && (
                        <tr><td colSpan={12} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                      )}
                      {youtubeProperties.map((r) => {
                        return (
                          <tr key={r.id} className="row-hoverable">
                            <td className="sns-col-memo">{renderSnsMemoCell('sns_youtube_properties', r.id, r.memo)}</td>
                            <td className="sns-col-check">{renderSnsSelect(r.wp_registered, getSnsPropertySelectOptions('wp_registered'), (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'wp_registered', value, setYoutubeProperties), () => openSnsPropertyOptionEditor('wp_registered', 'WP登録'))}</td>
                            <td className="sns-col-date">{renderSnsTextInput(`${r.id}:post_date`, normalizeSnsPropertyPostDate(r.post_date, r.property_number), (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'post_date', value, setYoutubeProperties), { type: 'date' })}</td>
                            <td className="sns-col-code">{renderSnsTextInput(`${r.id}:property_number`, r.property_number, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'property_number', value, setYoutubeProperties))}</td>
                            <td className="sns-col-link" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="sns-link-button" title={r.document_url || '資料URLを入力'} onClick={() => editSnsPropertyUrl('sns_youtube_properties', r.id, r.document_url, setYoutubeProperties)}>
                                🔗
                              </button>
                            </td>
                            <td className="sns-col-property-name">{renderSnsTextInput(`${r.id}:property_name`, r.property_name, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'property_name', value, setYoutubeProperties))}</td>
                            <td className="sns-col-room">{renderSnsTextInput(`${r.id}:room_number`, r.room_number, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'room_number', value, setYoutubeProperties))}</td>
                            <td className="sns-col-address">{renderSnsTextInput(`${r.id}:address`, r.address, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'address', value, setYoutubeProperties))}</td>
                            <td className="sns-col-source">{renderSnsSelect(r.acquisition_source, getSnsPropertySelectOptions('acquisition_source'), (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'acquisition_source', value, setYoutubeProperties), () => openSnsPropertyOptionEditor('acquisition_source', '資料取得先'))}</td>
                            <td className="sns-col-company">{renderSnsTextInput(`${r.id}:management_company`, r.management_company, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'management_company', value, setYoutubeProperties))}</td>
                            <td className="sns-col-contact">{renderSnsTextInput(`${r.id}:contact`, r.contact, (value) => updateSnsPropertyRow('sns_youtube_properties', r.id, 'contact', value, setYoutubeProperties))}</td>
                            <td className="sns-col-actions">
                              <div className="row-actions">
                                <button className="danger" onClick={() => confirmAndDeleteRecord('sns_youtube_properties', r.id, fetchYoutubeProperties, 'このレコードを削除しますか？', () => scheduleSnsPropertySheetSync('youtube'))}>削除</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {renderSnsPropertyPagination()}
              </section>
            )}

            {isStoreSnsPropertyPlatform(activeSnsPropertyPlatform) && renderStoreSnsPropertySection(activeSnsPropertyPlatform)}

            {activeSnsPropertyPlatform === 'recruitment' && (
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <h2>採用 物件管理</h2>
                  </div>
                  <div className="sns-property-toolbar">
                    <input
                      className="sns-property-search-input"
                      value={snsPropertySearch.recruitment}
                      onChange={(e) => updateSnsPropertySearch('recruitment', e.target.value)}
                      placeholder="タイトル・番号で検索"
                    />
                    {snsPropertySearch.recruitment && (
                      <button type="button" className="secondary" onClick={() => updateSnsPropertySearch('recruitment', '')}>×</button>
                    )}
                    <button type="button" className="primary" onClick={() => openSnsPropertyCreate('recruitment')}>新規登録</button>
                  </div>
                </div>
                <div className="table-wrap sns-property-table-wrap">
                  <table className="compact-list-table sns-property-table sns-property-table-recruitment">
                    <thead>
                      <tr>
                        <th className="sns-col-memo">メモ</th>
                        <th className="sns-col-date">投稿予定日</th>
                        <th className="sns-col-weekday">曜日</th>
                        <th className="sns-col-plan">投稿種類</th>
                        <th className="sns-col-property-name">タイトル</th>
                        <th className="sns-col-code">番号</th>
                        <th className="sns-col-check">投稿予約</th>
                        <th className="sns-col-check">YouTube予約</th>
                        <th className="sns-col-actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recruitmentSnsProperties.length === 0 && (
                        <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                      )}
                      {recruitmentSnsProperties.map((r) => (
                        <tr key={r.id} className="row-hoverable">
                          <td className="sns-col-memo">{renderSnsMemoCell('sns_recruitment_properties', r.id, r.memo)}</td>
                          <td className="sns-col-date">{renderSnsTextInput(`${r.id}:post_date`, normalizeSnsPropertyPostDate(r.post_date, ''), (value) => updateRecruitmentSnsPropertyRow(r.id, 'post_date', value), { type: 'date' })}</td>
                          <td className="sns-col-weekday">{getWeekdayLabel(r.post_date)}</td>
                          <td className="sns-col-plan">{renderSnsSelect(r.category, ['リール', 'フィード'], (value) => updateRecruitmentSnsPropertyRow(r.id, 'category', value))}</td>
                          <td className="sns-col-property-name">{renderSnsTextInput(`${r.id}:title`, r.title, (value) => updateRecruitmentSnsPropertyRow(r.id, 'title', value))}</td>
                          <td className="sns-col-code">{renderSnsTextInput(`${r.id}:property_number`, r.property_number, (value) => updateRecruitmentSnsPropertyRow(r.id, 'property_number', value))}</td>
                          <td className="sns-col-check">{renderSnsSelect(r.post_reserved, getSnsPropertySelectOptions('post_reserved'), (value) => updateRecruitmentSnsPropertyRow(r.id, 'post_reserved', value), () => openSnsPropertyOptionEditor('post_reserved', '投稿予約'))}</td>
                          <td className="sns-col-check">{renderSnsSelect(r.youtube_reserved, getSnsPropertySelectOptions('youtube_reserved'), (value) => updateRecruitmentSnsPropertyRow(r.id, 'youtube_reserved', value), () => openSnsPropertyOptionEditor('youtube_reserved', 'YouTube予約'))}</td>
                          <td className="sns-col-actions">
                            <div className="row-actions">
                              <button className="danger" onClick={() => confirmAndDeleteRecord('sns_recruitment_properties', r.id, fetchRecruitmentSnsProperties, 'このレコードを削除しますか？')}>削除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {renderSnsPropertyPagination()}
              </section>
            )}
          </>
        )}

        {/* ===== 採用管理 ===== */}
        {activePage === 'recruitment' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>採用実績一覧</h2><p>行をクリックして直接編集</p></div></div>
              <div className="table-wrap">
                <table className="compact-list-table">
                  <thead>
                    <tr><th>応募日</th><th>媒体</th><th>部署</th><th>職種</th><th>削減額</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {recruitment.map((record) => {
                      const isEditing = recruitmentInlineId === record.id
                      const f = recruitmentInlineForm
                      return (
                        <tr
                          key={record.id}
                          className={isEditing ? 'row-editing' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startRecruitmentInline(record) }}
                        >
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.date} onChange={(e) => setRecruitmentInlineForm({ ...f, date: e.target.value })} /> : record.date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.platform} onChange={(e) => setRecruitmentInlineForm({ ...f, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p}>{p}</option>)}</select> : record.platform}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.department} onChange={(e) => setRecruitmentInlineForm({ ...f, department: e.target.value as RecruitDepartment })}>{recruitDepartments.map((d) => <option key={d}>{d}</option>)}</select> : record.department}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <select className="inline-select" value={f.jobType} onChange={(e) => setRecruitmentInlineForm({ ...f, jobType: e.target.value as JobType })}>{jobTypes.map((j) => <option key={j}>{j}</option>)}</select> : record.jobType}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.costReduction} onChange={(e) => setRecruitmentInlineForm({ ...f, costReduction: Number(e.target.value) })} /> : currency.format(record.costReduction)}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveRecruitmentInline}>保存</button>
                                  <button className="secondary" onClick={() => setRecruitmentInlineId(null)}>×</button>
                                </>
                              ) : (
                                <button className="danger" onClick={() => confirmAndDeleteRecord('recruitment', record.id, fetchRecruitment, 'この採用記録を本当に削除しますか？')}>削除</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {snsPropertyCreatePlatform && snsPropertyCreatePlatform !== 'recruitment' && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSnsPropertyCreate() }}>
            <div className="modal-content sns-property-create-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">
                  {snsPropertyTabs.find((tab) => tab.key === snsPropertyCreatePlatform)?.title || 'SNS物件管理'} 新規登録
                </h3>
                <button className="modal-close" onClick={closeSnsPropertyCreate}>×</button>
              </div>

              <form className="data-form sns-property-create-form" onSubmit={saveSnsPropertyCreate}>
                {renderSnsPropertyCreateFields()}
                <div className="form-actions sns-property-create-actions">
                  <button type="submit" className="primary" disabled={snsPropertyCreateSaving}>
                    {snsPropertyCreateSaving ? '登録中...' : '登録する'}
                  </button>
                  <button type="button" className="secondary" onClick={closeSnsPropertyCreate} disabled={snsPropertyCreateSaving}>
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SNS物件管理メモポップアップ */}
        {snsMemoEditor !== null && (
          <div className="memo-popup-overlay" onClick={() => setSnsMemoEditor(null)}>
            <div className="memo-popup-content" onClick={e => e.stopPropagation()}>
              <div className="memo-popup-header">
                <h3>メモ編集</h3>
                <button onClick={() => setSnsMemoEditor(null)}>✕</button>
              </div>
              <div className="memo-popup-body memo-popup-body-edit">
                <textarea
                  className="memo-popup-textarea"
                  value={snsMemoDraft}
                  onChange={(e) => setSnsMemoDraft(e.target.value)}
                  placeholder="ここにメモを書いてください"
                />
                <div className="memo-popup-actions">
                  <button className="secondary" onClick={() => setSnsMemoEditor(null)}>閉じる</button>
                  <button className="primary" onClick={() => void saveSnsMemo()}>保存</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* メモ表示ポップアップ */}
        {memoToView !== null && (
          <div className="memo-popup-overlay" onClick={() => setMemoToView(null)}>
            <div className="memo-popup-content" onClick={e => e.stopPropagation()}>
              <div className="memo-popup-header">
                <h3>メモ詳細</h3>
                <button onClick={() => setMemoToView(null)}>✕</button>
              </div>
              <div className="memo-popup-body">
                {memoToView}
              </div>
            </div>
          </div>
        )}

        {/* ===== 反響管理 ===== */}
        {activePage === 'hankyo' && (
          <>
            {/* 一覧テーブル */}
            <section className="panel hankyo-table-panel">
              <div className="panel-heading">
                <div><h2>反響一覧</h2><p>全{filteredHankyo.length}件 / {hankyoRecords.length}件中</p></div>
              </div>

              {/* 検索・フィルター */}
              <div className="hankyo-toolbar" onClick={() => setHankyoOpenFilter(null)}>
                <input
                  className="hankyo-search"
                  placeholder="顧客名で検索..."
                  value={hankyoSearch}
                  onChange={(e) => { setHankyoSearch(e.target.value) }}
                  onClick={(e) => e.stopPropagation()}
                />
                {([
                  { key: 'month', label: '月', selected: hankyoMonthFilters, setSelected: setHankyoMonthFilters, options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })) },
                  { key: 'account', label: 'アカウント', selected: hankyoAccountFilters, setSelected: setHankyoAccountFilters, options: hankyoAccounts.map(v => ({ value: v, label: v })) },
                  { key: 'trigger', label: 'きっかけ', selected: hankyoTriggerFilters, setSelected: setHankyoTriggerFilters, options: hankyoTriggers.map(v => ({ value: v, label: v })) },
                  { key: 'media', label: '媒体', selected: hankyoMediaFilters, setSelected: setHankyoMediaFilters, options: hankyoMedias.map(v => ({ value: v, label: v })) },
                  { key: 'inquiryType', label: '問合内容', selected: hankyoInquiryTypeFilters, setSelected: setHankyoInquiryTypeFilters, options: hankyoInquiryTypes.map(v => ({ value: v, label: v })) },
                  { key: 'contactMethod', label: '問合手段', selected: hankyoContactMethodFilters, setSelected: setHankyoContactMethodFilters, options: hankyoContactMethods.map(v => ({ value: v, label: v })) },
                  { key: 'moveIn', label: '入居時期', selected: hankyoMoveInFilters, setSelected: setHankyoMoveInFilters, options: hankyoMoveInTimings.map(v => ({ value: v, label: v })) },
                  { key: 'store', label: '店舗', selected: hankyoStoreFilters, setSelected: setHankyoStoreFilters, options: hankyoStores.map(v => ({ value: v, label: v })) },
                ] as { key: string; label: string; selected: string[]; setSelected: React.Dispatch<React.SetStateAction<string[]>>; options: { value: string; label: string }[] }[]).map(({ key, label, selected, setSelected, options }) => (
                  <div key={key} className="hankyo-multiselect" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`hankyo-multiselect-btn${selected.length > 0 ? ' active' : ''}`}
                      onClick={() => setHankyoOpenFilter(hankyoOpenFilter === key ? null : key)}
                    >
                      {selected.length === 0 ? `全${label}` : `${label}(${selected.length})`}
                      <span className="hankyo-multiselect-arrow">▾</span>
                    </button>
                    {hankyoOpenFilter === key && (
                      <div className="hankyo-multiselect-dropdown">
                        <label className="hankyo-multiselect-item hankyo-multiselect-all">
                          <input
                            type="checkbox"
                            checked={selected.length === 0}
                            onChange={() => setSelected([])}
                          />
                          すべて
                        </label>
                        {options.map(opt => (
                          <label key={opt.value} className="hankyo-multiselect-item">
                            <input
                              type="checkbox"
                              checked={selected.includes(opt.value)}
                              onChange={(e) => {
                                setSelected(prev =>
                                  e.target.checked
                                    ? [...prev, opt.value]
                                    : prev.filter(v => v !== opt.value)
                                )
                              }}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="table-wrap">
                <table className="compact-list-table">
                  <thead>
                    <tr>
                      <th>操作</th>
                      <th>確認</th>
                      <th>反響日</th>
                      <th>顧客名</th>
                      <th>アカウント</th>
                      <th>きっかけ</th>
                      <th>媒体</th>
                      <th>問合内容</th>
                      <th>問合手段</th>
                      <th>入居時期</th>
                      <th>送客先店舗</th>
                      <th>希望エリア</th>
                      <th>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHankyo.length === 0 && (
                      <tr><td colSpan={13} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                    )}
                    {filteredHankyo.map((r) => {
                      const isEditing = hankyoInlineId === r.id
                      const f = hankyoInlineForm
                      return (
                        <tr
                          key={r.id}
                          className={isEditing ? 'row-editing' : (r.store === '対象外' || r.store === '重複') ? 'row-gray' : checkedHankyoIds.has(r.id) ? 'row-yellow' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startHankyoInline(r) }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveHankyoInline}>保存</button>
                                  <button className="secondary" onClick={() => setHankyoInlineId(null)}>×</button>
                                </>
                              ) : (
                                <>
                                  <button className="hankyo-dup-btn" onClick={() => duplicateHankyo(r)} title="このデータを複製">複製</button>
                                  <button className="danger" onClick={() => confirmAndDeleteRecord('hankyo', r.id, fetchHankyo, 'この反響記録を本当に削除しますか？')}>削除</button>
                                </>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checkedHankyoIds.has(r.id)}
                              onChange={async (e) => {
                                const next = new Set(checkedHankyoIds)
                                if (e.target.checked) next.add(r.id)
                                else next.delete(r.id)
                                setCheckedHankyoIds(next)
                                await supabase.from('hankyo').update({ confirmed: e.target.checked }).eq('id', r.id)
                              }}
                            />
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" type="date" value={f.inquiry_date} onChange={(e) => setHankyoInlineForm({ ...f, inquiry_date: e.target.value })} />
                              : r.inquiry_date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.customer_name} onChange={(e) => setHankyoInlineForm({ ...f, customer_name: e.target.value })} />
                              : r.customer_name}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.account} onChange={(e) => setHankyoInlineForm({ ...f, account: e.target.value })}>{hankyoAccounts.map((a) => <option key={a}>{a}</option>)}</select>
                              : r.account}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.trigger} onChange={(e) => setHankyoInlineForm({ ...f, trigger: e.target.value })}>{hankyoTriggers.map((t) => <option key={t}>{t}</option>)}</select>
                              : r.trigger}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.media} onChange={(e) => setHankyoInlineForm({ ...f, media: e.target.value })}>{hankyoMedias.map((m) => <option key={m}>{m}</option>)}</select>
                              : r.media}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.inquiry_type} onChange={(e) => setHankyoInlineForm({ ...f, inquiry_type: e.target.value })}>{hankyoInquiryTypes.map((t) => <option key={t}>{t}</option>)}</select>
                              : r.inquiry_type}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.contact_method} onChange={(e) => setHankyoInlineForm({ ...f, contact_method: e.target.value })}>{hankyoContactMethods.map((c) => <option key={c}>{c}</option>)}</select>
                              : r.contact_method}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.move_in_timing} onChange={(e) => setHankyoInlineForm({ ...f, move_in_timing: e.target.value })}>{hankyoMoveInTimings.map((t) => <option key={t}>{t}</option>)}</select>
                              : r.move_in_timing}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.store} onChange={(e) => setHankyoInlineForm({ ...f, store: e.target.value })}>{hankyoStores.map((s) => <option key={s}>{s}</option>)}</select>
                              : r.store}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.area} onChange={(e) => setHankyoInlineForm({ ...f, area: e.target.value })} />
                              : <span className="cell-truncate" title={r.area}>{r.area}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.note} onChange={(e) => setHankyoInlineForm({ ...f, note: e.target.value })} />
                              : <span className="cell-truncate" title={r.note}>{r.note}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ページネーション */}

            </section>
          </>
        )}

        {/* ===== DM管理 ===== */}
        {activePage === 'dm' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading">
                <div><h2>DM一覧</h2><p>全{filteredDm.length}件 / {dmRecords.length}件中</p></div>
              </div>

              {/* フィルター */}
              <div className="hankyo-toolbar">
                <select value={dmMonthFilter} onChange={(e) => { setDmMonthFilter(e.target.value); setDmPage(1) }}>
                  <option value="all">全月</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>{m}月</option>
                  ))}
                </select>
                <select value={dmAccountFilter} onChange={(e) => { setDmAccountFilter(e.target.value); setDmPage(1) }}>
                  <option value="all">全アカウント</option>
                  {dmAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div className="table-wrap">
                <table className="compact-list-table">
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>アカウント名</th>
                      <th>SNS</th>
                      <th>エリア</th>
                      <th>反響物件番号</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDm.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                    )}
                    {paginatedDm.map((r) => {
                      const isEditing = dmInlineId === r.id
                      const f = dmInlineForm
                      return (
                        <tr
                          key={r.id}
                          className={isEditing ? 'row-editing' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startDmInline(r) }}
                        >
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" type="date" value={f.date} onChange={(e) => setDmInlineForm({ ...f, date: e.target.value })} />
                              : r.date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.account} onChange={(e) => setDmInlineForm({ ...f, account: e.target.value })}>{dmAccounts.map((a) => <option key={a}>{a}</option>)}</select>
                              : r.account}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.sns} onChange={(e) => setDmInlineForm({ ...f, sns: e.target.value })}>{dmSnsList.map((s) => <option key={s}>{s}</option>)}</select>
                              : r.sns}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.area} onChange={(e) => setDmInlineForm({ ...f, area: e.target.value })} />
                              : <span className="cell-truncate" title={r.area}>{r.area}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.property_number} onChange={(e) => setDmInlineForm({ ...f, property_number: e.target.value })} />
                              : r.property_number}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  <button className="primary" onClick={saveDmInline}>保存</button>
                                  <button className="secondary" onClick={() => setDmInlineId(null)}>×</button>
                                </>
                              ) : (
                                <button className="danger" onClick={() => confirmAndDeleteRecord('dm', r.id, fetchDm, 'このDM記録を本当に削除しますか？')}>削除</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ページネーション */}
              {dmTotalPages > 1 && (
                <div className="hankyo-pagination">
                  <button onClick={() => setDmPage(1)} disabled={dmPage === 1}>«</button>
                  <button onClick={() => setDmPage(p => Math.max(1, p - 1))} disabled={dmPage === 1}>‹</button>
                  {Array.from({ length: dmTotalPages }, (_, i) => i + 1)
                    .filter((p) => Math.abs(p - dmPage) <= 2)
                    .map((p) => (
                      <button key={p} className={p === dmPage ? 'active' : ''} onClick={() => setDmPage(p)}>{p}</button>
                    ))}
                  <button onClick={() => setDmPage(p => Math.min(dmTotalPages, p + 1))} disabled={dmPage === dmTotalPages}>›</button>
                  <button onClick={() => setDmPage(dmTotalPages)} disabled={dmPage === dmTotalPages}>»</button>
                  <span className="hankyo-page-info">{dmPage} / {dmTotalPages}ページ</span>
                </div>
              )}
            </section>
          </>
        )}

        {/* ===== メンバー ===== */}
        {activePage === 'members' && (
          <section className="members-page">
            {false ? (
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>閲覧できるGoogleアカウント</h2>
                  <p>ここに入っているGoogleアカウントだけ、この管理ツールを開けます。</p>
                </div>
              </div>

              {isMasterUser ? (
                <>
                  <div className="access-manager-form">
                    <input
                      type="email"
                      placeholder="追加したいGoogleアカウント"
                      value={allowedAccountForm}
                      onChange={(e) => setAllowedAccountForm(e.target.value)}
                    />
                    <button className="primary" onClick={addAllowedAccount} disabled={allowedAccountSaving}>
                      {allowedAccountSaving ? '保存中...' : '追加'}
                    </button>
                  </div>
                  <p className="access-manager-note">`trg.yshini@gmail.com` がマスターです。このアカウントだけが追加と削除をできます。</p>
                </>
              ) : (
                <p className="access-manager-note">追加や削除はマスターアカウントだけができます。</p>
              )}

              {allowedAccountMessage && <p className="access-manager-message">{allowedAccountMessage}</p>}

              <div className="access-account-list">
                {allowedAccounts.map((account) => (
                  <div key={account.id} className="access-account-card">
                    <div className="access-account-main">
                      <strong>{account.email}</strong>
                      {account.is_master && <span className="auth-master-badge access-master-badge">マスター</span>}
                      {account.allow_outside_office && <span className="outside-office-badge">社外OK</span>}
                    </div>
                    <div className="access-account-actions">
                      {isMasterUser && (
                        <>
                          <label className="outside-office-toggle">
                            <input
                              type="checkbox"
                              checked={account.allow_outside_office}
                              onChange={() => toggleOutsideOfficeAccess(account)}
                              disabled={allowedAccountSaving}
                            />
                            社外からも開ける
                          </label>
                          {!account.is_master && (
                            <button className="danger" onClick={() => removeAllowedAccount(account.email)} disabled={allowedAccountSaving}>
                              削除
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : null}

            {/* 今日の業務一覧 */}
            {import.meta.env.VITE_GOOGLE_CLIENT_ID
              ? <TodayTasksPanel />
              : (
                <div className="panel">
                  <div className="panel-heading"><div><h2>今日の業務一覧</h2></div></div>
                  <div className="calendar-login-prompt"><p>Google Calendar連携を有効にするにはVercelに環境変数を設定してください。</p></div>
                </div>
              )
            }
          </section>
        )}

        {activePage === 'manuals' && (
          <ManualsPage
            currentUserEmail={currentUserEmail}
            allowedAccounts={allowedAccounts}
          />
        )}

        {/* ===== ストック管理 ===== */}
        {activePage === 'stock' && (() => {
          const [calYear, calMonth] = stockCalendarMonth.split('-').map(Number)
          const firstDay = new Date(calYear, calMonth - 1, 1)
          const lastDay = new Date(calYear, calMonth, 0)
          const today2 = new Date().toISOString().split('T')[0]
          type CalCell = { day: number; date: string; isOtherMonth: boolean; isToday: boolean; stocks: StockRecord[] }
          const cells: CalCell[] = []
          for (let i = 0; i < firstDay.getDay(); i++) {
            const d = new Date(calYear, calMonth - 2, new Date(calYear, calMonth - 1, 0).getDate() - firstDay.getDay() + i + 1)
            cells.push({ day: d.getDate(), date: '', isOtherMonth: true, isToday: false, stocks: [] })
          }
          for (let d = 1; d <= lastDay.getDate(); d++) {
            const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            cells.push({ day: d, date: dateStr, isOtherMonth: false, isToday: dateStr === today2, stocks: stockRecords.filter(r => r.deadline === dateStr) })
          }
          const remaining = (7 - (cells.length % 7)) % 7
          for (let i = 1; i <= remaining; i++) cells.push({ day: i, date: '', isOtherMonth: true, isToday: false, stocks: [] })

          return (
            <>
              {/* カレンダー */}
              <section className="panel" style={{ gridColumn: 'span 12' }}>
                <div className="panel-heading">
                  <div><h2>ストックカレンダー</h2><p>締切日ごとの必要件数を管理</p></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="secondary" onClick={() => moveStockMonth(-1)}>◀</button>
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{calYear}年{calMonth}月</span>
                    <button className="secondary" onClick={() => moveStockMonth(1)}>▶</button>
                  </div>
                </div>
                <div className="stock-calendar-scroll">
                  <div className="stock-calendar-grid">
                    {['日','月','火','水','木','金','土'].map(w => (
                      <div key={w} className="cal-weekday" style={{ color: w === '日' ? '#ef4444' : w === '土' ? '#3b82f6' : undefined }}>{w}</div>
                    ))}
                    {cells.map((cell, i) => {
                      const attendanceBadges = cell.date
                        ? (stockAttendanceMap[cell.date] || []).filter((badge) => badge !== '新' || stockHonmachiDateMap[cell.date])
                        : []
                      return (
                        <div key={i} className={`cal-cell${cell.isOtherMonth ? ' other-month' : ''}${cell.isToday ? ' today' : ''}`}>
                          <div className="cal-cell-top">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <span className="cal-day-num" style={{ color: (i % 7 === 0) ? '#ef4444' : (i % 7 === 6) ? '#3b82f6' : undefined }}>{cell.day}</span>
                              {!cell.isOtherMonth && cell.date && weatherMap[cell.date] !== undefined && (
                                <span style={{ fontSize: '0.85rem', lineHeight: 1, userSelect: 'none' }} title={`天気: ${getWeatherEmoji(weatherMap[cell.date])}`}>
                                  {getWeatherEmoji(weatherMap[cell.date])}
                                </span>
                              )}
                            </div>
                            {!cell.isOtherMonth && attendanceBadges.length > 0 && (
                              <div className="stock-attendance-badges" title={`出勤: ${attendanceBadges.join('、')}`}>
                                {attendanceBadges.map((badge) => (
                                  <span key={badge} className={`stock-attendance-badge stock-attendance-badge-${badge}`}>{badge}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          {cell.stocks.map(s => {
                            const done = s.achieved_count >= s.required_count
                            return (
                              <div key={s.id} className={`stock-badge${done ? ' done' : ''}`} title={s.note}>
                                <span className="stock-badge-label">{s.label}</span>
                                <span className="stock-badge-count">{s.achieved_count}/{s.required_count}件</span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              {/* 一覧 */}
              <section className="panel table-panel" style={{ gridColumn: 'span 12' }}>
                <div className="panel-heading"><div><h2>ストック一覧</h2><p>行をクリックして直接編集</p></div></div>
                <div className="table-wrap">
                  <table className="compact-list-table">
                    <thead>
                      <tr>
                        <th>締切日</th><th>ラベル</th><th>必要件数</th><th>達成件数</th><th>状態</th><th>メモ</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockRecords.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>データがありません</td></tr>}
                      {stockRecords.map(r => {
                        const isEditing = stockInlineId === r.id
                        const f = stockInlineForm
                        const done = r.achieved_count >= r.required_count
                        return (
                          <tr key={r.id} className={isEditing ? 'row-editing' : 'row-hoverable'} onClick={() => { if (!isEditing) startStockInline(r) }}>
                            <td onClick={e => isEditing && e.stopPropagation()}>
                              {isEditing ? <input className="inline-input" type="date" value={f.deadline} onChange={e => setStockInlineForm({ ...f, deadline: e.target.value })} /> : r.deadline}
                            </td>
                            <td onClick={e => isEditing && e.stopPropagation()}>
                              {isEditing ? <input className="inline-input" value={f.label} onChange={e => setStockInlineForm({ ...f, label: e.target.value })} /> : r.label}
                            </td>
                            <td onClick={e => isEditing && e.stopPropagation()}>
                              {isEditing ? <input className="inline-input" type="number" min="1" value={f.required_count} onChange={e => setStockInlineForm({ ...f, required_count: Number(e.target.value) })} /> : `${r.required_count}件`}
                            </td>
                            <td onClick={e => isEditing && e.stopPropagation()}>
                              {isEditing ? <input className="inline-input" type="number" min="0" value={f.achieved_count} onChange={e => setStockInlineForm({ ...f, achieved_count: Number(e.target.value) })} /> : `${r.achieved_count}件`}
                            </td>
                            <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.78rem', background: done ? '#dcfce7' : '#fef9c3', color: done ? '#166534' : '#713f12' }}>{done ? '達成' : '未達'}</span></td>
                            <td onClick={e => isEditing && e.stopPropagation()}>
                              {isEditing ? <input className="inline-input" value={f.note} onChange={e => setStockInlineForm({ ...f, note: e.target.value })} /> : r.note}
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              <div className="row-actions">
                                {isEditing ? (
                                  <><button className="primary" onClick={saveStockInline}>保存</button><button className="secondary" onClick={() => setStockInlineId(null)}>×</button></>
                                ) : (
                                  <button className="danger" onClick={() => confirmAndDeleteRecord('stock', r.id, fetchStock, 'この在庫記録を本当に削除しますか？')}>削除</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )
        })()}

        {/* ===== 部署予定 ===== */}
        {activePage === 'busho' && (() => {
          const [calYear, calMonth] = bushoCalendarMonth.split('-').map(Number)
          const firstDay = new Date(calYear, calMonth - 1, 1).getDay()
          const daysInMonth = new Date(calYear, calMonth, 0).getDate()
          const todayStr = new Date().toISOString().slice(0, 10)
          const selectedBushoDate = bushoSelectedDate || todayStr
          const selectedBushoSchedules = bushoFilterDept === '全て'
            ? bushoSchedules.filter((r) => r.date === selectedBushoDate)
            : bushoSchedules.filter((r) => r.date === selectedBushoDate && r.department === bushoFilterDept)
          const selectBushoDate = (date: string) => {
            setBushoSelectedDate(date)
            setEditingBushoId(null)
            setBushoForm({ ...defaultBushoForm, date })
          }
          type BushoCalCell = { day: number; date: string; isOtherMonth: boolean; isToday: boolean; dayOfWeek: number; isHoliday: boolean; schedules: BushoSchedule[] }
          const cells: BushoCalCell[] = []
          const JP_HOLIDAYS = new Set([
            // 2025年
            '2025-01-01', '2025-01-13', '2025-02-11', '2025-02-23', '2025-02-24',
            '2025-03-20', '2025-04-29', '2025-05-03', '2025-05-04', '2025-05-05', '2025-05-06',
            '2025-07-21', '2025-08-11', '2025-09-15', '2025-09-22', '2025-09-23',
            '2025-10-13', '2025-11-03', '2025-11-23', '2025-11-24',
            // 2026年
            '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23',
            '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
            '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
            '2026-10-12', '2026-11-03', '2026-11-23',
          ])
          for (let i = 0; i < firstDay; i++) {
            cells.push({ day: 0, date: '', isOtherMonth: true, isToday: false, dayOfWeek: 0, isHoliday: false, schedules: [] })
          }
          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const filtered = bushoFilterDept === '全て'
              ? bushoSchedules.filter((r) => r.date === dateStr)
              : bushoSchedules.filter((r) => r.date === dateStr && r.department === bushoFilterDept)
            const dow = new Date(calYear, calMonth - 1, d).getDay()
            cells.push({ day: d, date: dateStr, isOtherMonth: false, isToday: dateStr === todayStr, dayOfWeek: dow, isHoliday: JP_HOLIDAYS.has(dateStr), schedules: filtered })
          }
          const remaining = (7 - (cells.length % 7)) % 7
          for (let i = 1; i <= remaining; i++) {
            cells.push({ day: i, date: '', isOtherMonth: true, isToday: false, dayOfWeek: 0, isHoliday: false, schedules: [] })
          }
          return (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div><h2>部署予定カレンダー</h2><p>部署ごとの予定を管理</p></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      value={bushoFilterDept}
                      onChange={(e) => setBushoFilterDept(e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc' }}
                    >
                      <option value="全て">全て</option>
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button onClick={() => {
                      const [y, m] = bushoCalendarMonth.split('-').map(Number)
                      const pm = m === 1 ? 12 : m - 1
                      const py = m === 1 ? y - 1 : y
                      setBushoCalendarMonth(`${py}-${String(pm).padStart(2, '0')}`)
                    }}>◀</button>
                    <span style={{ fontWeight: 600, minWidth: 80, textAlign: 'center' }}>{calYear}年{calMonth}月</span>
                    <button onClick={() => {
                      const [y, m] = bushoCalendarMonth.split('-').map(Number)
                      const nm = m === 12 ? 1 : m + 1
                      const ny = m === 12 ? y + 1 : y
                      setBushoCalendarMonth(`${ny}-${String(nm).padStart(2, '0')}`)
                    }}>▶</button>
                  </div>
                </div>
                <div className="stock-calendar-scroll">
                  <div className="stock-calendar-grid">
                    {['日', '月', '火', '水', '木', '金', '土'].map((d, idx) => (
                      <div key={d} className={`cal-header-cell${idx === 0 ? ' cal-header-sunday' : ''}${idx === 6 ? ' cal-header-saturday' : ''}`}>{d}</div>
                    ))}
                    {cells.map((cell, i) => (
                      <div
                        key={i}
                        className={`cal-cell${cell.isOtherMonth ? ' other-month' : ''}${cell.isToday ? ' today' : ''}${cell.date === selectedBushoDate ? ' busho-selected-day' : ''}${!cell.isOtherMonth && (cell.dayOfWeek === 0 || cell.isHoliday) ? ' holiday-cell' : ''}${!cell.isOtherMonth && cell.dayOfWeek === 6 && !cell.isHoliday ? ' saturday-cell' : ''}`}
                        onClick={() => {
                          if (!cell.isOtherMonth && cell.date) {
                            selectBushoDate(cell.date)
                          }
                        }}
                      >
                        <span className="cal-day-num">{cell.isOtherMonth ? '' : cell.day}</span>
                        {cell.schedules.map((s) => (
                          <div
                            key={s.id}
                            className="busho-badge"
                            style={{ backgroundColor: DEPT_COLORS[s.department] || '#95a5a6' }}
                            title={s.note}
                            onClick={(e) => {
                              e.stopPropagation()
                              selectBushoDate(s.date)
                            }}
                          >
                            <span className="busho-badge-dept">{s.department}</span>
                            <span className="busho-badge-title">
                              {s.start_time ? `${s.start_time.slice(0, 5)} ${s.title}` : s.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>予定一覧</h2>
                    <p>{selectedBushoDate === todayStr ? `今日の予定 (${selectedBushoDate})` : `${selectedBushoDate} の予定`}</p>
                  </div>
                  <button className="secondary" onClick={() => setBushoSelectedDate(todayStr)}>今日に戻す</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th>部署</th>
                        <th>タイトル</th>
                        <th>メモ</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBushoSchedules.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>データがありません</td></tr>
                      )}
                      {selectedBushoSchedules.map((r) => (
                        <tr key={r.id}>
                          <td>{r.date}</td>
                          <td>
                            <span className="dept-badge" style={{ backgroundColor: DEPT_COLORS[r.department] || '#95a5a6' }}>
                              {r.department}
                            </span>
                          </td>
                          <td>{r.title}</td>
                          <td>{r.note}</td>
                          <td>
                            <button className="secondary" onClick={() => startBushoEdit(r)}>編集</button>
                            {' '}
                            <button className="danger" onClick={() => confirmAndDeleteRecord('busho_schedules', r.id, fetchBusho, 'この部署予定を本当に削除しますか？')}>削除</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )
        })()}
        {/* ===== 自社集客売上 ===== */}
        {activePage === 'jishashukyaku' && (() => {
          const JISHA_MEDIAS: JishaShukyakuMedia[] = ['Karilun', '学生サイト', 'SNS', '地域サイト', '口コミ']
          const JISHA_ROW_TYPES: JishaShukyakuRowType[] = ['予算', '実績', '前年']

          function getJishaData(media: JishaShukyakuMedia, rowType: JishaShukyakuRowType): { hankyo_count: number; hankyo_raikyo: number; shinki_count: number; keiyaku_count: number; koken_uriaage: number } {
            let records: JishaShukyakuRecord[]
            if (jishaViewMode === '単月') {
              records = jishaShukyakuRecords.filter(r => r.year === jishaYear && r.month === jishaMonth && r.media === media && r.row_type === rowType)
            } else {
              records = jishaShukyakuRecords.filter(r =>
                r.year === jishaYear &&
                r.month >= jishaStartMonth &&
                r.month <= jishaMonth &&
                r.media === media &&
                r.row_type === rowType,
              )
            }
            return {
              hankyo_count: records.reduce((s, r) => s + r.hankyo_count, 0),
              hankyo_raikyo: records.reduce((s, r) => s + r.hankyo_raikyo, 0),
              shinki_count: records.reduce((s, r) => s + r.shinki_count, 0),
              keiyaku_count: records.reduce((s, r) => s + r.keiyaku_count, 0),
              koken_uriaage: records.reduce((s, r) => s + r.koken_uriaage, 0),
            }
          }

          function calcRates(d: { hankyo_count: number; hankyo_raikyo: number; shinki_count: number; keiyaku_count: number; koken_uriaage: number }) {
            return {
              raikyo_rate: d.hankyo_count > 0 ? (d.hankyo_raikyo / d.hankyo_count * 100) : 0,
              keiyaku_rate: d.shinki_count > 0 ? (d.keiyaku_count / d.shinki_count * 100) : 0,
              seiyaku_rate: d.hankyo_count > 0 ? (d.keiyaku_count / d.hankyo_count * 100) : 0,
              keiyaku_tanka: d.keiyaku_count > 0 ? Math.round(d.koken_uriaage / d.keiyaku_count) : 0,
            }
          }

          function pct(v: number) { return v === 0 ? '0.0%' : `${v.toFixed(1)}%` }

          function formatJishaRatio(num: number, den: number) {
            if (den === 0) return '-'
            return `${(num / den * 100).toFixed(1)}%`
          }

          function buildJishaExportRows() {
            const rows: (string | number)[][] = [
              [jishaTableTitle],
              ['表示', viewLabel],
              [],
              ['媒体', '区分', '反響数', '反響来店', '反来率', '新規数', '契約数', '契約率', '反響成約率', '貢献売上', '契約単価'],
            ]

            function pushMetricRow(mediaLabel: string, rowLabel: string, data: { hankyo_count: number; hankyo_raikyo: number; shinki_count: number; keiyaku_count: number; koken_uriaage: number }) {
              const rates = calcRates(data)
              rows.push([
                mediaLabel,
                rowLabel,
                data.hankyo_count,
                data.hankyo_raikyo,
                pct(rates.raikyo_rate),
                data.shinki_count,
                data.keiyaku_count,
                pct(rates.keiyaku_rate),
                pct(rates.seiyaku_rate),
                data.koken_uriaage,
                rates.keiyaku_tanka,
              ])
            }

            function pushRatioRow(
              mediaLabel: string,
              rowLabel: string,
              numeratorData: { hankyo_count: number; hankyo_raikyo: number; shinki_count: number; keiyaku_count: number; koken_uriaage: number },
              denominatorData: { hankyo_count: number; hankyo_raikyo: number; shinki_count: number; keiyaku_count: number; koken_uriaage: number },
            ) {
              const numeratorRates = calcRates(numeratorData)
              const denominatorRates = calcRates(denominatorData)

              rows.push([
                mediaLabel,
                rowLabel,
                formatJishaRatio(numeratorData.hankyo_count, denominatorData.hankyo_count),
                formatJishaRatio(numeratorData.hankyo_raikyo, denominatorData.hankyo_raikyo),
                formatJishaRatio(numeratorRates.raikyo_rate, denominatorRates.raikyo_rate),
                formatJishaRatio(numeratorData.shinki_count, denominatorData.shinki_count),
                formatJishaRatio(numeratorData.keiyaku_count, denominatorData.keiyaku_count),
                formatJishaRatio(numeratorRates.keiyaku_rate, denominatorRates.keiyaku_rate),
                formatJishaRatio(numeratorRates.seiyaku_rate, denominatorRates.seiyaku_rate),
                formatJishaRatio(numeratorData.koken_uriaage, denominatorData.koken_uriaage),
                formatJishaRatio(numeratorRates.keiyaku_tanka, denominatorRates.keiyaku_tanka),
              ])
            }

            JISHA_MEDIAS.forEach((media) => {
              pushMetricRow(media, '予算', getJishaData(media, '予算'))
              pushMetricRow(media, '実績', getJishaData(media, '実績'))
              pushMetricRow(media, '前年', getJishaData(media, '前年'))
              pushRatioRow(media, '予算比', getJishaData(media, '実績'), getJishaData(media, '予算'))
              pushRatioRow(media, '前年比', getJishaData(media, '実績'), getJishaData(media, '前年'))
            })

            pushMetricRow('自社集客合計', '予算', getTotalData('予算'))
            pushMetricRow('自社集客合計', '実績', getTotalData('実績'))
            pushMetricRow('自社集客合計', '前年', getTotalData('前年'))
            pushRatioRow('自社集客合計', '予算比', getTotalData('実績'), getTotalData('予算'))
            pushRatioRow('自社集客合計', '前年比', getTotalData('実績'), getTotalData('前年'))
            rows.push([])
            rows.push(['メモ', 'このファイルは画面の表示内容を書き出したものです。'])

            return rows
          }

          async function exportJishaExcel() {
            const ExcelJS = await import('exceljs')
            const workbook = new ExcelJS.Workbook()
            const worksheet = workbook.addWorksheet('自社集客実績', {
              views: [{ state: 'frozen', ySplit: 4 }],
            })
            const sheetRows = buildJishaExportRows()

            sheetRows.forEach((row) => {
              worksheet.addRow(row)
            })

            worksheet.columns = [
              { width: 11 },
              { width: 10 },
              { width: 11 },
              { width: 11 },
              { width: 11 },
              { width: 11 },
              { width: 11 },
              { width: 11 },
              { width: 13 },
              { width: 14 },
              { width: 11 },
            ]

            worksheet.mergeCells('A1:K1')
            worksheet.mergeCells('B2:K2')

            const thinBorder = {
              top: { style: 'thin' as const, color: { argb: 'FFD7E1F0' } },
              left: { style: 'thin' as const, color: { argb: 'FFD7E1F0' } },
              bottom: { style: 'thin' as const, color: { argb: 'FFD7E1F0' } },
              right: { style: 'thin' as const, color: { argb: 'FFD7E1F0' } },
            }

            const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E8C' } }
            const budgetRatioFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEAF2FF' } }
            const yearRatioFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8F6EC' } }
            const totalFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF9F1E6' } }

            const mediaColors: Record<string, string> = {
              Karilun: 'FF235AA6',
              学生サイト: 'FF2A61D8',
              SNS: 'FF7B35D9',
              地域サイト: 'FF15A4C7',
              口コミ: 'FF0F9D69',
              自社集客合計: 'FFE53935',
            }

            worksheet.getRow(1).height = 28
            worksheet.getRow(2).height = 24
            worksheet.getRow(4).height = 24

            worksheet.getCell('A1').font = { size: 15, bold: true }
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' }
            worksheet.getCell('A2').font = { bold: true }
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' }
            worksheet.getCell('B2').alignment = { vertical: 'middle', horizontal: 'left' }

            for (let col = 1; col <= 11; col += 1) {
              const cell = worksheet.getRow(4).getCell(col)
              cell.fill = headerFill
              cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
              cell.alignment = { vertical: 'middle', horizontal: 'center' }
              cell.border = thinBorder
            }

            const mediaOrder: Array<{ label: string; key: JishaShukyakuMedia | 'total' }> = [
              { label: 'Karilun', key: 'Karilun' },
              { label: '学生サイト', key: '学生サイト' },
              { label: 'SNS', key: 'SNS' },
              { label: '地域サイト', key: '地域サイト' },
              { label: '口コミ', key: '口コミ' },
              { label: '自社集客合計', key: 'total' },
            ]

            mediaOrder.forEach((media, index) => {
              const startRow = 5 + index * 5
              const endRow = startRow + 4
              worksheet.mergeCells(startRow, 1, endRow, 1)
              const mediaCell = worksheet.getCell(startRow, 1)
              mediaCell.value = media.label
              mediaCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: mediaColors[media.label] || 'FF1F4E8C' },
              }
              mediaCell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
              mediaCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 }
              mediaCell.border = thinBorder

              for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
                const row = worksheet.getRow(rowNumber)
                row.height = 22

                for (let col = 1; col <= 11; col += 1) {
                  const cell = row.getCell(col)
                  cell.border = thinBorder

                  if (col >= 3) {
                    cell.alignment = { vertical: 'middle', horizontal: 'right' }
                  } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' }
                  }
                }

                const rowTypeCell = row.getCell(2)
                rowTypeCell.font = { bold: rowNumber === startRow || rowNumber === startRow + 3 || rowNumber === startRow + 4 }

                if (rowNumber === startRow + 3) {
                  row.eachCell((cell) => {
                    cell.fill = budgetRatioFill
                    cell.font = { ...(cell.font || {}), color: { argb: 'FF1F5BFF' }, bold: true }
                  })
                  mediaCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: mediaColors[media.label] || 'FF1F4E8C' },
                  }
                  mediaCell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
                }

                if (rowNumber === startRow + 4) {
                  row.eachCell((cell) => {
                    cell.fill = yearRatioFill
                    cell.font = { ...(cell.font || {}), color: { argb: 'FF0A8A3D' }, bold: true }
                  })
                  mediaCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: mediaColors[media.label] || 'FF1F4E8C' },
                  }
                  mediaCell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
                }

                if (index === mediaOrder.length - 1 && rowNumber <= endRow) {
                  row.eachCell((cell) => {
                    if (rowNumber === startRow + 3) {
                      cell.fill = budgetRatioFill
                    } else if (rowNumber === startRow + 4) {
                      cell.fill = yearRatioFill
                    } else {
                      cell.fill = totalFill
                    }
                    cell.font = { ...(cell.font || {}), bold: true }
                  })
                  mediaCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: mediaColors[media.label] },
                  }
                  mediaCell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
                }
              }
            })

            worksheet.getCell('A36').font = { bold: true }
            worksheet.getCell('B36').alignment = { vertical: 'middle', horizontal: 'left' }

            const buffer = await workbook.xlsx.writeBuffer()
            const blob = new Blob([buffer], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `${jishaTableTitle}.xlsx`
            link.click()
            URL.revokeObjectURL(url)
          }

          async function handleCellSave(media: JishaShukyakuMedia, rowType: JishaShukyakuRowType, field: string, rawValue: string) {
            const cellKey = `${media}-${rowType}-${field}`
            if (jishaSavingCell === cellKey) return
            if (jishaViewMode !== '単月') {
              setJishaCellEditing(null)
              return
            }

            setJishaSavingCell(cellKey)
            setJishaCellEditing(null)

            const normalizedValue = rawValue.trim()
            const numValue = Number(normalizedValue.replace(/,/g, '')) || 0
            const targetMonth = jishaMonth
            const existing = jishaShukyakuRecords.find(r => r.year === jishaYear && r.month === targetMonth && r.media === media && r.row_type === rowType)
            const update: Record<string, number> = {}
            update[field] = numValue
            try {
              if (existing) {
                if ((existing as Record<string, number | string>)[field] === numValue) return
                const { data } = await supabase.from('jisha_shukyaku').update(update).eq('id', existing.id).select().single()
                if (data) setJishaShukyakuRecords(prev => prev.map(r => r.id === existing.id ? { ...r, ...update } : r))
              } else {
                const newRec = {
                  year: jishaYear,
                  month: targetMonth,
                  media,
                  row_type: rowType,
                  hankyo_count: 0,
                  hankyo_raikyo: 0,
                  shinki_count: 0,
                  keiyaku_count: 0,
                  koken_uriaage: 0,
                  [field]: numValue,
                }
                const { data } = await supabase.from('jisha_shukyaku').insert(newRec).select().single()
                if (data) setJishaShukyakuRecords(prev => [...prev, data as JishaShukyakuRecord])
              }
            } finally {
              setJishaSavingCell(null)
            }
          }

          function getTotalData(rowType: JishaShukyakuRowType) {
            return JISHA_MEDIAS.reduce((acc, m) => {
              const d = getJishaData(m, rowType)
              return {
                hankyo_count: acc.hankyo_count + d.hankyo_count,
                hankyo_raikyo: acc.hankyo_raikyo + d.hankyo_raikyo,
                shinki_count: acc.shinki_count + d.shinki_count,
                keiyaku_count: acc.keiyaku_count + d.keiyaku_count,
                koken_uriaage: acc.koken_uriaage + d.koken_uriaage,
              }
            }, { hankyo_count: 0, hankyo_raikyo: 0, shinki_count: 0, keiyaku_count: 0, koken_uriaage: 0 })
          }

          function renderEditableCell(media: JishaShukyakuMedia, rowType: JishaShukyakuRowType, field: string, value: number) {
            const cellKey = `${media}-${rowType}-${field}`
            const isEditing = jishaCellEditing === cellKey
            const isEditable = jishaViewMode === '単月'
            if (isEditing) {
              return (
                <td key={field} className="jisha-cell jisha-cell-editing">
                  <input
                    className="jisha-input"
                    type="number"
                    value={jishaCellValue}
                    autoFocus
                    onChange={e => setJishaCellValue(e.target.value)}
                    onBlur={() => handleCellSave(media, rowType, field, jishaCellValue)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCellSave(media, rowType, field, jishaCellValue)
                      if (e.key === 'Escape') setJishaCellEditing(null)
                    }}
                  />
                </td>
              )
            }
            return (
              <td
                key={field}
                className={`jisha-cell${isEditable ? ' jisha-cell-editable' : ''}`}
                onClick={() => {
                  if (!isEditable) return
                  setJishaCellEditing(cellKey)
                  setJishaCellValue(String(value))
                }}
              >
                {value.toLocaleString('ja-JP')}
              </td>
            )
          }

          function renderRatioRow(rowLabel: string, numeratorType: JishaShukyakuRowType, denominatorType: JishaShukyakuRowType, media: JishaShukyakuMedia | 'total', colorClass: string) {
            const numData = media === 'total' ? getTotalData(numeratorType) : getJishaData(media as JishaShukyakuMedia, numeratorType)
            const denData = media === 'total' ? getTotalData(denominatorType) : getJishaData(media as JishaShukyakuMedia, denominatorType)
            const numRates = calcRates(numData)
            const denRates = calcRates(denData)
            function r(num: number, den: number) {
              if (den === 0) return '-'
              return `${(num / den * 100).toFixed(1)}%`
            }
            return (
              <tr key={`${media}-${rowLabel}`} className={`jisha-ratio-row ${colorClass}`}>
                <td className="jisha-label-cell jisha-sub-label">{rowLabel}</td>
                <td className="jisha-cell">{r(numData.hankyo_count, denData.hankyo_count)}</td>
                <td className="jisha-cell">{r(numData.hankyo_raikyo, denData.hankyo_raikyo)}</td>
                <td className="jisha-cell">{r(numRates.raikyo_rate, denRates.raikyo_rate)}</td>
                <td className="jisha-cell">{r(numData.shinki_count, denData.shinki_count)}</td>
                <td className="jisha-cell">{r(numData.keiyaku_count, denData.keiyaku_count)}</td>
                <td className="jisha-cell">{r(numRates.keiyaku_rate, denRates.keiyaku_rate)}</td>
                <td className="jisha-cell">{r(numRates.seiyaku_rate, denRates.seiyaku_rate)}</td>
                <td className="jisha-cell">{r(numData.koken_uriaage, denData.koken_uriaage)}</td>
                <td className="jisha-cell">{r(numRates.keiyaku_tanka, denRates.keiyaku_tanka)}</td>
              </tr>
            )
          }

          function renderMediaSection(media: JishaShukyakuMedia, mediaLabel: string, bgClass: string) {
            const rows = JISHA_ROW_TYPES.map((rowType, idx) => {
              const d = getJishaData(media, rowType)
              const rates = calcRates(d)
              const rowClass = rowType === '予算' ? 'jisha-yosan-row' : rowType === '実績' ? 'jisha-jisseki-row' : 'jisha-zennen-row'
              return (
                <tr key={`${media}-${rowType}`} className={rowClass}>
                  {idx === 0 && (
                    <td className={`jisha-media-cell ${bgClass}`} rowSpan={5}>
                      <span>{mediaLabel}</span>
                    </td>
                  )}
                  <td className="jisha-label-cell">{rowType}</td>
                  {renderEditableCell(media, rowType, 'hankyo_count', d.hankyo_count)}
                  {renderEditableCell(media, rowType, 'hankyo_raikyo', d.hankyo_raikyo)}
                  <td className="jisha-cell jisha-calc">{pct(rates.raikyo_rate)}</td>
                  {renderEditableCell(media, rowType, 'shinki_count', d.shinki_count)}
                  {renderEditableCell(media, rowType, 'keiyaku_count', d.keiyaku_count)}
                  <td className="jisha-cell jisha-calc">{pct(rates.keiyaku_rate)}</td>
                  <td className="jisha-cell jisha-calc">{pct(rates.seiyaku_rate)}</td>
                  {renderEditableCell(media, rowType, 'koken_uriaage', d.koken_uriaage)}
                  <td className="jisha-cell jisha-calc">{rates.keiyaku_tanka > 0 ? rates.keiyaku_tanka.toLocaleString('ja-JP') : '0'}</td>
                </tr>
              )
            })
            const yosanBiRow = renderRatioRow('予算比', '実績', '予算', media, 'jisha-yosan-hi-row')
            const nenBiRow = renderRatioRow('前年比', '実績', '前年', media, 'jisha-nen-hi-row')
            return [...rows, yosanBiRow, nenBiRow]
          }

          function renderTotalSection() {
            return JISHA_ROW_TYPES.map((rowType, idx) => {
              const d = getTotalData(rowType)
              const rates = calcRates(d)
              const rowClass = rowType === '予算' ? 'jisha-yosan-row jisha-total-row' : rowType === '実績' ? 'jisha-jisseki-row jisha-total-row' : 'jisha-zennen-row jisha-total-row'
              return (
                <tr key={`total-${rowType}`} className={rowClass}>
                  {idx === 0 && (
                    <td className="jisha-media-cell jisha-media-total" rowSpan={5}>
                      <span>自社集客合計</span>
                    </td>
                  )}
                  <td className="jisha-label-cell">{rowType}</td>
                  <td className="jisha-cell jisha-total-num">{d.hankyo_count.toLocaleString('ja-JP')}</td>
                  <td className="jisha-cell jisha-total-num">{d.hankyo_raikyo.toLocaleString('ja-JP')}</td>
                  <td className="jisha-cell jisha-calc jisha-total-num">{pct(rates.raikyo_rate)}</td>
                  <td className="jisha-cell jisha-total-num">{d.shinki_count.toLocaleString('ja-JP')}</td>
                  <td className="jisha-cell jisha-total-num">{d.keiyaku_count.toLocaleString('ja-JP')}</td>
                  <td className="jisha-cell jisha-calc jisha-total-num">{pct(rates.keiyaku_rate)}</td>
                  <td className="jisha-cell jisha-calc jisha-total-num">{pct(rates.seiyaku_rate)}</td>
                  <td className="jisha-cell jisha-total-num">{d.koken_uriaage.toLocaleString('ja-JP')}</td>
                  <td className="jisha-cell jisha-calc jisha-total-num">{rates.keiyaku_tanka > 0 ? rates.keiyaku_tanka.toLocaleString('ja-JP') : '0'}</td>
                </tr>
              )
            })
          }

          const totalYosanBiRow = renderRatioRow('予算比', '実績', '予算', 'total', 'jisha-yosan-hi-row jisha-total-row')
          const totalNenBiRow = renderRatioRow('前年比', '実績', '前年', 'total', 'jisha-nen-hi-row jisha-total-row')
          const viewLabel = jishaViewMode === '累計' ? `${jishaYear}年 ${jishaStartMonth}〜${jishaMonth}月 累計` : `${jishaYear}年${jishaMonth}月`
          const jishaTableTitle = jishaViewMode === '累計'
            ? `${jishaYear}年${jishaStartMonth}〜${jishaMonth}月累計 自社集客実績`
            : `${jishaYear}年${jishaMonth}月 自社集客実績`
          const jishaDropStatusLabel = jishaImporting
            ? '取り込み中...'
            : jishaImportMessageType === 'error' && jishaImportMessage
              ? '取込失敗'
              : jishaImportMessage
                ? '取込完了'
                : '待機中'
          const jishaDropStatusClass = jishaImporting
            ? 'is-importing'
            : jishaImportMessageType === 'error' && jishaImportMessage
              ? 'is-error'
              : jishaImportMessage
                ? 'is-success'
                : 'is-idle'

          return (
            <section className="panel jisha-panel" id="jisha-print-area">
              <div className="panel-heading no-print">
                <div className="jisha-heading-text">
                  <h2>自社集客実績</h2>
                  <p>メディア別集客・成約データ（セルをクリックして編集）</p>
                </div>
                <div className="jisha-controls">
                  <div className={`jisha-update-badge${jishaImportMessageType === 'error' && !jishaImporting ? ' is-error' : ''}`}>
                    {jishaImporting ? '取り込み中...' : (jishaImportMessage || '最終更新: -')}
                  </div>
                  <div className="jisha-toggle">
                    <button className={jishaViewMode === '単月' ? 'active' : ''} onClick={() => setJishaViewMode('単月')}>単月</button>
                    <button className={jishaViewMode === '累計' ? 'active' : ''} onClick={() => setJishaViewMode('累計')}>累計</button>
                  </div>
                  <select value={jishaYear} onChange={e => setJishaYear(Number(e.target.value))}>
                    {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}年</option>)}
                  </select>
                  {jishaViewMode === '累計' ? (
                    <div className="jisha-period-selects">
                      <label>
                        <span>開始</span>
                        <select
                          value={jishaStartMonth}
                          onChange={e => {
                            const month = Number(e.target.value)
                            setJishaStartMonth(month)
                            if (month > jishaMonth) setJishaMonth(month)
                          }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
                        </select>
                      </label>
                      <span className="jisha-period-separator">〜</span>
                      <label>
                        <span>終了</span>
                        <select
                          value={jishaMonth}
                          onChange={e => {
                            const month = Number(e.target.value)
                            setJishaMonth(month)
                            if (month < jishaStartMonth) setJishaStartMonth(month)
                          }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <select value={jishaMonth} onChange={e => setJishaMonth(Number(e.target.value))}>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
                    </select>
                  )}
                  <button
                    className="secondary"
                    style={{ fontSize: '0.82rem', padding: '5px 10px' }}
                    onClick={() => void exportJishaExcel()}
                  >
                    Excel出力
                  </button>
                  <button className="secondary" style={{ fontSize: '0.82rem', padding: '5px 10px' }} onClick={() => window.print()}>🖨 印刷</button>
                </div>
                <div className="jisha-import-block">
                  <input
                    ref={jishaFileInputRef}
                    type="file"
                    multiple
                    accept=".xls,.xlsx,.xlsm,.xlsb"
                    className="jisha-file-input"
                    onChange={(e) => void importJishaExcelFiles(Array.from(e.target.files || []))}
                  />
                  <div
                    className={`jisha-drop-zone${jishaImportDragActive ? ' is-dragging' : ''}${jishaImporting ? ' is-busy' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (!jishaImporting) setJishaImportDragActive(true)
                    }}
                    onDragLeave={() => setJishaImportDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (jishaImporting) return
                      void importJishaExcelFiles(Array.from(e.dataTransfer.files || []))
                    }}
                  >
                    <div className="jisha-drop-copy">
                      <strong>{jishaImporting ? '取り込み中です...' : 'Excelをここに落としてください'}</strong>
                      {jishaImporting && <span>数字を読み込んでいます。少し待ってください。</span>}
                    </div>
                    <div className={`jisha-drop-status ${jishaDropStatusClass}`}>
                      {jishaDropStatusLabel}
                    </div>
                    <button
                      type="button"
                      className="secondary jisha-file-button"
                      onClick={() => jishaFileInputRef.current?.click()}
                      disabled={jishaImporting}
                    >
                      {jishaImporting ? '取込中...' : 'ファイルを選ぶ'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="jisha-table-wrap">
                <div className="jisha-table-title">{jishaTableTitle}</div>
                <table className="jisha-table">
                  <thead>
                    <tr>
                      <th className="jisha-th-media" colSpan={2}>{viewLabel}</th>
                      <th className="jisha-th">反響数</th>
                      <th className="jisha-th">反響来店</th>
                      <th className="jisha-th">反来率</th>
                      <th className="jisha-th">新規数</th>
                      <th className="jisha-th">契約数</th>
                      <th className="jisha-th">契約率</th>
                      <th className="jisha-th">反響成約率</th>
                      <th className="jisha-th">貢献売上</th>
                      <th className="jisha-th">契約単価</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderMediaSection('Karilun', 'Karilun', 'jisha-media-karilun')}
                    {renderMediaSection('学生サイト', '学生サイト', 'jisha-media-gakusei')}
                    {renderMediaSection('SNS', 'SNS', 'jisha-media-sns')}
                    {renderMediaSection('地域サイト', '地域サイト', 'jisha-media-chiiki')}
                    {renderMediaSection('口コミ', '口コミ', 'jisha-media-kuchikomi')}
                    {renderTotalSection()}
                    {totalYosanBiRow}
                    {totalNenBiRow}
                  </tbody>
                </table>
                <p className="jisha-hint no-print">数字の編集は単月だけでできます。累計は合計を見せる場所なので、クリックしても数字は変わりません。</p>
              </div>
            </section>
          )
        })()}
        {activePage === 'taskreport' && <TaskReportPanel />}
        {activePage === 'progress' && <ProgressPage onSnsPropertyPromoted={handleSnsPropertyPromoted} />}
      </main>

      {/* ===== フローティング追加ボタン ===== */}
      {activePage !== 'dashboard' && activePage !== 'members' && activePage !== 'manuals' && activePage !== 'jishashukyaku' && activePage !== 'taskreport' && activePage !== 'progress' && activePage !== 'snsproperty' && (
        <button
          className="fab"
          onClick={() => {
            if (activePage === 'busho') {
              setEditingBushoId(null)
              setTaskError(null)
              setBushoForm({ ...defaultBushoForm, date: bushoSelectedDate || new Date().toISOString().slice(0, 10) })
            }
            setShowModal(true)
          }}
          aria-label="新規追加"
          title="新規追加"
        >
          ＋
        </button>
      )}

      {/* ===== 追加フォームモーダル ===== */}
      {showModal && activePage !== 'dashboard' && activePage !== 'members' && activePage !== 'manuals' && activePage !== 'jishashukyaku' && activePage !== 'taskreport' && activePage !== 'progress' && activePage !== 'snsproperty' && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            if (activePage === 'busho') {
              resetBushoModal()
              return
            }
            setShowModal(false)
          }
        }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">
                {activePage === 'tasks' && '案件を追加'}
                {activePage === 'taskmanagement' && 'タスクを追加'}
                {activePage === 'sns' && '投稿を追加'}
                {activePage === 'recruitment' && '採用データを追加'}
                {activePage === 'hankyo' && '反響を追加'}
                {activePage === 'dm' && 'DMを追加'}
                {activePage === 'stock' && 'ストックを追加'}
                {activePage === 'busho' && (editingBushoId ? '予定を編集' : '予定を追加')}
              </h2>
              <button className="modal-close" onClick={() => activePage === 'busho' ? resetBushoModal() : setShowModal(false)}>✕</button>
            </div>

            {/* 案件管理フォーム */}
            {activePage === 'tasks' && (
              <form className="data-form" onSubmit={handleTaskSubmit}>
                <label className="form-label">案件日
                  <input type="date" value={taskForm.taskDate} onChange={(e) => setTaskForm({ ...taskForm, taskDate: e.target.value })} required />
                </label>
                <label className="form-label">担当者（複数選択可）
                  <div className="checkbox-group">
                    {assigneeOptions.map((a) => (
                      <label key={a} className="checkbox-item">
                        <input type="checkbox" checked={taskForm.assignees.includes(a)} onChange={(e) => {
                          const next = e.target.checked ? [...taskForm.assignees, a] : taskForm.assignees.filter((x) => x !== a)
                          setTaskForm({ ...taskForm, assignees: next })
                        }} />
                        {a}
                      </label>
                    ))}
                  </div>
                </label>
                <label className="form-label">依頼部署
                  <select value={taskForm.department} onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value as Department })}>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                </label>
                <label className="form-label">案件名
                  <input placeholder="案件名" value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} required />
                </label>
                <label className="form-label">案件内容
                  <textarea placeholder="案件の詳細内容" value={taskForm.content} onChange={(e) => setTaskForm({ ...taskForm, content: e.target.value })} rows={3} />
                </label>
                <label className="form-label">種類
                  <select value={taskForm.taskType} onChange={(e) => setTaskForm({ ...taskForm, taskType: e.target.value as TaskType, dueDate: '' })}>{taskTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                </label>
                {taskForm.taskType === '単発' && (
                  <label className="form-label">期日
                    <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} required />
                  </label>
                )}
                {taskForm.taskType === '継続' && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', margin: '0' }}>※ 継続案件は期日不要。完了ステータスに変更した日が自動的に完了日になります。</p>
                )}
                <label className="form-label">優先度
                  <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as Priority })}>{priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </label>
                <label className="form-label">現状
                  <select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value as TaskStatus })}>{taskStatuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </label>
                <label className="form-label">削減額
                  <input type="number" min="0" placeholder="削減額（例: 50000）" value={taskForm.savings || ''} onChange={(e) => setTaskForm({ ...taskForm, savings: Number(e.target.value) || 0 })} />
                </label>
                <label className="form-label">補足
                  <textarea placeholder="補足・メモ" value={taskForm.note} onChange={(e) => setTaskForm({ ...taskForm, note: e.target.value })} rows={2} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => setShowModal(false)}>キャンセル</button>
                </div>
              </form>
            )}

            {/* タスク管理フォーム */}
            {activePage === 'taskmanagement' && (
              <>
                {taskError && <p className="error-msg">{taskError}</p>}
                <form className="data-form" onSubmit={handleTaskItemSubmit}>
                  <label className="form-label">日付
                    <input type="date" value={taskItemForm.date} onChange={(e) => setTaskItemForm({ ...taskItemForm, date: e.target.value })} required />
                  </label>
                  <label className="form-label">タスク名 <span className="required-badge">必須</span>
                    <input placeholder="タスク名" value={taskItemForm.name} onChange={(e) => setTaskItemForm({ ...taskItemForm, name: e.target.value })} required />
                  </label>
                  <label className="form-label">親タスク
                    <select value={taskItemForm.parent_task_id || ''} onChange={(e) => setTaskItemForm({ ...taskItemForm, parent_task_id: e.target.value || null, recurring_type: e.target.value ? 'none' : taskItemForm.recurring_type })}>
                      <option value="">なし</option>
                      {taskItems.filter((item) => !item.parent_task_id).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}{getTaskItemPrimaryAssignee(item) ? `・${getTaskItemPrimaryAssignee(item)}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-label">メモ
                    <textarea placeholder="メモ内容" value={taskItemForm.memo} onChange={(e) => setTaskItemForm({ ...taskItemForm, memo: e.target.value })} rows={2} />
                  </label>
                  <label className="form-label">優先度
                    <select value={taskItemForm.priority} onChange={(e) => setTaskItemForm({ ...taskItemForm, priority: e.target.value as Priority })}>
                      {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label className="form-label">作業日
                    <input type="date" value={taskItemForm.work_date} onChange={(e) => setTaskItemForm({ ...taskItemForm, work_date: e.target.value })} />
                  </label>
                  <label className="form-label">期日
                    <input type="date" value={taskItemForm.due_date} onChange={(e) => setTaskItemForm({ ...taskItemForm, due_date: e.target.value })} />
                  </label>
                  <label className="form-label">毎月くり返し
                    <select
                      value={taskItemForm.parent_task_id ? 'none' : (taskItemForm.recurring_type || 'none')}
                      disabled={!!taskItemForm.parent_task_id}
                      onChange={(e) => setTaskItemForm({ ...taskItemForm, recurring_type: e.target.value as TaskItemRecurrence })}
                    >
                      <option value="none">しない</option>
                      <option value="monthly">する</option>
                    </select>
                  </label>
                  {taskItemForm.parent_task_id && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', margin: '0' }}>
                      ※ 子タスクは親タスクの設定に合わせます。
                      {(taskItems.find((item) => item.id === taskItemForm.parent_task_id)?.recurring_type === 'monthly') ? ' この子タスクも毎月自動で作られます。' : ''}
                    </p>
                  )}
                  {taskItemForm.recurring_type === 'monthly' && !taskItemForm.parent_task_id && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', margin: '0' }}>※ 月が変わると同じタスクを自動で1件作ります。4月末なら次は5月末になります。</p>
                  )}
                  <label className="form-label">担当者
                    <div className="checkbox-group">
                      {members.map((m) => (
                        <label key={m.id} className="checkbox-item">
                          <input type="checkbox" checked={taskItemForm.assignees.includes(m.name)} onChange={(e) => {
                            const next = e.target.checked ? [...taskItemForm.assignees, m.name] : taskItemForm.assignees.filter((x) => x !== m.name)
                            setTaskItemForm({ ...taskItemForm, assignees: next })
                          }} />{m.name}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="form-label">設定者
                    <div className="checkbox-group">
                      {members.map((m) => (
                        <label key={m.id} className="checkbox-item">
                          <input type="checkbox" checked={taskItemForm.creator === m.name} onChange={() => setTaskItemForm({ ...taskItemForm, creator: m.name })} />{m.name}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="form-label">ステータス
                    <select value={taskItemForm.status} onChange={(e) => setTaskItemForm({ ...taskItemForm, status: e.target.value as TaskItemStatus })}>
                      {taskItemStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <div className="form-actions">
                    <button type="submit" className="primary">追加する</button>
                    <button type="button" className="secondary" onClick={() => setShowModal(false)}>キャンセル</button>
                  </div>
                </form>
              </>
            )}

            {/* SNS投稿管理フォーム */}
            {activePage === 'sns' && (
              <form className="data-form" onSubmit={handleSnsSubmit}>
                <label className="form-label">投稿日
                  <input type="date" value={snsForm.postDate} onChange={(e) => setSnsForm({ ...snsForm, postDate: e.target.value })} required />
                </label>
                <label className="form-label">媒体
                  <select value={snsForm.platform} onChange={(e) => setSnsForm({ ...snsForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </label>
                <label className="form-label">アカウント
                  <select value={snsForm.account} onChange={(e) => setSnsForm({ ...snsForm, account: e.target.value })}>{snsAccounts.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                </label>
                <label className="form-label">コメント数
                  <input type="number" min="0" placeholder="コメント数（例: 50）" value={snsForm.comments || ''} onChange={(e) => setSnsForm({ ...snsForm, comments: Number(e.target.value) || 0 })} />
                </label>
                <label className="form-label">保存数
                  <input type="number" min="0" placeholder="保存数（例: 100）" value={snsForm.saves || ''} onChange={(e) => setSnsForm({ ...snsForm, saves: Number(e.target.value) || 0 })} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => setShowModal(false)}>キャンセル</button>
                </div>
              </form>
            )}

            {/* 採用管理フォーム */}
            {activePage === 'recruitment' && (
              <form className="data-form" onSubmit={handleRecruitmentSubmit}>
                <label className="form-label">応募日
                  <input type="date" value={recruitmentForm.date} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, date: e.target.value })} required />
                </label>
                <label className="form-label">媒体
                  <select value={recruitmentForm.platform} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </label>
                <label className="form-label">部署
                  <select value={recruitmentForm.department} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, department: e.target.value as RecruitDepartment })}>{recruitDepartments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                </label>
                <label className="form-label">職種
                  <select value={recruitmentForm.jobType} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, jobType: e.target.value as JobType })}>{jobTypes.map((j) => <option key={j} value={j}>{j}</option>)}</select>
                </label>
                <label className="form-label">削減額
                  <input type="number" min="0" placeholder="削減額（例: 50000）" value={recruitmentForm.costReduction || ''} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, costReduction: Number(e.target.value) || 0 })} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => setShowModal(false)}>キャンセル</button>
                </div>
              </form>
            )}

            {/* 反響管理フォーム */}
            {activePage === 'hankyo' && (
              <form className="data-form" onSubmit={handleHankyoSubmit}>
                <label className="form-label">反響日
                  <input type="date" value={hankyoForm.inquiry_date} onChange={(e) => setHankyoForm({ ...hankyoForm, inquiry_date: e.target.value })} required />
                </label>
                <label className="form-label">アカウント
                  <select value={hankyoForm.account} onChange={(e) => setHankyoForm({ ...hankyoForm, account: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoAccounts.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </label>
                <label className="form-label">きっかけ
                  <select value={hankyoForm.trigger} onChange={(e) => setHankyoForm({ ...hankyoForm, trigger: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoTriggers.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">反響媒体
                  <select value={hankyoForm.media} onChange={(e) => setHankyoForm({ ...hankyoForm, media: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoMedias.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="form-label">問合内容
                  <select value={hankyoForm.inquiry_type} onChange={(e) => setHankyoForm({ ...hankyoForm, inquiry_type: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoInquiryTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">顧客名 <span className="required-badge">必須</span>
                  <input placeholder="顧客名" value={hankyoForm.customer_name} onChange={(e) => setHankyoForm({ ...hankyoForm, customer_name: e.target.value })} required />
                </label>
                <label className="form-label">問合手段
                  <select value={hankyoForm.contact_method} onChange={(e) => setHankyoForm({ ...hankyoForm, contact_method: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoContactMethods.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="form-label">入居希望時期
                  <select value={hankyoForm.move_in_timing} onChange={(e) => setHankyoForm({ ...hankyoForm, move_in_timing: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoMoveInTimings.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">送客先店舗
                  <select value={hankyoForm.store} onChange={(e) => setHankyoForm({ ...hankyoForm, store: e.target.value })}>
                    <option value="">選択してください</option>
                    {hankyoStores.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="form-label">希望エリア
                  <input placeholder="例: 大阪市、守口市" value={hankyoForm.area} onChange={(e) => setHankyoForm({ ...hankyoForm, area: e.target.value })} />
                </label>
                <label className="form-label">備考
                  <textarea placeholder="備考・メモ" rows={2} value={hankyoForm.note} onChange={(e) => setHankyoForm({ ...hankyoForm, note: e.target.value })} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => { setShowModal(false); setHankyoForm({ ...defaultHankyoForm, inquiry_date: new Date().toISOString().split('T')[0] }) }}>キャンセル</button>
                </div>
              </form>
            )}

            {/* DM管理フォーム */}
            {activePage === 'dm' && (
              <form className="data-form" onSubmit={(e) => { handleDmSubmit(e); setShowModal(false) }}>
                <label className="form-label">日付
                  <input type="date" value={dmForm.date} onChange={(e) => setDmForm({ ...dmForm, date: e.target.value })} required />
                </label>
                <div className="form-label">アカウント名
                  <div className="radio-group">
                    {dmAccounts.map((a) => (
                      <label key={a} className="radio-item">
                        <input type="radio" name="dm-account" value={a} checked={dmForm.account === a} onChange={() => handleDmAccountChange(a)} />
                        {a}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-label">SNS
                  <div className="radio-group">
                    {dmSnsList.map((s) => (
                      <label key={s} className="radio-item">
                        <input type="radio" name="dm-sns" value={s} checked={dmForm.sns === s} onChange={() => setDmForm({ ...dmForm, sns: s })} />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="form-label">反響物件番号
                  <input placeholder="例: K001" value={dmForm.property_number} onChange={(e) => setDmForm({ ...dmForm, property_number: e.target.value })} />
                </label>
                <label className="form-label">エリア
                  {dmAreaLoading && <span className="dm-area-loading">取得中…</span>}
                  <input placeholder="物件番号入力で自動取得" value={dmForm.area} onChange={(e) => setDmForm({ ...dmForm, area: e.target.value })} />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => { setShowModal(false); setDmForm({ ...defaultDmForm, date: new Date().toISOString().split('T')[0] }) }}>キャンセル</button>
                </div>
              </form>
            )}

            {/* ストック管理フォーム */}
            {activePage === 'stock' && (
              <form className="data-form" onSubmit={handleStockSubmit}>
                <label className="form-label">締切日
                  <input type="date" value={stockForm.deadline} onChange={e => setStockForm({ ...stockForm, deadline: e.target.value })} required />
                </label>
                <label className="form-label">ラベル（例：仲介、管理）
                  <input placeholder="例: 仲介" value={stockForm.label} onChange={e => setStockForm({ ...stockForm, label: e.target.value })} required />
                </label>
                <label className="form-label">必要件数
                  <input type="number" min="1" value={stockForm.required_count} onChange={e => setStockForm({ ...stockForm, required_count: Number(e.target.value) })} required />
                </label>
                <label className="form-label">達成件数
                  <input type="number" min="0" value={stockForm.achieved_count} onChange={e => setStockForm({ ...stockForm, achieved_count: Number(e.target.value) })} />
                </label>
                <label className="form-label">メモ
                  <input value={stockForm.note} onChange={e => setStockForm({ ...stockForm, note: e.target.value })} placeholder="任意" />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                  <button type="button" className="secondary" onClick={() => { setShowModal(false); setStockForm(defaultStockForm) }}>キャンセル</button>
                </div>
              </form>
            )}

            {activePage === 'busho' && (
              <>
                {taskError && <p className="error-msg">{taskError}</p>}
                <form className="data-form" onSubmit={handleBushoSubmit}>
                  <label className="form-label">日付
                    <input
                      type="date"
                      value={bushoForm.date}
                      onChange={(e) => setBushoForm({ ...bushoForm, date: e.target.value })}
                      required
                    />
                  </label>
                  <label className="form-label">時間（任意）
                    <input
                      type="time"
                      value={bushoForm.start_time}
                      onChange={(e) => setBushoForm({ ...bushoForm, start_time: e.target.value })}
                    />
                  </label>
                  <label className="form-label">部署
                    <select
                      value={bushoForm.department}
                      onChange={(e) => setBushoForm({ ...bushoForm, department: e.target.value })}
                      required
                    >
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="form-label">タイトル
                    <input
                      type="text"
                      value={bushoForm.title}
                      onChange={(e) => setBushoForm({ ...bushoForm, title: e.target.value })}
                      required
                      placeholder="予定のタイトル"
                    />
                  </label>
                  <label className="form-label">メモ
                    <textarea
                      value={bushoForm.note}
                      onChange={(e) => setBushoForm({ ...bushoForm, note: e.target.value })}
                      rows={3}
                      placeholder="備考など"
                    />
                  </label>
                  <div className="form-actions">
                    <button type="submit" className="primary">{editingBushoId ? '保存' : '追加'}</button>
                    <button type="button" className="secondary" onClick={resetBushoModal}>キャンセル</button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {showAllowedAccountsModal && (
        <div className="modal-overlay" onClick={() => setShowAllowedAccountsModal(false)}>
          <div className="modal-content access-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">閲覧できるGoogleアカウント</h3>
              <button className="modal-close" onClick={() => setShowAllowedAccountsModal(false)}>×</button>
            </div>

            <p className="access-manager-note">ここに入っているGoogleアカウントだけ、この管理ツールを開けます。</p>

            <div className="access-manager-form">
              <input
                type="email"
                placeholder="追加したいGoogleアカウント"
                value={allowedAccountForm}
                onChange={(e) => setAllowedAccountForm(e.target.value)}
              />
              <button className="primary" onClick={addAllowedAccount} disabled={allowedAccountSaving}>
                {allowedAccountSaving ? '保存中...' : '追加'}
              </button>
            </div>

            <p className="access-manager-note">`trg.yshini@gmail.com` がマスターです。このアカウントだけが追加と削除をできます。</p>
            {allowedAccountMessage && <p className="access-manager-message">{allowedAccountMessage}</p>}

            <div className="access-account-list">
              {allowedAccounts.map((account) => (
                <div key={account.id} className="access-account-card">
                  <div className="access-account-main">
                    <strong>{account.email}</strong>
                    {account.is_master && <span className="auth-master-badge access-master-badge">マスター</span>}
                    {account.allow_outside_office && <span className="outside-office-badge">社外OK</span>}
                  </div>
                  <div className="access-account-actions">
                    <label className="outside-office-toggle">
                      <input
                        type="checkbox"
                        checked={account.allow_outside_office}
                        onChange={() => toggleOutsideOfficeAccess(account)}
                        disabled={allowedAccountSaving}
                      />
                      社外からも開ける
                    </label>
                    {!account.is_master && (
                      <button className="danger" onClick={() => removeAllowedAccount(account.email)} disabled={allowedAccountSaving}>
                        削除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {snsPropertyOptionEditor && (
        <SnsPropertyOptionEditorModal
          editor={snsPropertyOptionEditor}
          onClose={() => setSnsPropertyOptionEditor(null)}
          onChangeItem={updateSnsPropertyOptionItem}
          onMoveItem={moveSnsPropertyOptionItem}
          onRemoveItem={removeSnsPropertyOptionItem}
          onAddItem={addSnsPropertyOptionItem}
          onSave={saveSnsPropertyOptionItems}
        />
      )}

      </div>
    </OfficeNetworkGate>
  )
}

const STORAGE_KEY = 'gcal_token'
const STORAGE_EXPIRY_KEY = 'gcal_token_expiry'
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const GOOGLE_LOGIN_SCOPE = `openid email profile ${GOOGLE_CALENDAR_SCOPE}`

function getSavedToken(): string | null {
  try {
    const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY)
    if (!expiry || Date.now() > Number(expiry)) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_EXPIRY_KEY)
      return null
    }
    return localStorage.getItem(STORAGE_KEY)
  } catch { return null }
}

function saveToken(token: string, expiresIn: number) {
  try {
    localStorage.setItem(STORAGE_KEY, token)
    localStorage.setItem(STORAGE_EXPIRY_KEY, String(Date.now() + expiresIn * 1000))
  } catch { /* ignore */ }
}

function clearToken() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_EXPIRY_KEY)
  } catch { /* ignore */ }
}

function normalizeTaskReportText(value: string) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function hasTaskReportDayOff(events: TaskReportCalendarEvent[]) {
  const normalizedKeywords = TASK_REPORT_DAY_OFF_KEYWORDS.map((keyword) => normalizeTaskReportText(keyword))
  return events.some((event) => {
    if (!event.isAllDay) return false
    const normalizedSummary = normalizeTaskReportText(event.summary)
    return normalizedKeywords.some((keyword) => normalizedSummary.includes(keyword))
  })
}

function sortTaskReportCategories(categories: TaskReportCategoryMaster[]) {
  return [...categories].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name, 'ja')
  })
}

function getTaskReportFallbackCategory(categories: TaskReportCategoryMaster[]) {
  return sortTaskReportCategories(categories).find((category) => category.name === 'その他')?.name
    || sortTaskReportCategories(categories)[0]?.name
    || 'その他'
}

function buildTaskReportCategoryRules(categories: TaskReportCategoryMaster[]) {
  return sortTaskReportCategories(categories).flatMap((category) =>
    category.keywords
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        category: category.name,
        keywords: line.split(/[、,]/).map((keyword) => keyword.trim()).filter(Boolean),
      })),
  )
}

function getTaskReportCategoryOptions(categories: TaskReportCategoryMaster[]) {
  const options = sortTaskReportCategories(categories).map((category) => category.name)
  return options.length > 0 ? options : ['その他']
}

function classifyTaskReportName(taskName: string, categories: TaskReportCategoryMaster[] = [...DEFAULT_TASK_REPORT_CATEGORIES]) {
  const normalized = normalizeTaskReportText(taskName)
  const rules = buildTaskReportCategoryRules(categories)

  for (const rule of rules) {
    if (rule.keywords.every((keyword) => normalized.includes(normalizeTaskReportText(keyword)))) {
      return { category: rule.category }
    }
  }

  return { category: getTaskReportFallbackCategory(categories) }
}

function formatTaskReportHours(minutes: number) {
  return (minutes / 60).toFixed(1).replace(/\.0$/, '')
}

function formatTaskReportTime(minutes: number) {
  const safeMinutes = Math.max(0, minutes)
  const hours = Math.floor(safeMinutes / 60)
  const remainMinutes = safeMinutes % 60
  if (hours === 0) return `${remainMinutes}分`
  if (remainMinutes === 0) return `${hours}時間`
  return `${hours}時間${remainMinutes}分`
}

function formatTaskReportChartAxis(value: number, metric: 'count' | 'minutes') {
  if (metric === 'count') return `${value}件`
  return `${Math.round((value / 60) * 10) / 10}h`
}

function getTaskReportMonthKeys(startDate: string, endDate: string) {
  if (!startDate || !endDate || startDate > endDate) return []

  const months: string[] = []
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00`)
  const limit = new Date(`${endDate.slice(0, 7)}-01T00:00:00`)

  while (cursor <= limit) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

function getTaskReportWorkMinutes(memberName: string, events: TaskReportCalendarEvent[]) {
  const normalizedSummaries = events.map((event) => normalizeTaskReportText(event.summary))
  if (hasTaskReportDayOff(events)) return 0

  const has395Work = memberName !== '吉田' && events.some((event) => {
    if (!event.isAllDay) return false
    const normalizedSummary = normalizeTaskReportText(event.summary)
    return normalizedSummary.includes('395') || normalizedSummary.includes('３９５')
  })
  if (has395Work) return TASK_REPORT_395_MINUTES

  if (memberName === STOCK_HONMACHI_MEMBER.name) {
    const hasHonshaToHonmachi = normalizedSummaries.some((summary) => summary.includes('本社→本町') || summary.includes('本社本町'))
    if (hasHonshaToHonmachi) return TASK_REPORT_NII_HONSHA_TO_HONMACHI_MINUTES

    const hasHonmachi = normalizedSummaries.some((summary) => summary.includes('本町'))
    return hasHonmachi ? TASK_REPORT_NII_HONMACHI_MINUTES : 0
  }

  return TASK_REPORT_WORK_MINUTES[memberName] || 0
}

function TaskReportPanel() {
  const today = new Date().toISOString().slice(0, 10)
  const firstDayOfMonth = `${today.slice(0, 8)}01`
  const [startDate, setStartDate] = useState(firstDayOfMonth)
  const [endDate, setEndDate] = useState(today)
  const [rows, setRows] = useState<TaskReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<string[]>([])
  const [chartMetric, setChartMetric] = useState<'count' | 'minutes'>('count')
  const [savingRowId, setSavingRowId] = useState('')
  const [listMonth, setListMonth] = useState(today.slice(0, 7))
  const [listDate, setListDate] = useState(today)
  const [categoryMasters, setCategoryMasters] = useState<TaskReportCategoryMaster[]>([...DEFAULT_TASK_REPORT_CATEGORIES])
  const [categoryMastersReady, setCategoryMastersReady] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [categoryModalLoading, setCategoryModalLoading] = useState(false)
  const [categoryModalSaving, setCategoryModalSaving] = useState(false)
  const [categoryModalError, setCategoryModalError] = useState('')
  const [categoryDraft, setCategoryDraft] = useState({ id: '', name: '', keywords: '' })
  const [workMinutesByDate, setWorkMinutesByDate] = useState<Record<string, Record<string, number>>>({})
  const categoryOptions = getTaskReportCategoryOptions(categoryMasters)

  const loadCategoryMasters = useCallback(async () => {
    setCategoryModalLoading(true)

    const { data, error: categoriesError } = await supabase
      .from('task_report_categories')
      .select('id, name, keywords, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (categoriesError) {
      setCategoryMasters([...DEFAULT_TASK_REPORT_CATEGORIES])
      setCategoryModalError(`カテゴリ設定の読み込みに失敗しました: ${categoriesError.message}`)
      setCategoryModalLoading(false)
      setCategoryMastersReady(true)
      return
    }

    const nextCategories = (data && data.length > 0 ? data : [...DEFAULT_TASK_REPORT_CATEGORIES]) as TaskReportCategoryMaster[]
    setCategoryMasters(sortTaskReportCategories(nextCategories))
    setCategoryModalError('')
    setCategoryModalLoading(false)
    setCategoryMastersReady(true)
  }, [])

  const fetchReport = useCallback(async () => {
    if (!startDate || !endDate) {
      setError('開始日と終了日を入れてください。')
      return
    }
    if (startDate > endDate) {
      setError('開始日は終了日より前にしてください。')
      return
    }

    setLoading(true)
    setError('')

    const [calendarResult, manualResult] = await Promise.all([
      supabase
        .from('checked_events')
        .select('event_key, event_date, minutes, task_name, member_calendar_id, member_name, category')
        .gte('event_date', startDate)
        .lte('event_date', endDate)
        .not('task_name', 'is', null),
      supabase
        .from('manual_tasks')
        .select('id, event_date, member_calendar_id, task_name, minutes, checked, category')
        .eq('checked', true)
        .gte('event_date', startDate)
        .lte('event_date', endDate),
    ])

    if (calendarResult.error || manualResult.error) {
      setError(`読み込みに失敗しました: ${calendarResult.error?.message || manualResult.error?.message}`)
      setRows([])
      setLoading(false)
      return
    }

    const calendarRows = (calendarResult.data || [])
      .filter((row) => row.member_calendar_id && MEMBER_NAME_BY_CALENDAR_ID[row.member_calendar_id])
      .map((row) => {
        const resolvedCategory = row.category || classifyTaskReportName(row.task_name || '', categoryMasters).category
        return {
          id: `calendar-${row.event_key}`,
          event_date: row.event_date,
          member_name: row.member_name || MEMBER_NAME_BY_CALENDAR_ID[row.member_calendar_id] || '未設定',
          task_name: row.task_name || 'タイトルなし',
          minutes: typeof row.minutes === 'number' ? row.minutes : 0,
          source: 'Googleカレンダー' as const,
          category: resolvedCategory,
          source_key: row.event_key,
          source_type: 'checked_events' as const,
        }
      })

    const manualRows = (manualResult.data || [])
      .filter((row) => row.member_calendar_id && MEMBER_NAME_BY_CALENDAR_ID[row.member_calendar_id])
      .map((row) => {
        const resolvedCategory = row.category || classifyTaskReportName(row.task_name || '', categoryMasters).category
        return {
          id: `manual-${row.id}`,
          event_date: row.event_date,
          member_name: MEMBER_NAME_BY_CALENDAR_ID[row.member_calendar_id] || '未設定',
          task_name: row.task_name || 'タイトルなし',
          minutes: typeof row.minutes === 'number' ? row.minutes : 0,
          source: '追加タスク' as const,
          category: resolvedCategory,
          source_key: row.id,
          source_type: 'manual_tasks' as const,
        }
      })

    const mergedRows = [...calendarRows, ...manualRows].sort((a, b) => {
      if (a.event_date === b.event_date) return a.member_name.localeCompare(b.member_name, 'ja')
      return a.event_date < b.event_date ? 1 : -1
    })

    setRows(mergedRows)
    void Promise.all([
      ...(calendarResult.data || [])
        .filter((row) => !row.category && row.task_name)
        .map((row) =>
          supabase
            .from('checked_events')
            .update({ category: classifyTaskReportName(row.task_name || '', categoryMasters).category })
            .eq('event_key', row.event_key)
            .eq('event_date', row.event_date),
        ),
      ...(manualResult.data || [])
        .filter((row) => !row.category && row.task_name)
        .map((row) =>
          supabase
            .from('manual_tasks')
            .update({ category: classifyTaskReportName(row.task_name || '', categoryMasters).category })
            .eq('id', row.id),
        ),
    ])
    setLoading(false)
  }, [categoryMasters, endDate, startDate])

  const fetchWorkMinutes = useCallback(async (yearMonth: string) => {
    const token = getSavedToken()
    if (!token) {
      setWorkMinutesByDate({})
      return
    }

    const [year, month] = yearMonth.split('-').map(Number)
    const startDateText = `${year}-${String(month).padStart(2, '0')}-01`
    const endDateText = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`
    const monthLastDay = new Date(year, month, 0).getDate()
    const dateTexts = Array.from({ length: monthLastDay }, (_, index) => (
      `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    ))
    const eventsByMember: Record<string, Record<string, TaskReportCalendarEvent[]>> = {}
    const loadedCalendarIds = new Set<string>()
    const formatJapanDate = (dateTime: string) => {
      const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(dateTime))
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
      return `${values.year}-${values.month}-${values.day}`
    }

    await Promise.all(
      TEAM_MEMBER_OPTIONS.map(async (member) => {
        try {
          const params = new URLSearchParams({
            timeMin: `${startDateText}T00:00:00+09:00`,
            timeMax: `${endDateText}T00:00:00+09:00`,
            timeZone: 'Asia/Tokyo',
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '2500',
          })
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(member.calendarId)}/events?${params.toString()}`
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
          if (res.status === 401 || res.status === 403) {
            clearToken()
            setError('勤務時間を読むためのGoogle許可が切れています。もう一度Googleログインしてください。')
            return
          }
          if (!res.ok) return

          const data = await res.json() as {
            items?: { summary?: string; start?: { dateTime?: string; date?: string } }[]
          }
          loadedCalendarIds.add(member.calendarId)
          const eventsByDate: Record<string, TaskReportCalendarEvent[]> = {}
          ;(data.items || []).forEach((event) => {
            const dateText = event.start?.date
              || (event.start?.dateTime ? formatJapanDate(event.start.dateTime) : '')
            if (!dateText) return
            if (!eventsByDate[dateText]) eventsByDate[dateText] = []
            eventsByDate[dateText].push({ summary: event.summary || '', isAllDay: !!event.start?.date })
          })
          eventsByMember[member.calendarId] = eventsByDate
        } catch {
          eventsByMember[member.calendarId] = {}
        }
      }),
    )

    const nextWorkMinutesByDate: Record<string, Record<string, number>> = {}
    dateTexts.forEach((dateText) => {
      const dayMinutes: Record<string, number> = {}
      TEAM_MEMBER_OPTIONS.forEach((member) => {
        const events = eventsByMember[member.calendarId]?.[dateText] || []
        dayMinutes[member.name] = loadedCalendarIds.has(member.calendarId)
          ? getTaskReportWorkMinutes(member.name, events)
          : 0
      })
      nextWorkMinutesByDate[dateText] = dayMinutes
    })

    setWorkMinutesByDate((current) => ({
      ...current,
      ...nextWorkMinutesByDate,
    }))
  }, [])

  useEffect(() => {
    loadCategoryMasters()
  }, [loadCategoryMasters])

  useEffect(() => {
    if (!categoryMastersReady) return
    fetchReport()
  }, [categoryMastersReady, fetchReport])

  useEffect(() => {
    void fetchWorkMinutes(listMonth)
  }, [fetchWorkMinutes, listMonth])

  useEffect(() => {
    getTaskReportMonthKeys(startDate, endDate).forEach((month) => {
      void fetchWorkMinutes(month)
    })
  }, [endDate, fetchWorkMinutes, startDate])

  const memberNames = TEAM_MEMBER_OPTIONS.map((member) => member.name)
  const reportDateTexts = (() => {
    if (!startDate || !endDate || startDate > endDate) return []
    const dates: string[] = []
    const cursor = new Date(`${startDate}T00:00:00`)
    const limit = new Date(`${endDate}T00:00:00`)
    while (cursor <= limit) {
      dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)
      cursor.setDate(cursor.getDate() + 1)
    }
    return dates
  })()
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0)
  const perMember = TEAM_MEMBER_OPTIONS.map((member) => {
    const memberRows = rows.filter((row) => row.member_name === member.name)
    const minutes = memberRows.reduce((sum, row) => sum + row.minutes, 0)
    const workMinutes = reportDateTexts.reduce((sum, dateText) => sum + (workMinutesByDate[dateText]?.[member.name] || 0), 0)
    return {
      name: member.name,
      count: memberRows.length,
      minutes,
      workMinutes,
      averageMinutes: memberRows.length > 0 ? Math.round(minutes / memberRows.length) : 0,
      utilization: workMinutes > 0 ? Math.round((minutes / workMinutes) * 100) : null,
    }
  })
  const totalWorkMinutes = perMember.reduce((sum, member) => sum + member.workMinutes, 0)

  const summaryCards = [
    {
      name: 'WEBチーム全体',
      count: rows.length,
      minutes: totalMinutes,
      workMinutes: totalWorkMinutes,
      averageMinutes: rows.length > 0 ? Math.round(totalMinutes / rows.length) : 0,
      utilization: totalWorkMinutes > 0 ? Math.round((totalMinutes / totalWorkMinutes) * 100) : null,
      tone: 'total',
    },
    ...perMember.map((member, index) => ({
      ...member,
      tone: `member-${index}`,
    })),
  ]

  const createEmptyMemberMap = () =>
    Object.fromEntries(memberNames.map((name) => [name, 0])) as Record<string, number>

  const categoryMap = new Map<
    string,
    {
      totals: Omit<TaskReportCategorySummary, 'category' | 'detail' | 'isCategoryTotal'>
      details: Map<string, Omit<TaskReportCategorySummary, 'category' | 'detail' | 'isCategoryTotal'>>
    }
  >()

  rows.forEach((row) => {
    const category = row.category || classifyTaskReportName(row.task_name, categoryMasters).category
    const detail = row.task_name.trim() || 'タイトルなし'

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        totals: {
          memberCounts: createEmptyMemberMap(),
          memberMinutes: createEmptyMemberMap(),
          totalCount: 0,
          totalMinutes: 0,
          averageMinutes: 0,
        },
        details: new Map(),
      })
    }

    const categoryEntry = categoryMap.get(category)!

    if (!categoryEntry.details.has(detail)) {
      categoryEntry.details.set(detail, {
        memberCounts: createEmptyMemberMap(),
        memberMinutes: createEmptyMemberMap(),
        totalCount: 0,
        totalMinutes: 0,
        averageMinutes: 0,
      })
    }

    const totalTarget = categoryEntry.totals
    totalTarget.memberCounts[row.member_name] = (totalTarget.memberCounts[row.member_name] || 0) + 1
    totalTarget.memberMinutes[row.member_name] = (totalTarget.memberMinutes[row.member_name] || 0) + row.minutes
    totalTarget.totalCount += 1
    totalTarget.totalMinutes += row.minutes
    totalTarget.averageMinutes = totalTarget.totalCount > 0 ? Math.round(totalTarget.totalMinutes / totalTarget.totalCount) : 0

    const detailTarget = categoryEntry.details.get(detail)!
    detailTarget.memberCounts[row.member_name] = (detailTarget.memberCounts[row.member_name] || 0) + 1
    detailTarget.memberMinutes[row.member_name] = (detailTarget.memberMinutes[row.member_name] || 0) + row.minutes
    detailTarget.totalCount += 1
    detailTarget.totalMinutes += row.minutes
    detailTarget.averageMinutes = detailTarget.totalCount > 0 ? Math.round(detailTarget.totalMinutes / detailTarget.totalCount) : 0
  })

  const categorySections: Array<{
    category: string
    total: TaskReportCategorySummary
    details: TaskReportCategorySummary[]
  }> = []

  const categoryOrder = [
    ...categoryOptions,
    ...Array.from(categoryMap.keys()).filter((category) => !categoryOptions.includes(category)),
  ]

  categoryOrder.forEach((category) => {
    const categoryEntry = categoryMap.get(category)
    if (!categoryEntry) return

    categorySections.push({
      category,
      total: {
        category,
        detail: category,
        ...categoryEntry.totals,
        isCategoryTotal: true,
      },
      details: Array.from(categoryEntry.details.entries())
        .sort((a, b) => b[1].totalCount - a[1].totalCount || b[1].totalMinutes - a[1].totalMinutes)
        .map(([detail, summary]) => ({
          category,
          detail,
          ...summary,
          isCategoryTotal: false,
        })),
    })
  })

  const metricLabel = chartMetric === 'count' ? '件数' : '時間'
  const loadBalanceChartData = [...perMember]
    .sort((a, b) => {
      const diff = chartMetric === 'count' ? b.count - a.count : b.minutes - a.minutes
      if (diff !== 0) return diff
      return a.name.localeCompare(b.name, 'ja')
    })
    .map((member) => ({
      name: member.name,
      value: chartMetric === 'count' ? member.count : member.minutes,
    }))

  const categoryBreakdownChartData = TEAM_MEMBER_OPTIONS.map((member) => {
    const item: Record<string, string | number> = { name: member.name }
    categorySections.forEach((section) => {
      item[section.category] = chartMetric === 'count'
        ? section.total.memberCounts[member.name] || 0
        : section.total.memberMinutes[member.name] || 0
    })
    return item
  })

  const monthlyMap = new Map<string, { month: string; count: number; minutes: number }>()
  rows.forEach((row) => {
    const monthKey = row.event_date.slice(0, 7)
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, { month: monthKey.replace('-', '/'), count: 0, minutes: 0 })
    }
    const monthItem = monthlyMap.get(monthKey)!
    monthItem.count += 1
    monthItem.minutes += row.minutes
  })

  const monthlyTrendChartData = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
    .map(([, value]) => value)

  const monthOptions = Array.from(new Set([today.slice(0, 7), ...rows.map((row) => row.event_date.slice(0, 7))]))
    .sort((a, b) => b.localeCompare(a, 'ja'))

  const filteredRows = rows.filter((row) => row.event_date === listDate)
  const filteredRowMemberSummaries = TEAM_MEMBER_OPTIONS.map((member) => {
    const totalMinutes = filteredRows
      .filter((row) => row.member_name === member.name)
      .reduce((sum, row) => sum + row.minutes, 0)

    return {
      name: member.name,
      taskMinutes: totalMinutes,
      workMinutes: workMinutesByDate[listDate]?.[member.name] || 0,
    }
  })

  const getLastDateOfMonth = (month: string) => {
    const [year, monthNumber] = month.split('-').map(Number)
    return new Date(year, monthNumber, 0).getDate()
  }

  const moveListDate = (diff: number) => {
    const baseDate = new Date(`${listDate}T00:00:00`)
    baseDate.setDate(baseDate.getDate() + diff)
    const nextDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`
    const nextMonth = nextDate.slice(0, 7)
    setListMonth(nextMonth)
    setListDate(nextDate)
  }

  const toggleCategoryDetails = (category: string) => {
    setExpandedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    )
  }

  const updateRowCategory = async (rowId: string, sourceType: 'checked_events' | 'manual_tasks', sourceKey: string, eventDate: string, category: string) => {
    const previousRows = rows
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, category } : row))
    setSavingRowId(rowId)
    setError('')

    const { error: updateError } = sourceType === 'checked_events'
      ? await supabase.from('checked_events').update({ category }).eq('event_key', sourceKey).eq('event_date', eventDate)
      : await supabase.from('manual_tasks').update({ category }).eq('id', sourceKey)

    setSavingRowId('')
    if (updateError) {
      setRows(previousRows)
      setError(`カテゴリの保存に失敗しました: ${updateError.message}`)
    }
  }

  const startCreateCategory = () => {
    setCategoryDraft({ id: '', name: '', keywords: '' })
    setCategoryModalError('')
  }

  const startEditCategory = (category: TaskReportCategoryMaster) => {
    setCategoryDraft({
      id: category.id,
      name: category.name,
      keywords: category.keywords || '',
    })
    setCategoryModalError('')
  }

  const saveCategoryMaster = async () => {
    const name = categoryDraft.name.trim()
    const keywords = categoryDraft.keywords
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')

    if (!name) {
      setCategoryModalError('カテゴリ名を入れてください。')
      return
    }

    const duplicate = categoryMasters.find(
      (category) => category.id !== categoryDraft.id && category.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      setCategoryModalError('同じ名前のカテゴリがすでにあります。')
      return
    }

    const editingCategory = categoryMasters.find((category) => category.id === categoryDraft.id)
    const nextSortOrder = editingCategory?.sort_order
      ?? (categoryMasters.length > 0 ? Math.max(...categoryMasters.map((category) => category.sort_order || 0)) + 1 : 0)

    setCategoryModalSaving(true)
    setCategoryModalError('')

    const payload = {
      name,
      keywords,
      sort_order: nextSortOrder,
    }

    const { error: saveError } = categoryDraft.id
      ? await supabase.from('task_report_categories').update(payload).eq('id', categoryDraft.id)
      : await supabase.from('task_report_categories').insert(payload)

    if (saveError) {
      setCategoryModalSaving(false)
      setCategoryModalError(`カテゴリ設定の保存に失敗しました: ${saveError.message}`)
      return
    }

    if (editingCategory && editingCategory.name !== name) {
      const [checkedEventsRename, manualTasksRename] = await Promise.all([
        supabase.from('checked_events').update({ category: name }).eq('category', editingCategory.name),
        supabase.from('manual_tasks').update({ category: name }).eq('category', editingCategory.name),
      ])

      if (checkedEventsRename.error || manualTasksRename.error) {
        setCategoryModalSaving(false)
        setCategoryModalError(`カテゴリ名の反映に失敗しました: ${checkedEventsRename.error?.message || manualTasksRename.error?.message}`)
        return
      }
    }

    await loadCategoryMasters()
    await fetchReport()
    setCategoryDraft({ id: '', name: '', keywords: '' })
    setCategoryModalSaving(false)
  }

  return (
    <section className="task-report-page">
      <div className="panel task-report-hero">
        <div className="task-report-hero-top">
          <div className="task-report-title-block">
            <h2>WEBチームの業務棚卸し</h2>
            <p>期間を選択すると、実行した業務と時間をまとめて見られます。</p>
          </div>
          <div className="task-report-filter">
            <label>
              開始日
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              終了日
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <button className="primary" onClick={fetchReport} disabled={loading}>
              {loading ? '読み込み中...' : '集計する'}
            </button>
          </div>
        </div>
        {error && <p className="task-report-error">{error}</p>}
        <div className="task-report-member-grid">
          {summaryCards.map((member) => (
            <article key={member.name} className={`task-report-member-card ${member.tone}`}>
              <span>{member.name}</span>
              <strong>{member.count}件</strong>
              <p>
                仕事時間{' '}
                <b className={member.workMinutes > 0 && member.minutes > member.workMinutes ? 'task-report-alert-value' : undefined}>
                  {formatTaskReportTime(member.minutes)}
                </b>
              </p>
              <small>勤務時間 {formatTaskReportTime(member.workMinutes)}</small>
              <small>
                平均 {member.averageMinutes}分/件
                {member.utilization != null && (
                  <>
                    {' / 業務占有率 '}
                    <b className={member.utilization > 100 ? 'task-report-alert-value' : undefined}>
                      {member.utilization}%
                    </b>
                  </>
                )}
              </small>
            </article>
          ))}
        </div>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h2>カテゴリ別の集計表</h2>
            <p>下の一覧で選んだカテゴリを使って、担当ごとの件数と時間をまとめています。</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="compact-list-table task-report-matrix-table">
            <thead>
              <tr>
                <th>カテゴリ / 細分類業務</th>
                {TEAM_MEMBER_OPTIONS.map((member, index) => (
                  <Fragment key={`count-${member.name}`}>
                    <th className={`task-report-member-head member-${index}`}>件数: {member.name}</th>
                  </Fragment>
                ))}
                <th>件数: 合計</th>
                {TEAM_MEMBER_OPTIONS.map((member, index) => (
                  <Fragment key={`hours-${member.name}`}>
                    <th className={`task-report-member-head member-${index}`}>時間(h): {member.name}</th>
                  </Fragment>
                ))}
                <th>時間(h): 合計</th>
                <th>平均(分/件)</th>
              </tr>
            </thead>
            <tbody>
              {categorySections.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>
                    この期間のタスクはまだありません
                  </td>
                </tr>
              )}
              {categorySections.map((section) => {
                const isExpanded = expandedCategories.includes(section.category)
                const categoryTone = section.category === '分析・改善' ? 'analysis' : 'sns'
                return (
                  <Fragment key={section.category}>
                    <tr className={`task-report-category-row ${categoryTone} ${isExpanded ? 'expanded' : ''}`} onClick={() => toggleCategoryDetails(section.category)}>
                      <td className="task-report-sticky-label">
                        <button type="button" className="task-report-category-toggle">
                          <span className="task-report-category-icon">{isExpanded ? '−' : '+'}</span>
                          <span>{section.category}</span>
                        </button>
                      </td>
                      {TEAM_MEMBER_OPTIONS.map((member, index) => (
                        <td key={`${section.category}-count-${member.name}`} className={`member-${index}`}>
                          {section.total.memberCounts[member.name] > 0 ? section.total.memberCounts[member.name] : '-'}
                        </td>
                      ))}
                      <td>{section.total.totalCount}</td>
                      {TEAM_MEMBER_OPTIONS.map((member, index) => (
                        <td key={`${section.category}-minutes-${member.name}`} className={`member-${index}`}>
                          {section.total.memberMinutes[member.name] > 0 ? formatTaskReportHours(section.total.memberMinutes[member.name]) : '-'}
                        </td>
                      ))}
                      <td>{formatTaskReportHours(section.total.totalMinutes)}</td>
                      <td>{section.total.averageMinutes}</td>
                    </tr>
                    {isExpanded && section.details.map((row, rowIndex) => (
                      <tr key={`${row.category}-${row.detail}-${rowIndex}`} className={`task-report-detail-row ${categoryTone}`}>
                        <td className="task-report-detail-label">
                          <span className="task-report-detail-text" title={row.detail}>{row.detail}</span>
                        </td>
                        {TEAM_MEMBER_OPTIONS.map((member, index) => (
                          <td key={`${row.category}-${row.detail}-count-${member.name}`} className={`member-${index}`}>
                            {row.memberCounts[member.name] > 0 ? row.memberCounts[member.name] : '-'}
                          </td>
                        ))}
                        <td>{row.totalCount}</td>
                        {TEAM_MEMBER_OPTIONS.map((member, index) => (
                          <td key={`${row.category}-${row.detail}-minutes-${member.name}`} className={`member-${index}`}>
                            {row.memberMinutes[member.name] > 0 ? formatTaskReportHours(row.memberMinutes[member.name]) : '-'}
                          </td>
                        ))}
                        <td>{formatTaskReportHours(row.totalMinutes)}</td>
                        <td>{row.averageMinutes}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel task-report-chart-panel">
        <div className="panel-heading task-report-chart-heading">
          <div>
            <h2>業務量の見える化</h2>
            <p>件数と時間を切り替えながら、担当の偏りと月ごとの流れを見られます。</p>
          </div>
          <div className="task-report-chart-toggle" role="group" aria-label="グラフ表示切り替え">
            <button type="button" className={chartMetric === 'count' ? 'active' : ''} onClick={() => setChartMetric('count')}>件数で見る</button>
            <button type="button" className={chartMetric === 'minutes' ? 'active' : ''} onClick={() => setChartMetric('minutes')}>時間で見る</button>
          </div>
        </div>

        <div className="task-report-chart-grid">
          <article className="task-report-chart-card">
            <div className="task-report-chart-card-head">
              <h3>A｜メンバーの負荷バランス</h3>
              <p>{metricLabel}の多い順で並べています。</p>
            </div>
            <div className="task-report-chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={loadBalanceChartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(value) => formatTaskReportChartAxis(Number(value), chartMetric)} stroke="#64748b" />
                  <YAxis type="category" dataKey="name" width={64} stroke="#334155" />
                  <Tooltip
                    formatter={(value) => (
                      chartMetric === 'count' ? [`${Number(value || 0)}件`, '件数'] : [formatTaskReportTime(Number(value || 0)), '時間']
                    )}
                    labelFormatter={(label) => `担当: ${label}`}
                  />
                  <Bar dataKey="value" name={metricLabel} fill="#005AFF" radius={[0, 10, 10, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="task-report-chart-card">
            <div className="task-report-chart-card-head">
              <h3>B｜業務内訳の把握</h3>
              <p>Aの中身を色分けして、どの仕事が多いかを見やすくしています。</p>
            </div>
            <div className="task-report-chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBreakdownChartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(value) => formatTaskReportChartAxis(Number(value), chartMetric)} stroke="#64748b" />
                  <YAxis type="category" dataKey="name" width={64} stroke="#334155" />
                  <Tooltip
                    formatter={(value) => (
                      chartMetric === 'count' ? [`${Number(value || 0)}件`, metricLabel] : [formatTaskReportTime(Number(value || 0)), metricLabel]
                    )}
                  />
                  <Legend />
                  {categorySections.map((section, index) => (
                    <Bar
                      key={section.category}
                      dataKey={section.category}
                      stackId="task-report-categories"
                      name={section.category}
                      fill={TASK_REPORT_CHART_COLORS[index % TASK_REPORT_CHART_COLORS.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="task-report-chart-card wide">
            <div className="task-report-chart-card-head">
              <h3>C｜月ごとの推移</h3>
              <p>月ごとの合計で、忙しさの増え方や減り方を追いやすくしています。</p>
            </div>
            <div className="task-report-chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyTrendChartData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#64748b" />
                  <YAxis tickFormatter={(value) => formatTaskReportChartAxis(Number(value), chartMetric)} stroke="#64748b" />
                  <Tooltip
                    formatter={(value) => (
                      chartMetric === 'count' ? [`${Number(value || 0)}件`, '件数'] : [formatTaskReportTime(Number(value || 0)), '時間']
                    )}
                    labelFormatter={(label) => `${label}の合計`}
                  />
                  <Line
                    type="monotone"
                    dataKey={chartMetric === 'count' ? 'count' : 'minutes'}
                    name={metricLabel}
                    stroke="#005AFF"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#005AFF' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div className="task-report-list-heading">
            <div className="task-report-list-copy">
            <h2>元のタスク一覧</h2>
            <p>ここでカテゴリを手で直すと、上の集計表にも反映されます。</p>
            </div>
            <div className="task-report-day-summary">
              {filteredRowMemberSummaries.map((member, index) => (
                <div key={member.name} className={`task-report-day-summary-card member-${index}`}>
                  <span>{member.name}</span>
                  <strong className={member.taskMinutes > member.workMinutes ? 'task-report-alert-value' : undefined}>
                    {formatTaskReportTime(member.taskMinutes)}
                  </strong>
                  <small>勤務時間 {formatTaskReportTime(member.workMinutes)}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="task-report-list-controls">
            <label>
              月
              <select
                className="task-report-list-month"
                value={listMonth}
                onChange={(e) => {
                  const nextMonth = e.target.value
                  const currentDay = Number(listDate.slice(8, 10))
                  const lastDay = getLastDateOfMonth(nextMonth)
                  const nextDay = Math.min(currentDay, lastDay)
                  setListMonth(nextMonth)
                  setListDate(`${nextMonth}-${String(nextDay).padStart(2, '0')}`)
                }}
              >
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month.replace('-', '年')}月
                  </option>
                ))}
              </select>
            </label>
            <div className="task-report-list-day-nav">
              <button type="button" className="task-report-day-button" onClick={() => moveListDate(-1)} aria-label="前の日へ">◀</button>
              <span>{Number(listDate.slice(8, 10))}日</span>
              <button type="button" className="task-report-day-button" onClick={() => moveListDate(1)} aria-label="次の日へ">▶</button>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="compact-list-table task-report-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>担当</th>
                <th>
                  <div className="task-report-category-head">
                    <span>カテゴリ</span>
                    <button type="button" className="task-report-manage-button" onClick={() => setShowCategoryModal(true)}>
                      カテゴリ設定
                    </button>
                  </div>
                </th>
                <th>タスク名</th>
                <th>分数</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>
                    この日のタスクはまだありません
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.event_date}</td>
                  <td>{row.member_name}</td>
                  <td>
                    <select
                      className="task-report-category-select"
                      value={row.category}
                      onChange={(e) => updateRowCategory(row.id, row.source_type, row.source_key, row.event_date, e.target.value)}
                      disabled={savingRowId === row.id}
                    >
                      {categoryOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </td>
                  <td>{row.task_name}</td>
                  <td>{row.minutes}分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showCategoryModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCategoryModal(false) }}>
          <div className="modal-content task-report-category-modal">
            <div className="task-report-category-modal-header">
              <div>
                <h3>カテゴリ設定</h3>
                <p>カテゴリ名と、自動で振り分けるときの手がかりになる言葉を登録できます。</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowCategoryModal(false)}>✕</button>
            </div>

            <div className="task-report-category-modal-body">
              <div className="task-report-category-master-list">
                <div className="task-report-category-master-list-head">
                  <strong>登録ずみカテゴリ</strong>
                  <button type="button" className="secondary" onClick={startCreateCategory}>新しく作る</button>
                </div>
                {categoryModalLoading && <p className="empty-text">読み込み中です...</p>}
                {!categoryModalLoading && categoryMasters.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`task-report-category-master-item ${categoryDraft.id === category.id ? 'active' : ''}`}
                    onClick={() => startEditCategory(category)}
                  >
                    <strong>{category.name}</strong>
                    <span>
                      {category.keywords
                        ? `${category.keywords.split(/\r?\n/).filter(Boolean).length}個の手がかり`
                        : '手がかり未設定'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="task-report-category-editor">
                <label>
                  カテゴリ名
                  <input
                    type="text"
                    value={categoryDraft.name}
                    onChange={(e) => setCategoryDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="例：広告運用"
                  />
                </label>
                <label>
                  自動振り分けの手がかり
                  <textarea
                    value={categoryDraft.keywords}
                    onChange={(e) => setCategoryDraft((current) => ({ ...current, keywords: e.target.value }))}
                    rows={8}
                    placeholder={'1行に1つずつ入れてください\n例：\n投稿\n分析\n数値,入力'}
                  />
                </label>
                <p className="task-report-category-help">
                  1行の中に「,」を入れると、その言葉が両方入っているときだけそのカテゴリになります。
                </p>
                {categoryModalError && <p className="task-report-error">{categoryModalError}</p>}
                <div className="task-report-category-editor-actions">
                  <button type="button" className="secondary" onClick={startCreateCategory}>入力を空にする</button>
                  <button type="button" className="primary" onClick={saveCategoryMaster} disabled={categoryModalSaving}>
                    {categoryModalSaving ? '保存中...' : categoryDraft.id ? '上書き保存' : '追加する'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function TodayTasksPanel() {
  type ManualTask = {
    id: string
    event_date: string
    member_calendar_id: string
    task_name: string
    minutes: number | null
    category?: string | null
    checked: boolean
    created_at?: string
  }

  const [accessToken, setAccessToken] = useState<string | null>(getSavedToken)
  const [memberEvents, setMemberEvents] = useState<Record<string, CalendarEvent[]>>({})
  const [manualTasks, setManualTasks] = useState<Record<string, ManualTask[]>>({})
  const [checkedEvents, setCheckedEvents] = useState<Record<string, boolean>>({})
  const [minutesMap, setMinutesMap] = useState<Record<string, number>>({})
  const [minutePopup, setMinutePopup] = useState<{
    mode: 'calendar' | 'manual'
    key: string
    summary: string
    memberCalendarId: string
    manualTaskId?: string
  } | null>(null)
  const [minuteInput, setMinuteInput] = useState('')
  const [minuteCategory, setMinuteCategory] = useState('')
  const [openAddFormMemberId, setOpenAddFormMemberId] = useState<string | null>(null)
  const [newTaskName, setNewTaskName] = useState('')
  const [newTaskMinutes, setNewTaskMinutes] = useState('')
  const [manualTaskSaving, setManualTaskSaving] = useState(false)
  const [openMemoMemberId, setOpenMemoMemberId] = useState<string | null>(null)
  const [memoDraft, setMemoDraft] = useState('')
  const [memoSavingMemberId, setMemoSavingMemberId] = useState<string | null>(null)
  const [memoError, setMemoError] = useState('')
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [categoryMasters, setCategoryMasters] = useState<TaskReportCategoryMaster[]>([...DEFAULT_TASK_REPORT_CATEGORIES])
  const today = new Date().toISOString().slice(0, 10)
  const [selectedViewDate, setSelectedViewDate] = useState(today)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silentLoginFnRef = useRef<(() => void) | null>(null)
  const pendingCheckKeysRef = useRef<Set<string>>(new Set())
  const categoryOptions = getTaskReportCategoryOptions(categoryMasters)

  const normalizeNumberText = (value: string) => value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  const formatSelectedDateLabel = (dateText: string) => new Date(`${dateText}T00:00:00`).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const moveSelectedDate = (diff: number) => {
    const baseDate = new Date(`${selectedViewDate}T00:00:00`)
    baseDate.setDate(baseDate.getDate() + diff)
    const nextDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`
    setSelectedViewDate(nextDate)
  }

  const resolveTaskCategory = useCallback((taskName: string, currentCategory?: string | null) => {
    if (currentCategory?.trim()) return currentCategory
    return classifyTaskReportName(taskName, categoryMasters).category
  }, [categoryMasters])

  const closeMinutePopup = useCallback(() => {
    setMinutePopup(null)
    setMinuteInput('')
    setMinuteCategory('')
  }, [])

  useEffect(() => {
    const loadCategoryMasters = async () => {
      const { data, error } = await supabase
        .from('task_report_categories')
        .select('id, name, keywords, sort_order, created_at')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        setCategoryMasters([...DEFAULT_TASK_REPORT_CATEGORIES])
        return
      }

      const nextCategories = (data && data.length > 0 ? data : [...DEFAULT_TASK_REPORT_CATEGORIES]) as TaskReportCategoryMaster[]
      setCategoryMasters(sortTaskReportCategories(nextCategories))
    }

    loadCategoryMasters()
  }, [])

  // Supabaseから選択中の日付のチェック状態と手動追加業務を読み込む（3秒ごとにポーリングして他PCと同期）
  useEffect(() => {
    const fetchSelectedDateState = async () => {
      const [checkedResult, manualResult] = await Promise.all([
        supabase
          .from('checked_events')
          .select('event_key, minutes, category')
          .eq('event_date', selectedViewDate),
        supabase
          .from('manual_tasks')
          .select('id, event_date, member_calendar_id, task_name, minutes, checked, category, created_at')
          .eq('event_date', selectedViewDate)
          .order('created_at', { ascending: true }),
      ])

      if (checkedResult.data) {
        const fetchedChecked: Record<string, boolean> = {}
        const fetchedMinutes: Record<string, number> = {}
        checkedResult.data.forEach((row: { event_key: string; minutes: number | null }) => {
          fetchedChecked[row.event_key] = true
          if (row.minutes != null) fetchedMinutes[row.event_key] = row.minutes
        })

        setCheckedEvents((prev) => {
          const next = { ...fetchedChecked }
          pendingCheckKeysRef.current.forEach((key) => {
            if (prev[key]) next[key] = true
            else delete next[key]
          })
          return next
        })

        setMinutesMap((prev) => {
          const next = { ...fetchedMinutes }
          pendingCheckKeysRef.current.forEach((key) => {
            if (prev[key] != null) next[key] = prev[key]
            else delete next[key]
          })
          return next
        })
      }

      if (manualResult.data) {
        const grouped: Record<string, ManualTask[]> = {}
        manualResult.data.forEach((task: ManualTask) => {
          if (!grouped[task.member_calendar_id]) grouped[task.member_calendar_id] = []
          grouped[task.member_calendar_id].push(task)
        })
        setManualTasks(grouped)
      }
    }

    fetchSelectedDateState()
    const interval = setInterval(fetchSelectedDateState, 3000)
    return () => clearInterval(interval)
  }, [selectedViewDate])

  useEffect(() => {
    setOpenAddFormMemberId(null)
    setOpenMemoMemberId(null)
    closeMinutePopup()
    setNewTaskName('')
    setNewTaskMinutes('')
    setMemoDraft('')
    setMemoError('')
  }, [closeMinutePopup, selectedViewDate])

  // タイマークリーンアップ
  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current) }
  }, [])

  // トークン有効期限の3分前にsetAccessToken(null)して「再接続」ボタンを表示する
  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const ms = Math.max(0, (expiresIn - 180) * 1000)
    refreshTimerRef.current = setTimeout(() => {
      setAccessToken(null)
    }, ms)
  }, [])

  const toggleCalendarCheck = async (key: string, checked: boolean, summary: string, memberCalendarId: string) => {
    if (checked) {
      pendingCheckKeysRef.current.add(key)
      setCheckedEvents(prev => { const n = { ...prev }; delete n[key]; return n })
      setMinutesMap(prev => { const n = { ...prev }; delete n[key]; return n })
      const { error } = await supabase
        .from('checked_events')
        .delete()
        .eq('event_key', key)
        .eq('event_date', selectedViewDate)
      pendingCheckKeysRef.current.delete(key)
      if (error) {
        setCheckedEvents(prev => ({ ...prev, [key]: true }))
      }
      return
    }

    setMinutePopup({ mode: 'calendar', key, summary, memberCalendarId })
    setMinuteInput('')
    setMinuteCategory(resolveTaskCategory(summary))
  }

  const confirmMinutes = async () => {
    if (!minutePopup) return
    const { key, summary, memberCalendarId, mode, manualTaskId } = minutePopup
    const normalized = normalizeNumberText(minuteInput)
    const parsed = parseInt(normalized, 10)
    const memberName = MEMBER_NAME_BY_CALENDAR_ID[memberCalendarId] || '未設定'

    if (mode === 'manual' && manualTaskId) {
      const minutes = Number.isNaN(parsed) ? null : parsed
      const beforeTasks = manualTasks[memberCalendarId] || []

      setManualTasks(prev => ({
        ...prev,
        [memberCalendarId]: (prev[memberCalendarId] || []).map((item) =>
          item.id === manualTaskId ? { ...item, checked: true, minutes, category: minuteCategory } : item
        ),
      }))
      closeMinutePopup()

      const { error } = await supabase
        .from('manual_tasks')
        .update({ checked: true, minutes, category: minuteCategory })
        .eq('id', manualTaskId)

      if (error) {
        setManualTasks(prev => ({
          ...prev,
          [memberCalendarId]: beforeTasks,
        }))
      }
      return
    }

    const minsValue = Number.isNaN(parsed) ? 0 : parsed

    pendingCheckKeysRef.current.add(key)
    setCheckedEvents(prev => ({ ...prev, [key]: true }))
    setMinutesMap(prev => ({ ...prev, [key]: minsValue }))
    closeMinutePopup()

    const { error } = await supabase.from('checked_events').upsert({
      event_key: key,
      event_date: selectedViewDate,
      minutes: minsValue,
      task_name: summary,
      member_calendar_id: memberCalendarId,
      member_name: memberName,
      category: minuteCategory,
    })

    pendingCheckKeysRef.current.delete(key)
    if (error) {
      setCheckedEvents(prev => { const n = { ...prev }; delete n[key]; return n })
      setMinutesMap(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  const toggleManualTaskCheck = async (task: ManualTask) => {
    const beforeTasks = manualTasks[task.member_calendar_id] || []
    const nextChecked = !task.checked

    if (nextChecked) {
      setMinutePopup({
        mode: 'manual',
        key: `manual:${task.id}`,
        summary: task.task_name,
        memberCalendarId: task.member_calendar_id,
        manualTaskId: task.id,
      })
      setMinuteInput(task.minutes != null ? String(task.minutes) : '')
      setMinuteCategory(resolveTaskCategory(task.task_name, task.category))
      return
    }

    setManualTasks(prev => ({
      ...prev,
      [task.member_calendar_id]: (prev[task.member_calendar_id] || []).map((item) =>
        item.id === task.id ? { ...item, checked: nextChecked, minutes: null } : item
      ),
    }))

    const { error } = await supabase
      .from('manual_tasks')
      .update({ checked: nextChecked, minutes: null })
      .eq('id', task.id)

    if (error) {
      setManualTasks(prev => ({
        ...prev,
        [task.member_calendar_id]: beforeTasks,
      }))
    }
  }

  const addManualTask = async (memberCalendarId: string) => {
    const taskName = newTaskName.trim()
    if (!taskName) return

    setManualTaskSaving(true)
    const normalized = normalizeNumberText(newTaskMinutes)
    const parsed = parseInt(normalized, 10)
    const minutes = Number.isNaN(parsed) ? null : parsed

    const { data, error } = await supabase
      .from('manual_tasks')
      .insert({
        event_date: selectedViewDate,
        member_calendar_id: memberCalendarId,
        task_name: taskName,
        minutes,
        category: resolveTaskCategory(taskName),
        checked: false,
      })
      .select('id, event_date, member_calendar_id, task_name, minutes, checked, category, created_at')
      .single()

    setManualTaskSaving(false)
    if (error || !data) return

    setManualTasks(prev => ({
      ...prev,
      [memberCalendarId]: [...(prev[memberCalendarId] || []), data as ManualTask],
    }))
    setNewTaskName('')
    setNewTaskMinutes('')
    setOpenAddFormMemberId(null)
  }

  const sendTodayMemo = async (memberName: string) => {
    const memo = memoDraft.trim()
    if (!memo || memoSavingMemberId) return

    setMemoSavingMemberId(memberName)
    setMemoError('')
    try {
      const notifySecret = import.meta.env.VITE_NOTIFY_SECRET as string | undefined
      const response = await fetch('/api/notify-today-memo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(notifySecret ? { 'x-notify-secret': notifySecret } : {}),
        },
        body: JSON.stringify({ memberName, memo }),
      })
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Slack送信に失敗しました')
      }

      setOpenMemoMemberId(null)
      setMemoDraft('')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'invalid_auth') {
        setMemoError('Slackの接続キーが無効です。')
      } else if (message === 'channel_not_found') {
        setMemoError('Slackのチャンネルが見つかりません。')
      } else if (message === 'not_in_channel') {
        setMemoError('Slackアプリがチャンネルに入っていません。')
      } else {
        setMemoError('Slack送信に失敗しました')
      }
    } finally {
      setMemoSavingMemberId(null)
    }
  }

  const deleteManualTask = async (task: ManualTask) => {
    const beforeTasks = manualTasks[task.member_calendar_id] || []

    setManualTasks(prev => ({
      ...prev,
      [task.member_calendar_id]: (prev[task.member_calendar_id] || []).filter((item) => item.id !== task.id),
    }))

    const { error } = await supabase
      .from('manual_tasks')
      .delete()
      .eq('id', task.id)

    if (error) {
      setManualTasks(prev => ({
        ...prev,
        [task.member_calendar_id]: beforeTasks,
      }))
    }
  }

  const fetchMemberEvents = useCallback(async (token: string, targetDate: string) => {
    setCalendarLoading(true)
    const baseDate = new Date(`${targetDate}T00:00:00`)
    const timeMin = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).toISOString()
    const timeMax = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59).toISOString()
    const results: Record<string, CalendarEvent[]> = {}
    await Promise.all(
      TEAM_MEMBERS.map(async (member) => {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(member.calendarId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (res.status === 401 || res.status === 403) {
            clearToken()
            setAccessToken(null)
            setCalendarLoading(false)
            return
          }
          const data = await res.json()
          results[member.calendarId] = (data.items || []).map((e: any) => ({
            id: e.id,
            summary: e.summary || '（タイトルなし）',
            start: e.start?.dateTime || e.start?.date || '',
          }))
        } catch {
          results[member.calendarId] = []
        }
      })
    )
    setMemberEvents(results)
    setCalendarLoading(false)
  }, [])

  // 保存済みトークンがあれば起動時に自動取得＆リフレッシュタイマーセット
  useEffect(() => {
    const saved = getSavedToken()
    if (saved) {
      fetchMemberEvents(saved, selectedViewDate)
      try {
        const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY)
        if (expiry) {
          const remaining = (Number(expiry) - Date.now()) / 1000
          scheduleRefresh(remaining)
        }
      } catch { /* ignore */ }
    }
  }, [fetchMemberEvents, scheduleRefresh, selectedViewDate])

  // prompt:none でGoogleUIを出さずに無音再認証
  const silentLogin = useGoogleLogin({
    scope: GOOGLE_CALENDAR_SCOPE,
    prompt: 'none',
    onSuccess: (res) => {
      const expiresIn = res.expires_in ?? 3600
      saveToken(res.access_token, expiresIn)
      setAccessToken(res.access_token)
      fetchMemberEvents(res.access_token, selectedViewDate)
      scheduleRefresh(expiresIn)
    },
    onError: () => {
      clearToken()
      setAccessToken(null)
    },
  })

  silentLoginFnRef.current = silentLogin

  const googleLogin = useGoogleLogin({
    scope: GOOGLE_CALENDAR_SCOPE,
    onSuccess: async (res) => {
      const expiresIn = res.expires_in ?? 3600
      saveToken(res.access_token, expiresIn)
      setAccessToken(res.access_token)
      fetchMemberEvents(res.access_token, selectedViewDate)
      scheduleRefresh(expiresIn)
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${res.access_token}` } })
        const userInfo = await userRes.json()
        if (userInfo.email) localStorage.setItem('gcal_hint', userInfo.email)
      } catch { /* ignore */ }
    },
  })

  useEffect(() => {
    if (accessToken) fetchMemberEvents(accessToken, selectedViewDate)
  }, [accessToken, fetchMemberEvents, selectedViewDate])

  return (
    <div className="panel">
      {minutePopup && (
        <div className="minute-popup-overlay" onClick={closeMinutePopup}>
          <div className="minute-popup" onClick={e => e.stopPropagation()}>
            <p>所要時間を入力</p>
            <div className="minute-input-row">
              <input
                type="text"
                inputMode="numeric"
                className="minute-input"
                value={minuteInput}
                onChange={e => setMinuteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmMinutes() }}
                autoFocus
                placeholder="例：30"
              />
              <span className="minute-unit">分</span>
            </div>
            <label className="minute-category-field">
              <span>カテゴリ</span>
              <select
                className="minute-category-select"
                value={minuteCategory}
                onChange={(e) => setMinuteCategory(e.target.value)}
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <div className="minute-popup-buttons">
              <button className="primary" onClick={confirmMinutes}>確定</button>
              <button className="secondary" onClick={closeMinutePopup}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
      <div className="panel-heading">
        <div>
          <h2>{selectedViewDate === today ? '今日の業務一覧' : '業務一覧'}</h2>
          <p>{formatSelectedDateLabel(selectedViewDate)}</p>
        </div>
        <div className="today-task-toolbar">
          <div className="today-task-date-nav">
            <button type="button" className="today-task-day-button" onClick={() => moveSelectedDate(-1)} aria-label="前日">
              ◀
            </button>
            <input
              type="date"
              className="today-task-date-input"
              value={selectedViewDate}
              onChange={(e) => setSelectedViewDate(e.target.value)}
            />
            <button type="button" className="today-task-day-button" onClick={() => moveSelectedDate(1)} aria-label="翌日">
              ▶
            </button>
          </div>
          <button type="button" className="secondary today-task-reset-button" onClick={() => setSelectedViewDate(today)} disabled={selectedViewDate === today}>
            今日に戻す
          </button>
          {!accessToken
            ? <button className="primary" onClick={() => googleLogin()}>Googleでログイン</button>
            : <button className="secondary" onClick={() => fetchMemberEvents(accessToken, selectedViewDate)}>再読み込み</button>
          }
        </div>
      </div>

      {calendarLoading && (
        <div className="calendar-login-prompt"><p>読み込み中...</p></div>
      )}

      {accessToken && !calendarLoading && (
        <div className="today-tasks-grid">
          {TEAM_MEMBERS.filter(m => m.name !== 'WEBチーム').map((member) => {
            const events = memberEvents[member.calendarId] || []
            const manualMemberTasks = manualTasks[member.calendarId] || []
            const totalCount = events.length + manualMemberTasks.length
            return (
              <div key={member.calendarId} className="member-task-card">
                <div className="member-task-header" style={{ borderLeft: `4px solid ${member.color}` }}>
                  <span className="member-name">{member.name}</span>
                  <span className="member-event-count">{totalCount}件</span>
                </div>
                <button
                  type="button"
                  className="today-memo-btn"
                  onClick={() => {
                    const nextOpenMemberId = openMemoMemberId === member.calendarId ? null : member.calendarId
                    setOpenMemoMemberId(nextOpenMemberId)
                    setOpenAddFormMemberId(null)
                    setMemoDraft('')
                    setMemoError('')
                  }}
                >
                  メモ
                </button>
                {openMemoMemberId === member.calendarId && (
                  <div className="today-memo-form">
                    <textarea
                      className="today-memo-textarea"
                      value={memoDraft}
                      onChange={(e) => setMemoDraft(e.target.value)}
                      placeholder="メモを入力"
                      rows={4}
                    />
                    {memoError && <p className="today-memo-error">{memoError}</p>}
                    <div className="today-memo-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setOpenMemoMemberId(null)
                          setMemoDraft('')
                          setMemoError('')
                        }}
                        disabled={memoSavingMemberId === member.name}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => sendTodayMemo(member.name)}
                        disabled={!memoDraft.trim() || memoSavingMemberId === member.name}
                      >
                        {memoSavingMemberId === member.name ? '送信中...' : '保存'}
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="manual-task-add-btn"
                  onClick={() => {
                    setOpenAddFormMemberId(openAddFormMemberId === member.calendarId ? null : member.calendarId)
                    setOpenMemoMemberId(null)
                    setNewTaskName('')
                    setNewTaskMinutes('')
                    setMemoError('')
                  }}
                >
                  ＋ 業務を追加
                </button>
                {openAddFormMemberId === member.calendarId && (
                  <div className="manual-task-form">
                    <input
                      type="text"
                      className="manual-task-input"
                      value={newTaskName}
                      onChange={(e) => setNewTaskName(e.target.value)}
                      placeholder="業務名を入力"
                    />
                    <button
                      type="button"
                      className="primary"
                      onClick={() => addManualTask(member.calendarId)}
                      disabled={manualTaskSaving}
                    >
                      {manualTaskSaving ? '保存中...' : '追加'}
                    </button>
                  </div>
                )}
                {totalCount === 0 ? (
                  <p className="no-events">予定なし</p>
                ) : (
                  <ul className="event-checklist">
                    {manualMemberTasks.map((task) => (
                      <li
                        key={task.id}
                        className={`event-item manual-task ${task.checked ? 'checked' : ''}`}
                        onClick={() => toggleManualTaskCheck(task)}
                      >
                        <span className="event-checkbox">{task.checked ? '✓' : ''}</span>
                        <span className="event-time">追加</span>
                        {task.minutes != null && <span className="event-minutes">{task.minutes}分</span>}
                        <span className="event-title" title={task.task_name}>{task.task_name}</span>
                        <button
                          type="button"
                          className="manual-task-delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteManualTask(task)
                          }}
                        >
                          削除
                        </button>
                      </li>
                    ))}
                    {events.map((ev) => {
                      const key = `${member.calendarId}:${ev.id}`
                      const checked = !!checkedEvents[key]
                      const time = ev.start.includes('T')
                        ? new Date(ev.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                        : '終日'
                      return (
                        <li
                          key={ev.id}
                          className={`event-item ${checked ? 'checked' : ''}`}
                          onClick={() => toggleCalendarCheck(key, checked, ev.summary, member.calendarId)}
                        >
                          <span className="event-checkbox">{checked ? '✓' : ''}</span>
                          <span className="event-time">{time}</span>
                          {checked && minutesMap[key] != null && (
                            <span className="event-minutes">{minutesMap[key]}分</span>
                          )}
                          <span className="event-title" title={ev.summary}>{ev.summary}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

function getYear(dateString: string) {
  if (!dateString) return 0
  return new Date(dateString).getFullYear()
}

function matchesYearMonth(dateString: string, year: number, month: string) {
  if (!dateString) return false
  const date = new Date(dateString)
  const matchesYear = date.getFullYear() === year
  const matchesMonth = month === 'all' || date.getMonth() + 1 === Number(month)
  return matchesYear && matchesMonth
}


/** 案件1件の削減額貢献額を返す
 *  - 単発: 完了 & dueDate が選択期間内のみ計上
 *  - 継続: taskDate から完了日(or今日)まで月×金額で累積。完了月が最終月 */
function calcTaskSavings(task: Task, selectedYear: number, selectedMonth: string): number {
  if (!task.savings || task.savings <= 0) return 0

  if (task.taskType === '単発') {
    return task.status === '完了' && matchesYearMonth(task.dueDate, selectedYear, selectedMonth)
      ? task.savings : 0
  }

  // ===== 継続 =====
  if (!task.taskDate) return 0
  const s = new Date(task.taskDate)
  const startYM = new Date(s.getFullYear(), s.getMonth(), 1)
  const e = task.status === '完了' && task.dueDate ? new Date(task.dueDate) : new Date()
  const endYM = new Date(e.getFullYear(), e.getMonth(), 1)

  if (selectedMonth === 'all') {
    // 選択年内でアクティブだった月数 × 月額
    const yearStart = new Date(selectedYear, 0, 1)
    const yearEnd   = new Date(selectedYear, 11, 1)
    const from = startYM > yearStart ? startYM : yearStart
    const to   = endYM   < yearEnd   ? endYM   : yearEnd
    if (from > to) return 0
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
    return task.savings * Math.max(0, months)
  }

  // 特定月: その月にアクティブか判定
  const selYM = new Date(selectedYear, Number(selectedMonth) - 1, 1)
  if (startYM > selYM || endYM < selYM) return 0
  return task.savings
}

function normalizeTask(task: Omit<Task, 'id'>): Omit<Task, 'id'> {
  return { ...task, savings: Number(task.savings) || 0 }
}

function normalizePost(post: Omit<SnsPost, 'id'>): Omit<SnsPost, 'id'> {
  return {
    ...post,
    comments: Number(post.comments) || 0,
    saves: Number(post.saves) || 0,
  }
}

function normalizeRecruitment(record: Omit<RecruitmentRecord, 'id'>): Omit<RecruitmentRecord, 'id'> {
  return {
    ...record,
    costReduction: Number(record.costReduction) || 0,
  }
}

export default App
