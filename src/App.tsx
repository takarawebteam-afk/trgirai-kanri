import { useEffect, useState, useCallback } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { supabase } from './supabase'

type Department = '人事' | '総務' | '仲介' | '管理' | '売買' | '本社' | 'その他'
type TaskType = '単発' | '継続'
type TaskStatus = '未実施' | '作業中' | '完了'
type Priority = '高' | '中' | '低'
type SnsPlatform = 'TikTok' | 'Instagram' | 'Threads' | 'YouTube'
type RecruitDepartment = '仲介' | '管理' | '売買' | 'ビバ' | '経理' | '総務' | 'その他'
type JobType = '正社員' | 'パート'
type TaskItemStatus = '未着手' | '進行中' | '完了'
type PageKey = 'dashboard' | 'tasks' | 'sns' | 'recruitment' | 'taskmanagement' | 'members' | 'hankyo'

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
  created_at?: string
  updated_at?: string
}

type TaskItem = {
  id: string
  created_at?: string
  date: string
  name: string
  detail: string
  priority: Priority
  due_date: string
  assignees: string[]
  creator: string
  status: TaskItemStatus
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

const TEAM_MEMBERS = [
  { name: '新居', calendarId: 'trg.yshini@gmail.com', color: '#374151' },
  { name: '泉', calendarId: 'izumiyurina2322@gmail.com', color: '#7c3aed' },
  { name: '坂本', calendarId: 'takarabaito3@gmail.com', color: '#1d4ed8' },
  { name: '吉田', calendarId: 'takarabaito1@gmail.com', color: '#db2777' },
  { name: 'WEBチーム', calendarId: 'takara.webteam@gmail.com', color: '#0ea5e9' },
]

type CalendarEvent = { id: string; summary: string; start: string }

const departments: Department[] = ['人事', '総務', '仲介', '管理', '売買', '本社', 'その他']
const taskTypes: TaskType[] = ['単発', '継続']
const taskStatuses: TaskStatus[] = ['未実施', '作業中', '完了']
const taskItemStatuses: TaskItemStatus[] = ['未着手', '進行中', '完了']
const priorityOptions: Priority[] = ['高', '中', '低']
const assigneeOptions = ['泉', '坂本', '吉田', '新居']

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
  detail: '',
  priority: '中',
  due_date: '',
  assignees: [],
  creator: '',
  status: '未着手',
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
  account: 'Karilun',
  trigger: '検索',
  media: 'Karilun',
  inquiry_type: '物件問合',
  customer_name: '',
  contact_method: 'LINE',
  move_in_timing: '不明',
  store: '対象外',
  area: '',
  note: '',
}

const HANKYO_PAGE_SIZE = 20

