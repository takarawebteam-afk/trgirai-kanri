import { useEffect, useState, useCallback } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { supabase } from './supabase'

type Department = '人事' | '総務' | '経理' | '管理' | '売買' | '仲介' | '本社'
type TaskType = '単発' | '継続'
type TaskStatus = '依頼' | '作業中' | '完了'
type SnsPlatform = 'TikTok' | 'Instagram'
type PageKey = 'dashboard' | 'tasks' | 'sns' | 'recruitment' | 'members'

type Task = {
  id: string
  name: string
  department: Department
  taskType: TaskType
  startDate: string
  endDate: string
  memo: string
  savings: number
  status: TaskStatus
}

type SnsPost = {
  id: string
  postDate: string
  platform: SnsPlatform
  account: string
  views: number
  likes: number
  comments: number
  saves: number
  shares: number
  followerGrowth: number
}

type RecruitmentRecord = {
  id: string
  date: string
  platform: SnsPlatform
  account: string
  urlClicks: number
  applications: number
  hires: number
}

const TEAM_MEMBERS = [
  { name: '新居', calendarId: 'trg.yshini@gmail.com', color: '#374151' },
  { name: '泉', calendarId: 'izumiyurina2322@gmail.com', color: '#7c3aed' },
  { name: '坂本', calendarId: 'takarabaito3@gmail.com', color: '#1d4ed8' },
  { name: '吉田', calendarId: 'takarabaito1@gmail.com', color: '#db2777' },
  { name: 'WEBチーム', calendarId: 'takara.webteam@gmail.com', color: '#0ea5e9' },
]

type CalendarEvent = { id: string; summary: string; start: string }

const departments: Department[] = ['人事', '総務', '経理', '管理', '売買', '仲介', '本社']
const taskTypes: TaskType[] = ['単発', '継続']
const taskStatuses: TaskStatus[] = ['依頼', '作業中', '完了']
const snsPlatforms: SnsPlatform[] = ['TikTok', 'Instagram']

const defaultTaskForm: Omit<Task, 'id'> = {
  name: '',
  department: '人事',
  taskType: '単発',
  startDate: '',
  endDate: '',
  memo: '',
  savings: 0,
  status: '依頼',
}

const defaultSnsForm: Omit<SnsPost, 'id'> = {
  postDate: '',
  platform: 'TikTok',
  account: '',
  views: 0,
  likes: 0,
  comments: 0,
  saves: 0,
  shares: 0,
  followerGrowth: 0,
}

