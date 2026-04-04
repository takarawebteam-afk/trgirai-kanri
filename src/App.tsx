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
type PageKey = 'dashboard' | 'tasks' | 'sns' | 'recruitment' | 'members'

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
const priorityOptions: Priority[] = ['高', '中', '低']
const assigneeOptions = ['泉', '坂本', '吉田', '新居']
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

  useEffect(() => {
    fetchTasks()
    fetchPosts()
    fetchRecruitment()

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

  // 新規追加ハンドラ
  const handleTaskSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('tasks').insert({ ...normalizeTask(taskForm), id: crypto.randomUUID() })
    setTaskForm(defaultTaskForm)
    fetchTasks()
  }

  const handleSnsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('sns_posts').insert({ ...normalizePost(snsForm), id: crypto.randomUUID() })
    setSnsForm(defaultSnsForm)
    fetchPosts()
  }

  const handleRecruitmentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await supabase.from('recruitment').insert({ ...normalizeRecruitment(recruitmentForm), id: crypto.randomUUID() })
    setRecruitmentForm(defaultRecruitmentForm)
    fetchRecruitment()
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
        <button className={activePage === 'dashboard' ? 'active' : ''} onClick={() => setActivePage('dashboard')}>ダッシュボード</button>
        <button className={activePage === 'tasks' ? 'active' : ''} onClick={() => setActivePage('tasks')}>案件管理</button>
        <button className={activePage === 'sns' ? 'active' : ''} onClick={() => setActivePage('sns')}>SNS投稿管理</button>
        <button className={activePage === 'recruitment' ? 'active' : ''} onClick={() => setActivePage('recruitment')}>採用管理</button>
        <button className={activePage === 'members' ? 'active' : ''} onClick={() => setActivePage('members')}>メンバー</button>
      </nav>

      <main className="page-content">
        {activePage === 'dashboard' && (
          <section className="dashboard-grid">
            <div className="stat-card strong"><span>総削減額</span><strong>{currency.format(totalSavings)}</strong><small>完了案件のみを集計</small></div>
            <div className="stat-card"><span>SNS投稿数</span><strong>{integer.format(filteredPosts.length)}件</strong><small>選択期間の合計投稿</small></div>
            <div className="stat-card"><span>採用記録数</span><strong>{integer.format(filteredRecruitment.length)}件</strong><small>選択期間の合計</small></div>
            <div className="stat-card"><span>採用削減額</span><strong>{currency.format(recruitmentSummary.costReduction)}</strong><small>選択期間の合計</small></div>

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
          <section className="management-layout">
            <section className="panel form-panel">
              <div className="panel-heading"><div><h2>案件を追加</h2><p>完了案件のみ削減額に反映されます。</p></div></div>
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
                </div>
              </form>
            </section>

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
          </section>
        )}

        {/* ===== SNS投稿管理 ===== */}
        {activePage === 'sns' && (
          <section className="management-layout">
            <section className="panel form-panel">
              <div className="panel-heading"><div><h2>投稿を追加</h2><p>TikTok / Instagram / Threads / YouTube の投稿指標を管理</p></div></div>
              <form className="data-form" onSubmit={handleSnsSubmit}>
                <input type="date" value={snsForm.postDate} onChange={(e) => setSnsForm({ ...snsForm, postDate: e.target.value })} required />
                <select value={snsForm.platform} onChange={(e) => setSnsForm({ ...snsForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <select value={snsForm.account} onChange={(e) => setSnsForm({ ...snsForm, account: e.target.value })}>{snsAccounts.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                <input type="number" min="0" placeholder="コメント数（例: 50）" value={snsForm.comments || ''} onChange={(e) => setSnsForm({ ...snsForm, comments: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="保存数（例: 100）" value={snsForm.saves || ''} onChange={(e) => setSnsForm({ ...snsForm, saves: Number(e.target.value) || 0 })} />
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                </div>
              </form>
            </section>
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
          </section>
        )}

        {/* ===== 採用管理 ===== */}
        {activePage === 'recruitment' && (
          <section className="management-layout">
            <section className="panel form-panel">
              <div className="panel-heading"><div><h2>採用データを追加</h2><p>採用媒体・部署・職種・削減額を記録</p></div></div>
              <form className="data-form" onSubmit={handleRecruitmentSubmit}>
                <input type="date" value={recruitmentForm.date} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, date: e.target.value })} required placeholder="応募日" />
                <select value={recruitmentForm.platform} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <select value={recruitmentForm.department} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, department: e.target.value as RecruitDepartment })}>{recruitDepartments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                <select value={recruitmentForm.jobType} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, jobType: e.target.value as JobType })}>{jobTypes.map((j) => <option key={j} value={j}>{j}</option>)}</select>
                <input type="number" min="0" placeholder="削減額（例: 50000）" value={recruitmentForm.costReduction || ''} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, costReduction: Number(e.target.value) || 0 })} />
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                </div>
              </form>
            </section>

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
          </section>
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
