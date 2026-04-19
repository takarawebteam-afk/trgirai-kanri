import { useState, useEffect } from 'react'
import { supabase } from './supabase'

// ===== 型定義 =====
type ProductionStatus = '撮影済' | '制作中' | 'チェック中' | '完了'
type ProcessStatus = '未着手' | '進行中' | '完了'

interface ProductionRecord {
  id: string
  created_at?: string
  status: ProductionStatus
  material_saved: string
  scheduled_post_date: string
  aos_registered: boolean
  media: string
  property_name: string
  room_number: string
  property_address: string
  management_company: string
  contact_info: string
  floor_plan: string
  rent: string
  area: string
  nearest_station: string
  assignee: string
  device: string
  property_url: string
  wp_registered: boolean
  post_completed: boolean
  material_processing: ProcessStatus
  text_overlay: ProcessStatus
  video_duration: string
  afureko: ProcessStatus
  floor_plan_insert: ProcessStatus
  floor_plan_check: ProcessStatus
  countermeasure: string
  memo: string
  final_save: ProcessStatus
  post_text: string
}

// ===== 定数 =====

const PROCESS_COLORS: Record<ProcessStatus, { bg: string; color: string }> = {
  '未着手': { bg: '#f3f4f6', color: '#9ca3af' },
  '進行中': { bg: '#fef9c3', color: '#92400e' },
  '完了':   { bg: '#dcfce7', color: '#15803d' },
}

const PROCESS_STATUSES: ProcessStatus[] = ['未着手', '進行中', '完了']
const ASSIGNEE_OPTIONS = ['泉', '坂本', '吉田', '新居']
const DEVICE_OPTIONS = ['iPhone', 'Android', 'カメラ', 'その他']
const MEDIA_OPTIONS = ['Karilun｜Tiktok', 'Karilun｜Instagram', 'Karilun｜西宮市', 'Karilun｜京阪']

const FORM_TABS = [
  { key: 'basic'      as const, label: '① 基本情報' },
  { key: 'production' as const, label: '② 制作' },
  { key: 'check'      as const, label: '③ チェック' },
  { key: 'finish'     as const, label: '④ 仕上げ' },
] as const

type FormTabKey = typeof FORM_TABS[number]['key']

const defaultForm: Omit<ProductionRecord, 'id' | 'created_at'> = {
  status: '撮影済',
  material_saved: '',
  scheduled_post_date: '',
  aos_registered: false,
  media: 'Karilun｜Tiktok',
  property_name: '',
  room_number: '',
  property_address: '',
  management_company: '',
  contact_info: '',
  floor_plan: '',
  rent: '',
  area: '',
  nearest_station: '',
  assignee: '',
  device: '',
  property_url: '',
  wp_registered: false,
  post_completed: false,
  material_processing: '未着手',
  text_overlay: '未着手',
  video_duration: '',
  afureko: '未着手',
  floor_plan_insert: '未着手',
  floor_plan_check: '未着手',
  countermeasure: '',
  memo: '',
  final_save: '未着手',
  post_text: '',
}