const defaultRecruitmentForm: Omit<RecruitmentRecord, 'id'> = {
  date: '',
  platform: 'TikTok',
  account: '',
  urlClicks: 0,
  applications: 0,
  hires: 0,
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
      ...tasks.flatMap((task) => [getYear(task.startDate), getYear(task.endDate)]),
      ...posts.map((post) => getYear(post.postDate)),
      ...recruitment.map((record) => getYear(record.date)),
    ]),
  )
    .filter(Boolean)
    .sort((a, b) => b - a)

  const filteredCompletedTasks = tasks.filter(
    (task) => task.status === '完了' && matchesYearMonth(task.endDate, selectedYear, selectedMonth),
  )
  const filteredPosts = posts.filter((post) =>
    matchesYearMonth(post.postDate, selectedYear, selectedMonth),
  )
  const filteredRecruitment = recruitment.filter((record) =>
    matchesYearMonth(record.date, selectedYear, selectedMonth),
  )
  const ongoingTasks = tasks.filter((task) => {
    if (task.status !== '作業中') return false
    return overlapsPeriod(task.startDate, task.endDate, selectedYear, selectedMonth)
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
    filteredPosts.reduce<Record<string, { account: string; posts: number; followerGrowth: number }>>(
      (acc, post) => {
        if (!acc[post.account]) {
          acc[post.account] = { account: post.account, posts: 0, followerGrowth: 0 }
        }
        acc[post.account].posts += 1
        acc[post.account].followerGrowth += post.followerGrowth
        return acc
      },
      {},
    ),
  )

  const recruitmentByAccount = Object.values(
    filteredRecruitment.reduce<
      Record<string, { account: string; urlClicks: number; applications: number; hires: number }>
    >((acc, record) => {
      if (!acc[record.account]) {
        acc[record.account] = { account: record.account, urlClicks: 0, applications: 0, hires: 0 }
      }
      acc[record.account].urlClicks += record.urlClicks
      acc[record.account].applications += record.applications
      acc[record.account].hires += record.hires
      return acc
    }, {}),
  )

  const recruitmentSummary = filteredRecruitment.reduce(
    (acc, record) => {
      acc.urlClicks += record.urlClicks
      acc.applications += record.applications
      acc.hires += record.hires
      return acc
    },
    { urlClicks: 0, applications: 0, hires: 0 },
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
    setTaskInlineForm({ name: task.name, department: task.department, taskType: task.taskType, startDate: task.startDate, endDate: task.endDate, memo: task.memo, savings: task.savings, status: task.status })
  }
  const startSnsInline = (post: SnsPost) => {
    setSnsInlineId(post.id)
    setSnsInlineForm({ postDate: post.postDate, platform: post.platform, account: post.account, views: post.views, likes: post.likes, comments: post.comments, saves: post.saves, shares: post.shares, followerGrowth: post.followerGrowth })
  }
  const startRecruitmentInline = (record: RecruitmentRecord) => {
    setRecruitmentInlineId(record.id)
    setRecruitmentInlineForm({ date: record.date, platform: record.platform, account: record.account, urlClicks: record.urlClicks, applications: record.applications, hires: record.hires })
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
          <p className="eyebrow">Internal Operations Dashboard</p>
          <h1>社内依頼案件管理ツール</h1>
          <p className="intro">社内依頼、SNS運用、採用導線をひとつの画面で追える管理アプリです。</p>
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
            <div className="stat-card"><span>応募数</span><strong>{integer.format(recruitmentSummary.applications)}件</strong><small>採用導線経由</small></div>
            <div className="stat-card"><span>採用数</span><strong>{integer.format(recruitmentSummary.hires)}名</strong><small>選択期間の合計</small></div>

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
              <div className="panel-heading"><div><h2>アカウント別SNS指標</h2><p>投稿数とフォロワー増加数を並列表示</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={snsAccountMetrics}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="account" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="posts" stroke="#ea580c" strokeWidth={3} />
                    <Line type="monotone" dataKey="followerGrowth" stroke="#2563eb" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel chart-panel">
              <div className="panel-heading"><div><h2>採用ファネル</h2><p>URLクリック、応募、採用を比較</p></div></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'URLクリック', value: recruitmentSummary.urlClicks },
                        { name: '応募', value: recruitmentSummary.applications },
                        { name: '採用', value: recruitmentSummary.hires },
                      ]}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={96}
                      innerRadius={52}
                      fill="#1d4ed8"
                      label
                    />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>アカウント別採用実績</h2><p>選択期間のアカウント単位の成果</p></div></div>
              <div className="mini-table">
                <table>
                  <thead><tr><th>アカウント</th><th>URLクリック</th><th>応募</th><th>採用</th></tr></thead>
                  <tbody>
                    {recruitmentByAccount.length === 0 && <tr><td colSpan={4}>データがありません。</td></tr>}
                    {recruitmentByAccount.map((record) => (
                      <tr key={record.account}>
                        <td>{record.account}</td>
                        <td>{integer.format(record.urlClicks)}</td>
                        <td>{integer.format(record.applications)}</td>
                        <td>{integer.format(record.hires)}</td>
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
                    <div><strong>{task.name}</strong><p>{task.department} / {task.taskType}</p></div>
                    <div><span>{task.startDate}</span><span>{task.endDate}</span></div>
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
                <input placeholder="案件名" value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} required />
                <select value={taskForm.department} onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value as Department })}>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                <select value={taskForm.taskType} onChange={(e) => setTaskForm({ ...taskForm, taskType: e.target.value as TaskType })}>{taskTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input type="date" value={taskForm.startDate} onChange={(e) => setTaskForm({ ...taskForm, startDate: e.target.value })} required />
                <input type="date" value={taskForm.endDate} onChange={(e) => setTaskForm({ ...taskForm, endDate: e.target.value })} required />
                <textarea placeholder="内容メモ（例: LP制作の依頼、修正3回まで含む）" value={taskForm.memo} onChange={(e) => setTaskForm({ ...taskForm, memo: e.target.value })} rows={4} />
                <input type="number" min="0" placeholder="削減額（例: 50000）" value={taskForm.savings || ''} onChange={(e) => setTaskForm({ ...taskForm, savings: Number(e.target.value) || 0 })} />
                <select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value as TaskStatus })}>{taskStatuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <div className="form-actions">
                  <button type="submit" className="primary">追加する</button>
                </div>
              </form>
            </section>

            <section className="panel table-panel">
              <div className="panel-heading">
                <div><h2>案件一覧</h2><p>行をクリックして直接編集・ステータスはその場で変更可能</p></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>案件名</th><th>依頼部署</th><th>種類</th><th>開始日</th><th>終了日</th><th>内容メモ</th><th>削減額</th><th>ステータス</th><th>操作</th></tr>
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
                            {isEditing
                              ? <input className="inline-input" value={f.name} onChange={(e) => setTaskInlineForm({ ...f, name: e.target.value })} />
                              : task.name}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.department} onChange={(e) => setTaskInlineForm({ ...f, department: e.target.value as Department })}>{departments.map((d) => <option key={d}>{d}</option>)}</select>
                              : task.department}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <select className="inline-select" value={f.taskType} onChange={(e) => setTaskInlineForm({ ...f, taskType: e.target.value as TaskType })}>{taskTypes.map((t) => <option key={t}>{t}</option>)}</select>
                              : task.taskType}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" type="date" value={f.startDate} onChange={(e) => setTaskInlineForm({ ...f, startDate: e.target.value })} />
                              : task.startDate}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" type="date" value={f.endDate} onChange={(e) => setTaskInlineForm({ ...f, endDate: e.target.value })} />
                              : task.endDate}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" value={f.memo} onChange={(e) => setTaskInlineForm({ ...f, memo: e.target.value })} />
                              : task.memo}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing
                              ? <input className="inline-input" type="number" value={f.savings} onChange={(e) => setTaskInlineForm({ ...f, savings: Number(e.target.value) })} />
                              : currency.format(task.savings)}
                          </td>
                          {/* ステータス：常にセレクトとして表示 */}
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
              <div className="panel-heading"><div><h2>投稿を追加</h2><p>TikTok / Instagram の投稿指標を管理</p></div></div>
              <form className="data-form" onSubmit={handleSnsSubmit}>
                <input type="date" value={snsForm.postDate} onChange={(e) => setSnsForm({ ...snsForm, postDate: e.target.value })} required />
                <select value={snsForm.platform} onChange={(e) => setSnsForm({ ...snsForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <input placeholder="アカウント" value={snsForm.account} onChange={(e) => setSnsForm({ ...snsForm, account: e.target.value })} required />
                <input type="number" min="0" placeholder="再生数（例: 5000）" value={snsForm.views || ''} onChange={(e) => setSnsForm({ ...snsForm, views: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="いいね数（例: 300）" value={snsForm.likes || ''} onChange={(e) => setSnsForm({ ...snsForm, likes: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="コメント数（例: 50）" value={snsForm.comments || ''} onChange={(e) => setSnsForm({ ...snsForm, comments: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="保存数（例: 100）" value={snsForm.saves || ''} onChange={(e) => setSnsForm({ ...snsForm, saves: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="シェア数（例: 30）" value={snsForm.shares || ''} onChange={(e) => setSnsForm({ ...snsForm, shares: Number(e.target.value) || 0 })} />
                <input type="number" placeholder="フォロワー増加数（例: 20）" value={snsForm.followerGrowth || ''} onChange={(e) => setSnsForm({ ...snsForm, followerGrowth: Number(e.target.value) || 0 })} />
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
                    <tr><th>投稿日</th><th>媒体</th><th>アカウント</th><th>再生数</th><th>いいね</th><th>コメント</th><th>保存</th><th>シェア</th><th>フォロワー増加</th><th>操作</th></tr>
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
                            {isEditing ? <input className="inline-input" value={f.account} onChange={(e) => setSnsInlineForm({ ...f, account: e.target.value })} /> : post.account}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.views} onChange={(e) => setSnsInlineForm({ ...f, views: Number(e.target.value) })} /> : integer.format(post.views)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.likes} onChange={(e) => setSnsInlineForm({ ...f, likes: Number(e.target.value) })} /> : integer.format(post.likes)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.comments} onChange={(e) => setSnsInlineForm({ ...f, comments: Number(e.target.value) })} /> : integer.format(post.comments)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.saves} onChange={(e) => setSnsInlineForm({ ...f, saves: Number(e.target.value) })} /> : integer.format(post.saves)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.shares} onChange={(e) => setSnsInlineForm({ ...f, shares: Number(e.target.value) })} /> : integer.format(post.shares)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.followerGrowth} onChange={(e) => setSnsInlineForm({ ...f, followerGrowth: Number(e.target.value) })} /> : integer.format(post.followerGrowth)}
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
              <div className="panel-heading"><div><h2>採用データを追加</h2><p>SNS流入から応募・採用までを記録</p></div></div>
              <form className="data-form" onSubmit={handleRecruitmentSubmit}>
                <input type="date" value={recruitmentForm.date} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, date: e.target.value })} required />
                <select value={recruitmentForm.platform} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, platform: e.target.value as SnsPlatform })}>{snsPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                <input placeholder="アカウント" value={recruitmentForm.account} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, account: e.target.value })} required />
                <input type="number" min="0" placeholder="URLクリック数（例: 200）" value={recruitmentForm.urlClicks || ''} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, urlClicks: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="応募数（例: 10）" value={recruitmentForm.applications || ''} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, applications: Number(e.target.value) || 0 })} />
                <input type="number" min="0" placeholder="採用数（例: 2）" value={recruitmentForm.hires || ''} onChange={(e) => setRecruitmentForm({ ...recruitmentForm, hires: Number(e.target.value) || 0 })} />
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
                    <tr><th>日付</th><th>SNS媒体</th><th>アカウント</th><th>URLクリック</th><th>応募数</th><th>採用数</th><th>操作</th></tr>
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
                            {isEditing ? <input className="inline-input" value={f.account} onChange={(e) => setRecruitmentInlineForm({ ...f, account: e.target.value })} /> : record.account}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.urlClicks} onChange={(e) => setRecruitmentInlineForm({ ...f, urlClicks: Number(e.target.value) })} /> : integer.format(record.urlClicks)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.applications} onChange={(e) => setRecruitmentInlineForm({ ...f, applications: Number(e.target.value) })} /> : integer.format(record.applications)}
                          </td>
                          <td onClick={(e) => isEditing && e.stopPropagation()}>
                            {isEditing ? <input className="inline-input" type="number" value={f.hires} onChange={(e) => setRecruitmentInlineForm({ ...f, hires: Number(e.target.value) })} /> : integer.format(record.hires)}
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