const currency = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const integer = new Intl.NumberFormat('ja-JP')

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const [tasks, setTasks] = useState<Task[]>([])
  const [posts, setPosts] = useState<SnsPost[]>([])
  const [recruitment, setRecruitment] = useState<RecruitmentRecord[]>([])
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState('all')

  // 新規追加フォーム
  const [taskForm, setTaskForm] = useState(defaultTaskForm)
  const [snsForm, setSnsForm] = useState(defaultSnsForm)
  const [recruitmentForm, setRecruitmentForm] = useState(defaultRecruitmentForm)

  // インライン編集
  const [taskInlineId, setTaskInlineId] = useState<string | null>(null)
  const [taskInlineForm, setTaskInlineForm] = useState<Omit<Task, 'id'>>(defaultTaskForm)
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
  const [taskFilter, setTaskFilter] = useState<'all' | '未着手' | '自分' | '期限切れ'>('all')
  const [myName, setMyName] = useState(() => localStorage.getItem('myName') || '')
  const [taskError, setTaskError] = useState<string | null>(null)
  const [memberEditId, setMemberEditId] = useState<string | null>(null)
  const [memberEditSlack, setMemberEditSlack] = useState('')

  // 反響管理
  const [hankyoRecords, setHankyoRecords] = useState<HankyoRecord[]>([])
  const [hankyoForm, setHankyoForm] = useState(defaultHankyoForm)
  const [hankyoInlineId, setHankyoInlineId] = useState<string | null>(null)
  const [hankyoInlineForm, setHankyoInlineForm] = useState<Omit<HankyoRecord, 'id' | 'created_at' | 'updated_at'>>(defaultHankyoForm)
  const [hankyoSearch, setHankyoSearch] = useState('')
  const [hankyoMonthFilter, setHankyoMonthFilter] = useState('all')
  const [hankyoMediaFilter, setHankyoMediaFilter] = useState('all')
  const [hankyoStoreFilter, setHankyoStoreFilter] = useState('all')
  const [hankyoPage, setHankyoPage] = useState(1)
  const [showModal, setShowModal] = useState(false)

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

  async function fetchTaskItems() {
    const { data } = await supabase.from('task_items').select('*').order('created_at', { ascending: false })
    if (data) setTaskItems(data as TaskItem[])
  }

  async function fetchMembers() {
    const { data } = await supabase.from('members').select('*').order('created_at')
    if (data) setMembers(data as Member[])
  }

  async function fetchHankyo() {
    const { data } = await supabase.from('hankyo').select('*').order('inquiry_date', { ascending: false }).order('created_at', { ascending: false })
    if (data) setHankyoRecords(data as HankyoRecord[])
  }

  useEffect(() => {
    fetchTasks()
    fetchPosts()
    fetchRecruitment()
    fetchTaskItems()
    fetchMembers()
    fetchHankyo()

    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sns_posts' }, fetchPosts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recruitment' }, fetchRecruitment)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

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

  const filteredCompletedTasks = tasks.filter(
    (task) => task.status === '完了' && matchesYearMonth(task.dueDate, selectedYear, selectedMonth),
  )
  const filteredPosts = posts.filter((post) =>
    matchesYearMonth(post.postDate, selectedYear, selectedMonth),
  )
  const filteredRecruitment = recruitment.filter((record) =>
    matchesYearMonth(record.date, selectedYear, selectedMonth),
  )
  const ongoingTasks = tasks.filter((task) => {
    if (task.status !== '作業中') return false
    return matchesYearMonth(task.dueDate, selectedYear, selectedMonth)
  })

  const totalSavings = filteredCompletedTasks.reduce((sum, task) => sum + task.savings, 0)
  const departmentSavings = departments
    .map((department) => ({
      department,
      savings: filteredCompletedTasks
        .filter((task) => task.department === department)
        .reduce((sum, task) => sum + task.savings, 0),
    }))
    .filter((entry) => entry.savings > 0)

  const snsAccountMetrics = Object.values(
    filteredPosts.reduce<Record<string, { account: string; posts: number }>>(
      (acc, post) => {
        if (!acc[post.account]) {
          acc[post.account] = { account: post.account, posts: 0 }
        }
        acc[post.account].posts += 1
        return acc
      },
      {},
    ),
  )

  const recruitmentByDepartment = Object.values(
    filteredRecruitment.reduce<Record<string, { department: string; count: number; costReduction: number }>>(
      (acc, record) => {
        if (!acc[record.department]) {
          acc[record.department] = { department: record.department, count: 0, costReduction: 0 }
        }
        acc[record.department].count += 1
        acc[record.department].costReduction += record.costReduction
        return acc
      },
      {},
    ),
  )

  const recruitmentSummary = filteredRecruitment.reduce(
    (acc, record) => {
      acc.costReduction += record.costReduction
      return acc
    },
    { costReduction: 0 },
  )

  // タスク管理 計算
  const today = new Date().toISOString().split('T')[0]
  const filteredTaskItems = taskItems
    .filter((item) => {
      if (taskSearch && !item.name.includes(taskSearch)) return false
      if (taskFilter === '未着手' && item.status !== '未着手') return false
      if (taskFilter === '自分' && myName && !item.assignees.includes(myName)) return false
      if (taskFilter === '期限切れ') {
        if (!item.due_date || item.status === '完了') return false
        return item.due_date < today
      }
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

  // 新規追加ハンドラ
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
    const id = crypto.randomUUID()
    const { error } = await supabase.from('task_items').insert({ ...taskItemForm, id })
    if (error) { setTaskError(`追加失敗: ${error.message}`); return }
    // Slack通知
    try {
      await fetch('/api/notify-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'new', taskName: taskItemForm.name, dueDate: taskItemForm.due_date, priority: taskItemForm.priority, assignees: taskItemForm.assignees, members }),
      })
    } catch { /* Slack未設定時は無視 */ }
    setTaskItemForm({ ...defaultTaskItemForm, date: new Date().toISOString().split('T')[0] })
    fetchTaskItems()
    setShowModal(false)
  }

  const updateTaskItemStatus = async (id: string, status: TaskItemStatus) => {
    await supabase.from('task_items').update({ status }).eq('id', id)
    if (status === '完了') {
      const item = taskItems.find((t) => t.id === id)
      if (item && !item.completed_notified) {
        await supabase.from('task_items').update({ completed_notified: true }).eq('id', id)
        try {
          await fetch('/api/notify-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'completed', taskName: item.name, assignees: item.assignees, members }),
          })
        } catch { /* ignore */ }
      }
    }
    fetchTaskItems()
  }

  const saveTaskItemInline = async () => {
    if (!taskItemInlineId) return
    await supabase.from('task_items').update(taskItemInlineForm).eq('id', taskItemInlineId)
    setTaskItemInlineId(null)
    fetchTaskItems()
  }

  const saveMemberSlack = async (id: string) => {
    await supabase.from('members').update({ slack_user_id: memberEditSlack }).eq('id', id)
    setMemberEditId(null)
    fetchMembers()
  }

  // 反響管理ハンドラー
  const handleHankyoSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('hankyo').insert({ ...hankyoForm, id: crypto.randomUUID() })
    setHankyoForm({ ...defaultHankyoForm, inquiry_date: new Date().toISOString().split('T')[0] })
    setHankyoPage(1)
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

  // 反響管理 フィルタリング & ページネーション
  const filteredHankyo = hankyoRecords.filter((r) => {
    if (hankyoSearch && !r.customer_name.includes(hankyoSearch)) return false
    if (hankyoMonthFilter !== 'all' && r.inquiry_date) {
      const m = new Date(r.inquiry_date).getMonth() + 1
      if (String(m) !== hankyoMonthFilter) return false
    }
    if (hankyoMediaFilter !== 'all' && r.media !== hankyoMediaFilter) return false
    if (hankyoStoreFilter !== 'all' && r.store !== hankyoStoreFilter) return false
    return true
  })
  const hankyoTotalPages = Math.max(1, Math.ceil(filteredHankyo.length / HANKYO_PAGE_SIZE))
  const paginatedHankyo = filteredHankyo.slice((hankyoPage - 1) * HANKYO_PAGE_SIZE, hankyoPage * HANKYO_PAGE_SIZE)

  // ダッシュボード用 反響集計
  const hankyoMonthlyData = (() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const count = hankyoRecords.filter((r) => r.inquiry_date?.startsWith(ym)).length
      return { month: `${d.getMonth() + 1}月`, count }
    })
  })()
  const hankyoByMedia = Object.entries(
    hankyoRecords.reduce<Record<string, number>>((acc, r) => { acc[r.media || '不明'] = (acc[r.media || '不明'] || 0) + 1; return acc }, {})
  ).map(([media, count]) => ({ media, count })).sort((a, b) => b.count - a.count)
  const hankyoByStore = Object.entries(
    hankyoRecords.filter(r => r.store && r.store !== '対象外').reduce<Record<string, number>>((acc, r) => { acc[r.store] = (acc[r.store] || 0) + 1; return acc }, {})
  ).map(([store, count]) => ({ store, count })).sort((a, b) => b.count - a.count).slice(0, 10)

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
    await supabase.from('tasks').update(normalizeTask(taskInlineForm)).eq('id', taskInlineId)
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
    await supabase.from('tasks').update({ status }).eq('id', id)
    fetchTasks()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">WEB Strategic Team</p>
          <h1>WEB戦略チーム管理表</h1>
          <p className="intro">社内依頼、SNS運用、採用導線をひとつの画面で追える管理ツール</p>
        </div>
        <div className="header-panel">
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
        </div>
      </header>

      <nav className="tab-nav" aria-label="主要メニュー">
        <button className={activePage === 'dashboard' ? 'active' : ''} onClick={() => { setActivePage('dashboard'); setShowModal(false) }}>ダッシュボード</button>
        <button className={activePage === 'tasks' ? 'active' : ''} onClick={() => { setActivePage('tasks'); setShowModal(false) }}>案件管理</button>
        <button className={activePage === 'taskmanagement' ? 'active' : ''} onClick={() => { setActivePage('taskmanagement'); setShowModal(false) }}>タスク管理</button>
        <button className={activePage === 'sns' ? 'active' : ''} onClick={() => { setActivePage('sns'); setShowModal(false) }}>SNS投稿管理</button>
        <button className={activePage === 'recruitment' ? 'active' : ''} onClick={() => { setActivePage('recruitment'); setShowModal(false) }}>採用管理</button>
        <button className={activePage === 'hankyo' ? 'active' : ''} onClick={() => { setActivePage('hankyo'); setShowModal(false) }}>反響管理</button>
        <button className={activePage === 'members' ? 'active' : ''} onClick={() => { setActivePage('members'); setShowModal(false) }}>メンバー</button>
      </nav>

      <main className="page-content">
        {activePage === 'dashboard' && (
          <section className="dashboard-grid">
            <div className="stat-card strong"><span>総削減額</span><strong>{currency.format(totalSavings)}</strong><small>完了案件のみを集計</small></div>
            <div className="stat-card"><span>SNS投稿数</span><strong>{integer.format(filteredPosts.length)}件</strong><small>選択期間の合計投稿</small></div>
            <div className="stat-card"><span>採用記録数</span><strong>{integer.format(filteredRecruitment.length)}件</strong><small>選択期間の合計</small></div>
            <div className="stat-card"><span>採用削減額</span><strong>{currency.format(recruitmentSummary.costReduction)}</strong><small>選択期間の合計</small></div>
            <div className="stat-card"><span>反響総数</span><strong>{integer.format(hankyoRecords.length)}件</strong><small>全期間累計</small></div>

            <section className="panel chart-panel">
              <div className="panel-heading"><div><h2>部署別削減額</h2><p>完了案件の削減額を部署別に表示</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentSavings.length ? departmentSavings : [{ department: 'データなし', savings: 0 }]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="department" />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
                    <Tooltip formatter={(value) => currency.format(Number(value ?? 0))} />
                    <Bar dataKey="savings" fill="#0f766e" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel chart-panel">
              <div className="panel-heading"><div><h2>アカウント別SNS投稿数</h2><p>選択期間のアカウント別投稿数</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={snsAccountMetrics}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="account" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="posts" name="投稿数" fill="#ea580c" radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel chart-panel">
              <div className="panel-heading"><div><h2>部署別採用削減額</h2><p>選択期間の部署別コスト削減</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={recruitmentByDepartment}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="department" />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v)/10000)}万`} />
                    <Tooltip formatter={(v) => currency.format(Number(v ?? 0))} />
                    <Bar dataKey="costReduction" name="削減額" fill="#1d4ed8" radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>部署別採用実績</h2><p>選択期間の部署単位の件数・削減額</p></div></div>
              <div className="mini-table">
                <table>
                  <thead><tr><th>部署</th><th>件数</th><th>削減額</th></tr></thead>
                  <tbody>
                    {recruitmentByDepartment.length === 0 && <tr><td colSpan={3}>データがありません。</td></tr>}
                    {recruitmentByDepartment.map((r) => (
                      <tr key={r.department}>
                        <td>{r.department}</td>
                        <td>{integer.format(r.count)}件</td>
                        <td>{currency.format(r.costReduction)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel chart-panel">
              <div className="panel-heading"><div><h2>月別反響数</h2><p>直近6ヶ月の反響件数</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hankyoMonthlyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="反響数" fill="#7c3aed" radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>媒体別反響数</h2><p>全期間の媒体ごとの件数</p></div></div>
              <div className="mini-table">
                <table>
                  <thead><tr><th>媒体</th><th>件数</th></tr></thead>
                  <tbody>
                    {hankyoByMedia.length === 0 && <tr><td colSpan={2}>データがありません。</td></tr>}
                    {hankyoByMedia.map((r) => (
                      <tr key={r.media}><td>{r.media}</td><td>{r.count}件</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>店舗別送客数</h2><p>送客先（対象外除く）TOP10</p></div></div>
              <div className="mini-table">
                <table>
                  <thead><tr><th>店舗</th><th>件数</th></tr></thead>
                  <tbody>
                    {hankyoByStore.length === 0 && <tr><td colSpan={2}>データがありません。</td></tr>}
                    {hankyoByStore.map((r) => (
                      <tr key={r.store}><td>{r.store}</td><td>{r.count}件</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>進行中案件</h2><p>ステータスが「作業中」の案件一覧</p></div></div>
              <div className="ongoing-list">
                {ongoingTasks.length === 0 && <p className="empty-text">該当する進行中案件はありません。</p>}
                {ongoingTasks.map((task) => (
                  <article className="ongoing-item" key={task.id}>
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
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>案件日</th><th>担当者</th><th>依頼部署</th><th>案件名</th><th>案件内容</th>
                      <th>種類</th><th>期日</th><th>優先度</th><th>現状</th><th>削減額</th><th>補足</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
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
                                <button className="danger" onClick={async () => { await supabase.from('tasks').delete().eq('id', task.id); fetchTasks() }}>削除</button>
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
              <div className="tm-filters">
                {(['all', '未着手', '自分', '期限切れ'] as const).map((f) => (
                  <button key={f} className={`tm-filter-btn ${taskFilter === f ? 'active' : ''}`} onClick={() => setTaskFilter(f)}>
                    {f === 'all' ? 'すべて' : f === '自分' ? '自分の担当' : f}
                  </button>
                ))}
              </div>
              <input className="tm-search" placeholder="タスク名で検索..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
              <div className="tm-myname">
                <span>自分:</span>
                <select value={myName} onChange={(e) => { setMyName(e.target.value); localStorage.setItem('myName', e.target.value) }}>
                  <option value="">未設定</option>
                  {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            </div>

            {/* タスク一覧テーブル */}
            <section className="panel tm-table-panel">
              <div className="table-wrap">
                <table className="tm-table">
                  <thead>
                    <tr>
                      <th>日付</th><th>タスク名</th><th>詳細</th><th>優先度</th><th>期日</th>
                      <th>担当者</th><th>設定者</th><th>ステータス</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTaskItems.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '24px' }}>タスクがありません</td></tr>
                    )}
                    {filteredTaskItems.map((item) => {
                      const isEditing = taskItemInlineId === item.id
                      const f = taskItemInlineForm
                      const overdue = item.due_date && item.due_date < today && item.status !== '完了'
                      return (
                        <tr key={item.id} className={`${isEditing ? 'row-editing' : 'row-hoverable'} ${overdue ? 'row-overdue' : ''}`}
                          onClick={() => {
                            if (!isEditing) {
                              setTaskItemInlineId(item.id)
                              setTaskItemInlineForm({ date: item.date || '', name: item.name, detail: item.detail || '', priority: item.priority || '中', due_date: item.due_date || '', assignees: item.assignees || [], creator: item.creator || '', status: item.status })
                            }
                          }}>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.date} onChange={(e) => setTaskItemInlineForm({ ...f, date: e.target.value })} /> : item.date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {overdue && <span className="tag-overdue">期限切れ</span>}
                              {isEditing ? <input className="inline-input tm-name-input" value={f.name} onChange={(e) => setTaskItemInlineForm({ ...f, name: e.target.value })} /> : item.name}
                            </div>
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" value={f.detail} onChange={(e) => setTaskItemInlineForm({ ...f, detail: e.target.value })} /> : <span className="cell-truncate" title={item.detail}>{item.detail}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.priority} onChange={(e) => setTaskItemInlineForm({ ...f, priority: e.target.value as Priority })}>{priorityOptions.map((p) => <option key={p}>{p}</option>)}</select>
                              : <span className={`priority priority-${item.priority}`}>{item.priority}</span>}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="date" value={f.due_date} onChange={(e) => setTaskItemInlineForm({ ...f, due_date: e.target.value })} /> : item.due_date}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <div className="inline-checkbox-group">{members.map((m) => (
                                  <label key={m.id} className="inline-checkbox-item">
                                    <input type="checkbox" checked={f.assignees.includes(m.name)} onChange={(e) => {
                                      const next = e.target.checked ? [...f.assignees, m.name] : f.assignees.filter((x) => x !== m.name)
                                      setTaskItemInlineForm({ ...f, assignees: next })
                                    }} />{m.name}
                                  </label>
                                ))}</div>
                              : (item.assignees || []).join('・')}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" value={f.creator} onChange={(e) => setTaskItemInlineForm({ ...f, creator: e.target.value })} /> : item.creator}
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
                                <button className="danger" onClick={async () => { await supabase.from('task_items').delete().eq('id', item.id); fetchTaskItems() }}>削除</button>
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

            {/* メンバー管理 */}
            <section className="panel">
              <div className="panel-heading"><div><h2>メンバー設定</h2><p>SlackユーザーIDを設定すると@メンションで通知されます</p></div></div>
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
            </section>
          </section>
        )}

        {/* ===== SNS投稿管理 ===== */}
        {activePage === 'sns' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>SNS投稿一覧</h2><p>行をクリックして直接編集</p></div></div>
              <div className="table-wrap">
                <table>
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
                                <button className="danger" onClick={async () => { await supabase.from('sns_posts').delete().eq('id', post.id); fetchPosts() }}>削除</button>
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

        {/* ===== 採用管理 ===== */}
        {activePage === 'recruitment' && (
          <>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>採用実績一覧</h2><p>行をクリックして直接編集</p></div></div>
              <div className="table-wrap">
                <table>
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
                                <button className="danger" onClick={async () => { await supabase.from('recruitment').delete().eq('id', record.id); fetchRecruitment() }}>削除</button>
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

        {/* ===== 反響管理 ===== */}
        {activePage === 'hankyo' && (
          <>
            {/* 一覧テーブル */}
            <section className="panel hankyo-table-panel">
              <div className="panel-heading">
                <div><h2>反響一覧</h2><p>全{filteredHankyo.length}件 / {hankyoRecords.length}件中</p></div>
              </div>

              {/* 検索・フィルター */}
              <div className="hankyo-toolbar">
                <input
                  className="hankyo-search"
                  placeholder="顧客名で検索..."
                  value={hankyoSearch}
                  onChange={(e) => { setHankyoSearch(e.target.value); setHankyoPage(1) }}
                />
                <select value={hankyoMonthFilter} onChange={(e) => { setHankyoMonthFilter(e.target.value); setHankyoPage(1) }}>
                  <option value="all">全月</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>{m}月</option>
                  ))}
                </select>
                <select value={hankyoMediaFilter} onChange={(e) => { setHankyoMediaFilter(e.target.value); setHankyoPage(1) }}>
                  <option value="all">全媒体</option>
                  {hankyoMedias.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={hankyoStoreFilter} onChange={(e) => { setHankyoStoreFilter(e.target.value); setHankyoPage(1) }}>
                  <option value="all">全店舗</option>
                  {hankyoStores.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>反響日</th>
                      <th>顧客名</th>
                      <th>媒体</th>
                      <th>問合内容</th>
                      <th>送客先店舗</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHankyo.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)' }}>データがありません</td></tr>
                    )}
                    {paginatedHankyo.map((r) => {
                      const isEditing = hankyoInlineId === r.id
                      const f = hankyoInlineForm
                      return (
                        <tr
                          key={r.id}
                          className={isEditing ? 'row-editing' : 'row-hoverable'}
                          onClick={() => { if (!isEditing) startHankyoInline(r) }}
                        >
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
                              ? <select className="inline-select" value={f.store} onChange={(e) => setHankyoInlineForm({ ...f, store: e.target.value })}>{hankyoStores.map((s) => <option key={s}>{s}</option>)}</select>
                              : r.store}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {isEditing ? (
                                <>
                                  {/* 編集モード時は全フィールド編集可 */}
                                  <div className="hankyo-inline-extra" onClick={(e) => e.stopPropagation()}>
                                    <label>アカウント<select className="inline-select" value={f.account} onChange={(e) => setHankyoInlineForm({ ...f, account: e.target.value })}>{hankyoAccounts.map((a) => <option key={a}>{a}</option>)}</select></label>
                                    <label>きっかけ<select className="inline-select" value={f.trigger} onChange={(e) => setHankyoInlineForm({ ...f, trigger: e.target.value })}>{hankyoTriggers.map((t) => <option key={t}>{t}</option>)}</select></label>
                                    <label>問合手段<select className="inline-select" value={f.contact_method} onChange={(e) => setHankyoInlineForm({ ...f, contact_method: e.target.value })}>{hankyoContactMethods.map((c) => <option key={c}>{c}</option>)}</select></label>
                                    <label>入居希望<select className="inline-select" value={f.move_in_timing} onChange={(e) => setHankyoInlineForm({ ...f, move_in_timing: e.target.value })}>{hankyoMoveInTimings.map((t) => <option key={t}>{t}</option>)}</select></label>
                                    <label>エリア<input className="inline-input" value={f.area} onChange={(e) => setHankyoInlineForm({ ...f, area: e.target.value })} /></label>
                                    <label>備考<input className="inline-input" value={f.note} onChange={(e) => setHankyoInlineForm({ ...f, note: e.target.value })} /></label>
                                  </div>
                                  <button className="primary" onClick={saveHankyoInline}>保存</button>
                                  <button className="secondary" onClick={() => setHankyoInlineId(null)}>×</button>
                                </>
                              ) : (
                                <>
                                  <button className="hankyo-dup-btn" onClick={() => duplicateHankyo(r)} title="このデータを複製">複製</button>
                                  <button className="danger" onClick={async () => { await supabase.from('hankyo').delete().eq('id', r.id); fetchHankyo() }}>削除</button>
                                </>
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
              {hankyoTotalPages > 1 && (
                <div className="hankyo-pagination">
                  <button onClick={() => setHankyoPage(1)} disabled={hankyoPage === 1}>«</button>
                  <button onClick={() => setHankyoPage(p => Math.max(1, p - 1))} disabled={hankyoPage === 1}>‹</button>
                  {Array.from({ length: hankyoTotalPages }, (_, i) => i + 1)
                    .filter((p) => Math.abs(p - hankyoPage) <= 2)
                    .map((p) => (
                      <button key={p} className={p === hankyoPage ? 'active' : ''} onClick={() => setHankyoPage(p)}>{p}</button>
                    ))}
                  <button onClick={() => setHankyoPage(p => Math.min(hankyoTotalPages, p + 1))} disabled={hankyoPage === hankyoTotalPages}>›</button>
                  <button onClick={() => setHankyoPage(hankyoTotalPages)} disabled={hankyoPage === hankyoTotalPages}>»</button>
                  <span className="hankyo-page-info">{hankyoPage} / {hankyoTotalPages}ページ</span>
                </div>
              )}
            </section>
          </>
        )}

        {/* ===== メンバー ===== */}
        {activePage === 'members' && (
          <section className="members-page">

            {/* 今日のタスク */}
            {import.meta.env.VITE_GOOGLE_CLIENT_ID
              ? <TodayTasksPanel />
              : (
                <div className="panel">
                  <div className="panel-heading"><div><h2>今日のタスク</h2></div></div>
                  <div className="calendar-login-prompt"><p>Google Calendar連携を有効にするにはVercelに環境変数を設定してください。</p></div>
                </div>
              )
            }

            {/* カレンダー埋め込み */}
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h2>チームカレンダー</h2>
                  <p>カレンダー上で直接イベントの追加・編集が可能です。</p>
                </div>
              </div>
              <div className="calendar-wrap">
                <iframe
                  src="https://calendar.google.com/calendar/embed?src=takara.webteam%40gmail.com&src=trg.yshini%40gmail.com&src=izumiyurina2322%40gmail.com&src=takarabaito3%40gmail.com&src=takarabaito1%40gmail.com&ctz=Asia%2FTokyo"
                  style={{ border: 0 }}
                  width="100%"
                  height="640"
                  frameBorder={0}
                  scrolling="no"
                  title="チームカレンダー"
                />
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ===== フローティング追加ボタン ===== */}
      {activePage !== 'dashboard' && activePage !== 'members' && (
        <button
          className="fab"
          onClick={() => setShowModal(true)}
          aria-label="新規追加"
          title="新規追加"
        >
          ＋
        </button>
      )}

      {/* ===== 追加フォームモーダル ===== */}
      {showModal && activePage !== 'dashboard' && activePage !== 'members' && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">
                {activePage === 'tasks' && '案件を追加'}
                {activePage === 'taskmanagement' && 'タスクを追加'}
                {activePage === 'sns' && '投稿を追加'}
                {activePage === 'recruitment' && '採用データを追加'}
                {activePage === 'hankyo' && '反響を追加'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
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
                  <select value={taskForm.taskType} onChange={(e) => setTaskForm({ ...taskForm, taskType: e.target.value as TaskType })}>{taskTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                </label>
                <label className="form-label">期日
                  <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} required />
                </label>
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
                  <label className="form-label">タスク詳細
                    <input placeholder="タスク詳細" value={taskItemForm.detail} onChange={(e) => setTaskItemForm({ ...taskItemForm, detail: e.target.value })} />
                  </label>
                  <label className="form-label">優先度
                    <select value={taskItemForm.priority} onChange={(e) => setTaskItemForm({ ...taskItemForm, priority: e.target.value as Priority })}>
                      {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label className="form-label">期日
                    <input type="date" value={taskItemForm.due_date} onChange={(e) => setTaskItemForm({ ...taskItemForm, due_date: e.target.value })} />
                  </label>
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
                    <input placeholder="設定者" value={taskItemForm.creator} onChange={(e) => setTaskItemForm({ ...taskItemForm, creator: e.target.value })} />
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
                    {hankyoAccounts.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </label>
                <label className="form-label">きっかけ
                  <select value={hankyoForm.trigger} onChange={(e) => setHankyoForm({ ...hankyoForm, trigger: e.target.value })}>
                    {hankyoTriggers.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">反響媒体
                  <select value={hankyoForm.media} onChange={(e) => setHankyoForm({ ...hankyoForm, media: e.target.value })}>
                    {hankyoMedias.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="form-label">問合内容
                  <select value={hankyoForm.inquiry_type} onChange={(e) => setHankyoForm({ ...hankyoForm, inquiry_type: e.target.value })}>
                    {hankyoInquiryTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">顧客名 <span className="required-badge">必須</span>
                  <input placeholder="顧客名" value={hankyoForm.customer_name} onChange={(e) => setHankyoForm({ ...hankyoForm, customer_name: e.target.value })} required />
                </label>
                <label className="form-label">問合手段
                  <select value={hankyoForm.contact_method} onChange={(e) => setHankyoForm({ ...hankyoForm, contact_method: e.target.value })}>
                    {hankyoContactMethods.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="form-label">入居希望時期
                  <select value={hankyoForm.move_in_timing} onChange={(e) => setHankyoForm({ ...hankyoForm, move_in_timing: e.target.value })}>
                    {hankyoMoveInTimings.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="form-label">送客先店舗
                  <select value={hankyoForm.store} onChange={(e) => setHankyoForm({ ...hankyoForm, store: e.target.value })}>
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
          </div>
        </div>
      )}
    </div>
  )
}

const STORAGE_KEY = 'gcal_token'
const STORAGE_EXPIRY_KEY = 'gcal_token_expiry'

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

function TodayTasksPanel() {
  const [accessToken, setAccessToken] = useState<string | null>(getSavedToken)
  const [memberEvents, setMemberEvents] = useState<Record<string, CalendarEvent[]>>({})
  const [checkedEvents, setCheckedEvents] = useState<Record<string, boolean>>({})
  const [calendarLoading, setCalendarLoading] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  // Supabaseから今日のチェック状態を読み込む（3秒ごとにポーリングして他PCと同期）
  useEffect(() => {
    const fetchChecked = async () => {
      const { data } = await supabase
        .from('checked_events')
        .select('event_key')
        .eq('event_date', today)
      if (data) {
        const map: Record<string, boolean> = {}
        data.forEach((row: { event_key: string }) => { map[row.event_key] = true })
        setCheckedEvents(map)
      }
    }
    fetchChecked()
    const interval = setInterval(fetchChecked, 3000)
    return () => clearInterval(interval)
  }, [today])

  const toggleCheck = async (key: string, checked: boolean) => {
    // 楽観的UI更新
    setCheckedEvents(prev => checked ? (() => { const n = { ...prev }; delete n[key]; return n })() : { ...prev, [key]: true })
    if (checked) {
      await supabase.from('checked_events').delete().eq('event_key', key)
    } else {
      await supabase.from('checked_events').upsert({ event_key: key, event_date: today })
    }
  }

  const fetchMemberEvents = useCallback(async (token: string) => {
    setCalendarLoading(true)
    const now = new Date()
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
    const results: Record<string, CalendarEvent[]> = {}
    await Promise.all(
      TEAM_MEMBERS.map(async (member) => {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(member.calendarId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (res.status === 401) {
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

  // 保存済みトークンがあれば起動時に自動取得
  useEffect(() => {
    const saved = getSavedToken()
    if (saved) fetchMemberEvents(saved)
  }, [fetchMemberEvents])

  const googleLogin = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    onSuccess: (res) => {
      saveToken(res.access_token, res.expires_in ?? 3600)
      setAccessToken(res.access_token)
      fetchMemberEvents(res.access_token)
    },
  })

  return (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h2>今日のタスク</h2>
          <p>{new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        </div>
        {!accessToken
          ? <button className="primary" onClick={() => googleLogin()}>Googleでログイン</button>
          : <button className="secondary" onClick={() => fetchMemberEvents(accessToken)}>再読み込み</button>
        }
      </div>

      {!accessToken && (
        <div className="calendar-login-prompt">
          <p>「Googleでログイン」ボタンを押すと、各メンバーの今日の予定をカレンダーから取得します。</p>
        </div>
      )}

      {calendarLoading && (
        <div className="calendar-login-prompt"><p>読み込み中...</p></div>
      )}

      {accessToken && !calendarLoading && (
        <div className="today-tasks-grid">
          {TEAM_MEMBERS.filter(m => m.name !== 'WEBチーム').map((member) => {
            const events = memberEvents[member.calendarId] || []
            return (
              <div key={member.calendarId} className="member-task-card">
                <div className="member-task-header" style={{ borderLeft: `4px solid ${member.color}` }}>
                  <span className="member-name">{member.name}</span>
                  <span className="member-event-count">{events.length}件</span>
                </div>
                {events.length === 0 ? (
                  <p className="no-events">予定なし</p>
                ) : (
                  <ul className="event-checklist">
                    {events.map((ev) => {
                      const key = `${member.calendarId}:${ev.id}`
                      const checked = !!checkedEvents[key]
                      const time = ev.start.includes('T')
                        ? new Date(ev.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                        : '終日'
                      return (
                        <li key={ev.id} className={`event-item ${checked ? 'checked' : ''}`}
                          onClick={() => toggleCheck(key, checked)}>
                          <span className="event-checkbox">{checked ? '✓' : ''}</span>
                          <span className="event-time">{time}</span>
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