// ===== メインコンポーネント =====
export default function ProgressPage() {
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [formTab, setFormTab] = useState<FormTabKey>('basic')
  const [form, setForm] = useState<Omit<ProductionRecord, 'id' | 'created_at'>>({ ...defaultForm })
  const [editId, setEditId] = useState<string | null>(null)
  const [mediaFilter, setMediaFilter] = useState<string | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [delayOnly, setDelayOnly] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  async function fetchRecords() {
    setLoading(true)
    const { data } = await supabase
      .from('production_records')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) {
      // DBの shooting_date を UI用の material_saved に移し替える
      const converted = data.map((r: any) => ({
        ...r,
        material_saved: r.shooting_date || '',
      }))
      setRecords(converted as ProductionRecord[])
    }
    setLoading(false)
  }

  useEffect(() => { fetchRecords() }, [])

  const isDelayed = (r: ProductionRecord) =>
    !r.post_completed && !!r.scheduled_post_date && r.scheduled_post_date < today

  const delayedRecords = records.filter(isDelayed)
  const delayByAssignee: Record<string, number> = {}
  delayedRecords.forEach(r => {
    const a = r.assignee || '未設定'
    delayByAssignee[a] = (delayByAssignee[a] || 0) + 1
  })

  const filtered = records
    .filter(r => {
      if (mediaFilter !== 'all' && r.media !== mediaFilter) return false
      if (assigneeFilter !== 'all' && r.assignee !== assigneeFilter) return false
      if (delayOnly && !isDelayed(r)) return false
      return true
    })
    .sort((a, b) => {
      if (a.media !== b.media) return a.media.localeCompare(b.media)
      const ad = isDelayed(a) ? 0 : 1
      const bd = isDelayed(b) ? 0 : 1
      if (ad !== bd) return ad - bd
      return (a.scheduled_post_date || '').localeCompare(b.scheduled_post_date || '')
    })

  async function updateField(id: string, field: string, value: string | boolean) {
    await supabase.from('production_records').update({ [field]: value }).eq('id', id)
    setRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // 日付フィールドが空文字("")の場合、Postgresのdate型ではエラーになるためnullに変換する
    // DB側は shooting_date のままだが、UI側では material_saved として扱っている
    const submissionData: any = {
      ...form,
      shooting_date: (form as any).material_saved || null,
      scheduled_post_date: form.scheduled_post_date || null,
    }
    // material_saved を送信データから物理的に削除（DBには shooting_date として送る）
    delete submissionData.material_saved;

    let err: { message: string } | null = null
    if (editId) {
      const { error } = await supabase.from('production_records').update(submissionData).eq('id', editId)
      err = error
    } else {
      const { error } = await supabase.from('production_records').insert({ ...submissionData, id: crypto.randomUUID() })
      err = error
    }
    if (err) {
      alert(`保存に失敗しました。\n\nエラー: ${err.message}\n\n※ Supabaseに production_records テーブルが作成されているか確認してください。`)
      return
    }
    closeModal()
    fetchRecords()
  }

  function closeModal() {
    setShowModal(false)
    setEditId(null)
    setFormTab('basic')
  }

  function openEdit(r: ProductionRecord) {
    const { id, created_at, ...rest } = r
    setForm({ ...rest })
    setEditId(id)
    setFormTab('basic')
    setShowModal(true)
  }

  function openNew() {
    setForm({ ...defaultForm })
    setEditId(null)
    setFormTab('basic')
    setShowModal(true)
  }

  async function deleteRecord(id: string) {
    if (!window.confirm('この動画記録を削除しますか？')) return
    await supabase.from('production_records').delete().eq('id', id)
    fetchRecords()
  }

  function procSel(id: string, field: string, val: ProcessStatus) {
    const c = PROCESS_COLORS[val]
    return (
      <select
        value={val}
        onChange={e => updateField(id, field, e.target.value)}
        style={{ background: c.bg, color: c.color, border: 'none', borderRadius: 4, padding: '2px 5px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', minWidth: 56 }}
        onClick={e => e.stopPropagation()}
      >
        {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }

  const tabIdx = FORM_TABS.findIndex(t => t.key === formTab)

  return (
    <div style={{ minWidth: 0, width: '100%' }}>

      {/* ===== サマリーバー ===== */}
      <div className="progress-summary">
        <div className="progress-stat">
          <span className="progress-stat-label">全件数</span>
          <strong className="progress-stat-value">{records.length}</strong>
        </div>
        {MEDIA_OPTIONS.map(m => (
          <div key={m} className="progress-stat">
            <span className="progress-stat-label">{m.split('｜')[1] || m}</span>
            <strong className="progress-stat-value">
              {records.filter(r => r.media === m).length}
            </strong>
          </div>
        ))}
        <div className="progress-stat progress-stat--delay">
          <span className="progress-stat-label">⚠️ 遅延合計</span>
          <strong className="progress-stat-value" style={{ color: '#dc2626' }}>{delayedRecords.length}</strong>
        </div>
        {Object.entries(delayByAssignee).map(([name, cnt]) => (
          <div key={name} className="progress-stat">
            <span className="progress-stat-label">{name} 遅延</span>
            <strong className="progress-stat-value" style={{ color: '#dc2626' }}>{cnt}</strong>
          </div>
        ))}
      </div>

      {/* ===== フィルターバー ===== */}
      <div className="progress-toolbar">
        <div className="progress-filters">
          <button
            className={`progress-filter-btn${mediaFilter === 'all' ? ' active' : ''}`}
            onClick={() => setMediaFilter('all')}
          >全て ({records.length})</button>
          {MEDIA_OPTIONS.map(m => {
            const isActive = mediaFilter === m
            return (
              <button
                key={m}
                className={`progress-filter-btn${isActive ? ' active' : ''}`}
                onClick={() => setMediaFilter(m)}
              >{m.split('｜')[1] || m} ({records.filter(r => r.media === m).length})</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
            <option value="all">全担当者</option>
            {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={delayOnly} onChange={e => setDelayOnly(e.target.checked)} />
            遅延のみ
          </label>
        </div>
      </div>

      {/* ===== テーブル ===== */}
      <section className="panel progress-table-panel">
        <div className="panel-heading" style={{ padding: '16px 20px' }}>
          <div>
            <h2>動画制作進捗一覧</h2>
            <p>表示 {filtered.length} 件 / 全 {records.length} 件　遅延: <strong style={{ color: '#dc2626' }}>{delayedRecords.length} 件</strong>　<span style={{ color: 'var(--gray-400)', fontSize: '0.78rem' }}>行をクリックして詳細入力</span></p>
          </div>
        </div>
        {loading && <p style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>読み込み中...</p>}
        <div className="progress-table-wrap">
          <table className="progress-table">
            <thead>
              <tr>
                <th>媒体</th>
                <th>素材保存</th>
                <th>投稿予定日</th>
                <th>物件名</th>
                <th>号室</th>
                <th>住所</th>
                <th>管理会社</th>
                <th>連絡先</th>
                <th>間取り</th>
                <th>賃料</th>
                <th>エリア</th>
                <th>最寄駅</th>
                <th>担当者</th>
                <th>AOS</th>
                <th>デバイス</th>
                <th className="ptcol-production">素材加工</th>
                <th className="ptcol-production">文字入れ</th>
                <th className="ptcol-production">動画尺</th>
                <th className="ptcol-production">アフレコ</th>
                <th className="ptcol-production">図面挿入</th>
                <th className="ptcol-check">図面確認</th>
                <th className="ptcol-check">対策内容</th>
                <th className="ptcol-check">メモ</th>
                <th className="ptcol-finish">完成品保存</th>
                <th className="ptcol-finish">投稿文</th>
                <th>投稿完了</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={25} style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                    データがありません。右下の ＋ ボタンから追加してください。
                  </td>
                </tr>
              )}
              {filtered.map(r => {
                const delayed = isDelayed(r)
                return (
                  <tr
                    key={r.id}
                    className={`row-hoverable${delayed ? ' row-overdue' : ''}`}
                    onClick={() => openEdit(r)}
                  >
                    <td>
                      <span className="cell-truncate" title={r.media} style={{ maxWidth: 110 }}>
                        {r.media ? r.media.split('｜')[1] || r.media : '-'}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                        <input
                          type="date"
                          value={r.material_saved || (r as any).shooting_date || ''}
                          onChange={e => updateField(r.id, 'shooting_date', e.target.value)}
                          style={{ border: '1px solid var(--gray-200)', borderRadius: 6, padding: '3px 6px', fontSize: '0.75rem', cursor: 'pointer' }}
                        />
                      </div>
                    </td>
                    <td style={{ fontWeight: delayed ? 700 : undefined, color: delayed ? '#dc2626' : undefined }}>
                      {r.scheduled_post_date || '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="cell-truncate" title={r.property_name} style={{ maxWidth: 110 }}>
                          {r.property_name || '-'}
                        </span>
                        {r.property_url && (
                          <a href={r.property_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#3b82f6', fontSize: '0.8rem', flexShrink: 0 }}
                            onClick={e => e.stopPropagation()}>🔗</a>
                        )}
                      </div>
                    </td>
                    <td><span className="cell-truncate" style={{ maxWidth: 60 }}>{r.room_number || '-'}</span></td>
                    <td><span className="cell-truncate" title={r.property_address} style={{ maxWidth: 100 }}>{r.property_address || '-'}</span></td>
                    <td><span className="cell-truncate" title={r.management_company} style={{ maxWidth: 100 }}>{r.management_company || '-'}</span></td>
                    <td><span className="cell-truncate" title={r.contact_info} style={{ maxWidth: 100 }}>{r.contact_info || '-'}</span></td>
                    <td>{r.floor_plan || '-'}</td>
                    <td>{r.rent || '-'}</td>
                    <td>{r.area || '-'}</td>
                    <td>{r.nearest_station || '-'}</td>
                    <td>{r.assignee || '-'}</td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={r.aos_registered} onChange={e => updateField(r.id, 'aos_registered', e.target.checked)} />
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={r.wp_registered} onChange={updateField.bind(null, r.id, 'wp_registered', !r.wp_registered)} />
                    </td>
                    <td>{r.device || '-'}</td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'material_processing', r.material_processing)}</td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'text_overlay', r.text_overlay)}</td>
                    <td>{r.video_duration || '-'}</td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'afureko', r.afureko)}</td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'floor_plan_insert', r.floor_plan_insert)}</td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'floor_plan_check', r.floor_plan_check)}</td>
                    <td><span className="cell-truncate" title={r.countermeasure}>{r.countermeasure || '-'}</span></td>
                    <td><span className="cell-truncate" title={r.memo}>{r.memo || '-'}</span></td>
                    <td onClick={e => e.stopPropagation()}>{procSel(r.id, 'final_save', r.final_save)}</td>
                    <td><span className="cell-truncate" title={r.post_text}>{r.post_text || '-'}</span></td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={r.post_completed} onChange={e => updateField(r.id, 'post_completed', e.target.checked)} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="danger" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={() => deleteRecord(r.id)}>削除</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== FABボタン ===== */}
      <button className="fab" onClick={openNew} aria-label="新規追加" title="新規追加">＋</button>

      {/* ===== モーダル ===== */}
      {showModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="modal-content" style={{ maxWidth: editId ? 660 : 420 }}>
            <div className="modal-header">
              <h2 className="modal-title">{editId ? '📝 詳細を編集' : '🎬 新規追加'}</h2>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>

            {/* 新規追加: シンプルフォーム */}
            {!editId && (
              <form className="data-form" onSubmit={handleSubmit}>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--gray-400)' }}>
                  必要な項目だけ入力して保存。詳細は一覧の行をクリックして入力できます。
                </p>
                <label className="form-label">媒体
                  <select value={form.media} onChange={e => setForm({ ...form, media: e.target.value })}>
                    {MEDIA_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="form-label">物件名
                  <input placeholder="物件名（任意）" value={form.property_name} onChange={e => setForm({ ...form, property_name: e.target.value })} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12 }}>
                  <label className="form-label">号室
                    <input placeholder="101" value={form.room_number} onChange={e => setForm({ ...form, room_number: e.target.value })} />
                  </label>
                  <label className="form-label">素材保存
                    <input type="date" value={form.material_saved} onChange={e => setForm({ ...form, material_saved: e.target.value })} />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  <label className="form-label">投稿予定日
                    <input type="date" value={form.scheduled_post_date} onChange={e => setForm({ ...form, scheduled_post_date: e.target.value })} />
                  </label>
                </div>
                <label className="form-label">担当者
                  <select value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
                    <option value="">未設定</option>
                    {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <div className="form-actions" style={{ marginTop: 8 }}>
                  <button type="submit" className="primary">💾 保存する</button>
                  <button type="button" className="secondary" onClick={closeModal}>キャンセル</button>
                </div>
              </form>
            )}

            {/* 編集: 4タブ詳細フォーム */}
            {editId && (
              <>
                <div className="progress-form-tabs" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid var(--gray-200)', margin: '0 -24px 20px', padding: '10px 24px' }}>
                  {FORM_TABS.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      className={`progress-form-tab-btn${formTab === t.key ? ' active' : ''}`}
                      onClick={() => setFormTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <form className="data-form" onSubmit={handleSubmit}>
                  {formTab === 'basic' && (
                    <>
                      <label className="form-label">媒体
                        <select value={form.media} onChange={e => setForm({ ...form, media: e.target.value })}>
                          {MEDIA_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">素材保存
                          <input type="date" value={form.material_saved} onChange={e => setForm({ ...form, material_saved: e.target.value })} />
                        </label>
                        <label className="form-label">投稿予定日
                          <input type="date" value={form.scheduled_post_date} onChange={e => setForm({ ...form, scheduled_post_date: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 12 }}>
                        <label className="form-label">物件名
                          <input placeholder="物件名" value={form.property_name} onChange={e => setForm({ ...form, property_name: e.target.value })} />
                        </label>
                        <label className="form-label">号室
                          <input placeholder="101" value={form.room_number} onChange={e => setForm({ ...form, room_number: e.target.value })} />
                        </label>
                      </div>
                      <label className="form-label">物件住所
                        <input placeholder="例: 大阪府..." value={form.property_address} onChange={e => setForm({ ...form, property_address: e.target.value })} />
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">管理会社
                          <input placeholder="管理会社名" value={form.management_company} onChange={e => setForm({ ...form, management_company: e.target.value })} />
                        </label>
                        <label className="form-label">連絡先
                          <input placeholder="電話番号など" value={form.contact_info} onChange={e => setForm({ ...form, contact_info: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">間取り
                          <input placeholder="例: 1K" value={form.floor_plan} onChange={e => setForm({ ...form, floor_plan: e.target.value })} />
                        </label>
                        <label className="form-label">賃料
                          <input placeholder="例: 60,000円" value={form.rent} onChange={e => setForm({ ...form, rent: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">エリア
                          <input placeholder="例: 大阪市中央区" value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} />
                        </label>
                        <label className="form-label">最寄駅
                          <input placeholder="例: 天王寺駅 徒歩5分" value={form.nearest_station} onChange={e => setForm({ ...form, nearest_station: e.target.value })} />
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">担当者
                          <select value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
                            <option value="">未設定</option>
                            {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </label>
                        <label className="form-label">使用デバイス
                          <select value={form.device} onChange={e => setForm({ ...form, device: e.target.value })}>
                            <option value="">未設定</option>
                            {DEVICE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="form-label">物件資料URL
                        <input type="url" placeholder="https://..." value={form.property_url} onChange={e => setForm({ ...form, property_url: e.target.value })} />
                      </label>
                      <div style={{ padding: '4px 0 10px' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={form.aos_registered} onChange={e => setForm({ ...form, aos_registered: e.target.checked })} />
                          AOS登録済み
                        </label>
                      </div>
                    </>
                  )}

                  {formTab === 'production' && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label className="form-label">使用デバイス
                          <select value={form.device} onChange={e => setForm({ ...form, device: e.target.value })}>
                            <option value="">未設定</option>
                            {DEVICE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                        <label className="form-label">動画尺
                          <input placeholder="例: 60秒" value={form.video_duration} onChange={e => setForm({ ...form, video_duration: e.target.value })} />
                        </label>
                      </div>
                      {([
                        { key: 'material_processing' as const, label: '素材加工' },
                        { key: 'text_overlay'         as const, label: '文字入れ' },
                        { key: 'afureko'              as const, label: 'アフレコ' },
                        { key: 'floor_plan_insert'    as const, label: '図面挿入' },
                      ]).map(({ key, label }) => (
                        <label key={key} className="form-label">{label}
                          <select value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value as ProcessStatus })}>
                            {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                      ))}
                    </>
                  )}

                  {formTab === 'check' && (
                    <>
                      <label className="form-label">図面確認
                        <select value={form.floor_plan_check} onChange={e => setForm({ ...form, floor_plan_check: e.target.value as ProcessStatus })}>
                          {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="form-label">対策内容
                        <textarea rows={4} placeholder="対策内容を入力" value={form.countermeasure} onChange={e => setForm({ ...form, countermeasure: e.target.value })} />
                      </label>
                      <label className="form-label">メモ
                        <textarea rows={3} placeholder="メモ" value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })} />
                      </label>
                    </>
                  )}

                  {formTab === 'finish' && (
                    <>
                      <label className="form-label">完成品保存
                        <select value={form.final_save} onChange={e => setForm({ ...form, final_save: e.target.value as ProcessStatus })}>
                          {PROCESS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="form-label">投稿文
                        <textarea rows={5} placeholder="投稿文を入力" value={form.post_text} onChange={e => setForm({ ...form, post_text: e.target.value })} />
                      </label>
                      <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={form.wp_registered} onChange={e => setForm({ ...form, wp_registered: e.target.checked })} />
                          WP登録完了
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={form.post_completed} onChange={e => setForm({ ...form, post_completed: e.target.checked })} />
                          投稿完了
                        </label>
                      </div>
                    </>
                  )}

                  <div className="form-actions" style={{ 
                    marginTop: 40,
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    position: 'sticky', 
                    bottom: -24, 
                    background: '#fff', 
                    padding: '16px 24px', 
                    borderTop: '1px solid var(--gray-100)', 
                    margin: '30px -24px -24px',
                    zIndex: 20
                  }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {tabIdx > 0 && (
                        <button type="button" className="secondary" onClick={() => setFormTab(FORM_TABS[tabIdx - 1].key)}>
                          ← 前へ
                        </button>
                      )}
                      <button type="button" className="secondary" onClick={closeModal}>キャンセル</button>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* 保存ボタンは常に表示 */}
                      <button type="submit" className="primary" style={{ background: '#10b981', color: 'white', fontWeight: 'bold' }}>
                        💾 保存する
                      </button>

                      {tabIdx < FORM_TABS.length - 1 && (
                        <button
                          type="button"
                          className="primary"
                          onClick={() => setFormTab(FORM_TABS[tabIdx + 1].key)}
                        >
                          次へ →
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