function overlapsPeriod(startDate: string, endDate: string, year: number, month: string) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const periodStart = new Date(year, month === 'all' ? 0 : Number(month) - 1, 1)
  const periodEnd = month === 'all' ? new Date(year, 11, 31, 23, 59, 59, 999) : new Date(year, Number(month), 0, 23, 59, 59, 999)
  return start <= periodEnd && end >= periodStart
}

function normalizeTask(task: Omit<Task, 'id'>): Omit<Task, 'id'> {
  return { ...task, savings: Number(task.savings) || 0 }
}

function normalizePost(post: Omit<SnsPost, 'id'>): Omit<SnsPost, 'id'> {
  return {
    ...post,
    views: Number(post.views) || 0,
    likes: Number(post.likes) || 0,
    comments: Number(post.comments) || 0,
    saves: Number(post.saves) || 0,
    shares: Number(post.shares) || 0,
    followerGrowth: Number(post.followerGrowth) || 0,
  }
}

function normalizeRecruitment(record: Omit<RecruitmentRecord, 'id'>): Omit<RecruitmentRecord, 'id'> {
  return {
    ...record,
    urlClicks: Number(record.urlClicks) || 0,
    applications: Number(record.applications) || 0,
    hires: Number(record.hires) || 0,
  }
}

export default App
