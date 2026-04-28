import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

type ProductionStatus = '撮影済' | '制作中' | 'チェック中' | '完了'
type ProcessStatus = '未着手' | '進行中' | '完了'
type PromoteTarget = 'tiktok' | 'instagram' | 'youtube'

interface ProductionRecord {
  id: string
  created_at?: string
  status: ProductionStatus
  material_saved: string
  scheduled_post_date: string
  aos_registered: boolean
  media: string
  post_type: string
  property_number: string
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
  youtube_reserved: boolean
  post_completed: boolean
  material_processing: ProcessStatus
  text_overlay: ProcessStatus
  video_duration: string
  afureko: ProcessStatus
  floor_plan_order: ProcessStatus
  floor_plan_insert: ProcessStatus
  floor_plan_check: ProcessStatus
  countermeasure: string
  memo: string
  final_save: ProcessStatus
  post_text: string
  audio_source: string
}

type ProgressPageProps = {
  onSnsPropertyPromoted?: (target: PromoteTarget) => void
}

type FormTabKey = 'basic' | 'production' | 'check' | 'finish'
type SelectOptionGroup = 'process' | 'device' | 'duration' | 'audio' | 'register'
type SelectMenuState = {
  id: string
  field: keyof ProductionRecord
  group: SelectOptionGroup
  title: string
  top: number
  left: number
  width: number
} | null
type SelectOptionEditorState = {
  group: SelectOptionGroup
  title: string
  items: string[]
} | null

const PROCESS_COLORS: Record<ProcessStatus, { bg: string; color: string }> = {
  '未着手': { bg: '#f3f4f6', color: '#6b7280' },
  '進行中': { bg: '#fef3c7', color: '#92400e' },
  '完了': { bg: '#dcfce7', color: '#166534' },
}

const PROCESS_STATUSES: ProcessStatus[] = ['未着手', '進行中', '完了']
const ASSIGNEE_OPTIONS = ['泉', '坂本', '吉田', '新居']
const DEVICE_OPTIONS = ['未設定', 'iPhone', 'Android', 'カメラ', 'その他']
const VIDEO_DURATION_OPTIONS = ['未設定', '15秒', '30秒', '45秒', '60秒', '編集中']
const AUDIO_SOURCE_OPTIONS = ['未登録', '候補あり', '登録済']
const REGISTER_OPTIONS = [
  { value: false, label: '未登録' },
  { value: true, label: '登録済' },
]

const INITIAL_SELECT_OPTIONS: Record<SelectOptionGroup, string[]> = {
  process: ['未着手', '進行中', '完了'],
  device: ['未設定', 'iPhone', 'Android', 'カメラ', 'その他'],
  duration: ['未設定', '15秒', '30秒', '45秒', '60秒', '編集中'],
  audio: ['未登録', '候補あり', '登録済'],
  register: ['未登録', '登録済'],
}

const SELECT_OPTION_STORAGE_PREFIX = 'progress_select_options:'
const SELECT_OPTION_GROUP_LABELS: Record<SelectOptionGroup, string> = {
  process: '工程',
  device: '使用端末',
  duration: '動画尺',
  audio: '音源',
  register: '登録状況',
}
const SELECT_OPTION_FIELD_LABELS: Partial<Record<keyof ProductionRecord, string>> = {
  floor_plan_order: '図面発注',
  material_processing: '素材加工',
  floor_plan_insert: '図面挿入',
  afureko: 'アフレコ',
  text_overlay: 'テロップ',
  floor_plan_check: '図面確認',
  final_save: '最終保存',
  device: '使用端末',
  video_duration: '動画尺',
  audio_source: '音源',
  wp_registered: 'WP登録',
  youtube_reserved: 'YouTube予約',
}

function normalizeSelectOptions(options: string[]) {
  return Array.from(new Set(options.map((item) => item.trim()).filter(Boolean)))
}

function getStoredSelectOptions(): Record<SelectOptionGroup, string[]> {
  if (typeof window === 'undefined') {
    return INITIAL_SELECT_OPTIONS
  }

  const next = { ...INITIAL_SELECT_OPTIONS }

  ;(Object.keys(INITIAL_SELECT_OPTIONS) as SelectOptionGroup[]).forEach((group) => {
    try {
      const raw = window.localStorage.getItem(`${SELECT_OPTION_STORAGE_PREFIX}${group}`)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return

      const normalized = normalizeSelectOptions(parsed.filter((item): item is string => typeof item === 'string'))
      if (normalized.length > 0) {
        next[group] = normalized
      }
    } catch {
      next[group] = INITIAL_SELECT_OPTIONS[group]
    }
  })

  return next
}

function saveStoredSelectOptions(group: SelectOptionGroup, options: string[]) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(
    `${SELECT_OPTION_STORAGE_PREFIX}${group}`,
    JSON.stringify(normalizeSelectOptions(options)),
  )
}

const MEDIA_OPTIONS = [
  'Karilun｜TikTok',
  'Karilun｜Instagram',
  'Karilun｜京阪',
  'Karilun｜西宮市',
  '長瀬｜近大一人暮らし',
  '西北｜関学一人暮らし',
  '八尾｜アパマン八尾',
]

const SUMMARY_LABELS = ['Tiktok', 'Instagram', '京阪', '西宮市', '近大', '関学', '八尾']

const FORM_TABS: { key: FormTabKey; label: string }[] = [
  { key: 'basic', label: '① 基本情報' },
  { key: 'production', label: '② 制作' },
  { key: 'check', label: '③ チェック' },
  { key: 'finish', label: '④ 仕上げ' },
]

const defaultForm: Omit<ProductionRecord, 'id' | 'created_at'> = {
  status: '撮影済',
  material_saved: '',
  scheduled_post_date: '',
  aos_registered: false,
  media: 'Karilun｜TikTok',
  post_type: '',
  property_number: '',
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
  device: '未設定',
  property_url: '',
  wp_registered: false,
  youtube_reserved: false,
  post_completed: false,
  material_processing: '未着手',
  text_overlay: '未着手',
  video_duration: '未設定',
  afureko: '未着手',
  floor_plan_order: '未着手',
  floor_plan_insert: '未着手',
  floor_plan_check: '未着手',
  countermeasure: '',
  memo: '',
  final_save: '未着手',
  post_text: '',
  audio_source: '未登録',
}

function normalizeMediaName(media: string) {
  return media.trim().toLowerCase().replace(/[｜|]/g, '|').replace(/\s+/g, '')
}

function getMediaDisplayName(media: string) {
  const normalized = normalizeMediaName(media)
  const matched = MEDIA_OPTIONS.find((option) => normalizeMediaName(option) === normalized)
  if (matched) return matched
  if (normalized.includes('tiktok')) return 'Karilun｜TikTok'
  if (normalized.includes('instagram')) return 'Karilun｜Instagram'
  return media || '未設定'
}

function isTikTokMedia(media: string) {
  return normalizeMediaName(getMediaDisplayName(media)).includes('tiktok')
}

function isInstagramMedia(media: string) {
  return normalizeMediaName(getMediaDisplayName(media)).includes('instagram')
}

function toRegisteredLabel(value: boolean) {
  return value ? '登録済' : ''
}

function getStatusCellStyle(value: ProcessStatus) {
  const fallbackColor = PROCESS_COLORS[PROCESS_STATUSES[0]]
  const color = PROCESS_COLORS[value] || fallbackColor
  return { background: color.bg, color: color.color }
}

function sanitizeProcessStatus(value: unknown): ProcessStatus {
  return PROCESS_STATUSES.includes(value as ProcessStatus) ? (value as ProcessStatus) : PROCESS_STATUSES[0]
}

function sanitizeSelectText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 12.5l6.8-6.8a3 3 0 114.2 4.2l-8.2 8.2a5 5 0 11-7.1-7.1l8.2-8.2" />
    </svg>
  )
}

export default function ProgressPage({ onSnsPropertyPromoted }: ProgressPageProps) {
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [formTab, setFormTab] = useState<FormTabKey>('basic')
  const [form, setForm] = useState<Omit<ProductionRecord, 'id' | 'created_at'>>({ ...defaultForm })
  const [editId, setEditId] = useState<string | null>(null)
  const [copyTargetId, setCopyTargetId] = useState<string | null>(null)
  const [selectOptions, setSelectOptions] =
    useState<Record<SelectOptionGroup, string[]>>(() => getStoredSelectOptions())
  const [selectMenu, setSelectMenu] = useState<SelectMenuState>(null)
  const [selectOptionEditor, setSelectOptionEditor] = useState<SelectOptionEditorState>(null)
  const selectMenuRef = useRef<HTMLDivElement | null>(null)

  const today = new Date().toISOString().split('T')[0]

  async function fetchRecords() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('production_records')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      if (data) {
        const converted = data.map((record: any) => ({
          ...defaultForm,
          ...record,
          media: getMediaDisplayName(sanitizeSelectText(record.media, defaultForm.media)),
          material_saved: sanitizeSelectText(record.shooting_date),
          scheduled_post_date: sanitizeSelectText(record.scheduled_post_date),
          post_type: sanitizeSelectText(record.post_type),
          property_number: sanitizeSelectText(record.property_number),
          youtube_reserved: Boolean(record.youtube_reserved),
          post_completed: Boolean(record.post_completed),
          aos_registered: Boolean(record.aos_registered),
          wp_registered: Boolean(record.wp_registered),
          device: sanitizeSelectText(record.device, defaultForm.device),
          video_duration: sanitizeSelectText(record.video_duration, defaultForm.video_duration),
          audio_source: sanitizeSelectText(record.audio_source, defaultForm.audio_source),
          material_processing: sanitizeProcessStatus(record.material_processing),
          text_overlay: sanitizeProcessStatus(record.text_overlay),
          afureko: sanitizeProcessStatus(record.afureko),
          floor_plan_order: sanitizeProcessStatus(record.floor_plan_order),
          floor_plan_insert: sanitizeProcessStatus(record.floor_plan_insert),
          floor_plan_check: sanitizeProcessStatus(record.floor_plan_check),
          final_save: sanitizeProcessStatus(record.final_save),
        }))

        setRecords(converted as ProductionRecord[])
      } else {
        setRecords([])
      }
    } catch (error) {
      console.error('progress fetch failed', error)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (selectMenuRef.current && !selectMenuRef.current.contains(target)) {
        setSelectMenu(null)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectMenu(null)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const isDelayed = (record: ProductionRecord) =>
    !record.post_completed && !!record.scheduled_post_date && record.scheduled_post_date < today

  const delayedCount = records.filter(isDelayed).length

  const groupedRecords = useMemo(() => {
    return MEDIA_OPTIONS.map((media) => ({
      media,
      records: records
        .filter((record) => getMediaDisplayName(record.media) === media)
        .sort((a, b) => (a.scheduled_post_date || '').localeCompare(b.scheduled_post_date || '')),
    }))
  }, [records])

  const tikTokSourceRecords = useMemo(
    () =>
      records
        .filter((record) => isTikTokMedia(record.media))
        .sort((a, b) => (a.scheduled_post_date || '').localeCompare(b.scheduled_post_date || '')),
    [records],
  )

  async function getNextPropertyNumber(
    tableName: 'sns_tiktok_properties' | 'sns_instagram_properties' | 'sns_youtube_properties',
  ) {
    const prefix =
      tableName === 'sns_youtube_properties'
        ? 'Y'
        : tableName === 'sns_instagram_properties'
          ? 'G'
          : 'K'
    const digits =
      tableName === 'sns_tiktok_properties'
        ? 4
        : 3
    const { data } = await supabase
      .from(tableName)
      .select('property_number')
      .like('property_number', `${prefix}%`)
      .order('property_number', { ascending: false })
      .limit(1)

    const latestValue = String(data?.[0]?.property_number || '')
    const match = latestValue.match(/\d+/)
    const maxValue = match ? Number(match[0]) : 0

    return `${prefix}${String(maxValue + 1).padStart(digits, '0')}`
  }

  async function promoteToSnsProperty(record: ProductionRecord, trigger: 'post_completed' | 'youtube_reserved') {
    if (trigger === 'post_completed') {
      let tableName: 'sns_tiktok_properties' | 'sns_instagram_properties' | null = null
      let target: PromoteTarget | null = null
      let label = ''

      if (isTikTokMedia(record.media)) {
        tableName = 'sns_tiktok_properties'
        target = 'tiktok'
        label = 'Karilun｜TikTok'
      } else if (isInstagramMedia(record.media)) {
        tableName = 'sns_instagram_properties'
        target = 'instagram'
        label = 'Karilun｜Instagram'
      }

      if (!tableName) return
      if (!window.confirm(`SNS物件管理の「${label}」へ追加しますか？`)) return

      const insertData = {
        property_number: await getNextPropertyNumber(tableName),
        property_name: record.property_name || '',
        room_number: record.room_number || '',
        address: record.property_address || '',
        management_company: record.management_company || '',
        contact: record.contact_info || '',
        floor_plan: record.floor_plan || '',
        rent: record.rent || '',
        area: record.area || '',
        nearest_station: record.nearest_station || '',
        memo: record.memo || '',
        wp_registered: toRegisteredLabel(record.wp_registered),
        post_date: null,
        document_url: '',
        ...(tableName === 'sns_tiktok_properties'
          ? { aos_registered: toRegisteredLabel(record.aos_registered) }
          : { category: '' }),
      }

      const { error } = await supabase.from(tableName).insert([insertData])
      if (error) {
        alert(`SNS物件管理への追加に失敗しました。\n${error.message}`)
        return
      }

      if (target) onSnsPropertyPromoted?.(target)
    }

    if (trigger === 'youtube_reserved') {
      if (!isTikTokMedia(record.media)) return
      if (!window.confirm('SNS物件管理の「Karilun｜YouTube」へ追加しますか？')) return

      const insertData = {
        property_number: await getNextPropertyNumber('sns_youtube_properties'),
        property_name: record.property_name || '',
        room_number: record.room_number || '',
        address: record.property_address || '',
        management_company: record.management_company || '',
        contact: record.contact_info || '',
        memo: record.memo || '',
        wp_registered: toRegisteredLabel(record.wp_registered),
        post_date: null,
        document_url: '',
      }

      const { error } = await supabase.from('sns_youtube_properties').insert([insertData])
      if (error) {
        alert(`YouTube一覧への追加に失敗しました。\n${error.message}`)
        return
      }

      onSnsPropertyPromoted?.('youtube')
    }

    if (window.confirm('反映できたので、進捗管理からこの行を削除しますか？')) {
      const { error } = await supabase.from('production_records').delete().eq('id', record.id)
      if (!error) {
        setRecords((prev) => prev.filter((item) => item.id !== record.id))
      }
    }
  }

  void promoteToSnsProperty

  function buildCommonSnsPropertyData(record: ProductionRecord) {
    return {
      property_name: record.property_name || '',
      room_number: record.room_number || '',
      address: record.property_address || '',
      management_company: record.management_company || '',
      contact: record.contact_info || '',
      memo: record.memo || '',
      wp_registered: toRegisteredLabel(record.wp_registered),
      post_date: record.scheduled_post_date || '',
      document_url: record.property_url || '',
    }
  }

  function buildExtendedSnsPropertyData(record: ProductionRecord) {
    return {
      ...buildCommonSnsPropertyData(record),
      floor_plan: record.floor_plan || '',
      rent: record.rent || '',
      area: record.area || '',
      nearest_station: record.nearest_station || '',
    }
  }

  async function promoteToSnsPropertySafe(record: ProductionRecord, trigger: 'post_completed' | 'youtube_reserved') {
    if (trigger === 'post_completed') {
      let tableName: 'sns_tiktok_properties' | 'sns_instagram_properties' | null = null
      let target: PromoteTarget | null = null
      let label = ''

      if (isTikTokMedia(record.media)) {
        tableName = 'sns_tiktok_properties'
        target = 'tiktok'
        label = 'Karilun｜TikTok'
      } else if (isInstagramMedia(record.media)) {
        tableName = 'sns_instagram_properties'
        target = 'instagram'
        label = 'Karilun｜Instagram'
      }

      if (!tableName) return
      if (!window.confirm(`SNS物件管理の「${label}」へ反映しますか？`)) return

      const insertData = {
        property_number: await getNextPropertyNumber(tableName),
        ...buildExtendedSnsPropertyData(record),
        ...(tableName === 'sns_tiktok_properties'
          ? { aos_registered: toRegisteredLabel(record.aos_registered) }
          : { category: record.post_type || '' }),
      }

      const { error } = await supabase.from(tableName).insert([insertData])
      if (error) {
        alert(`SNS物件管理への反映に失敗しました。\n${error.message}`)
        return
      }

      if (target) onSnsPropertyPromoted?.(target)
    }

    if (trigger === 'youtube_reserved') {
      if (!isTikTokMedia(record.media)) return
      if (!window.confirm('SNS物件管理の「Karilun｜YouTube」へ反映しますか？')) return

      const insertData = {
        property_number: await getNextPropertyNumber('sns_youtube_properties'),
        ...buildCommonSnsPropertyData(record),
      }

      const { error } = await supabase.from('sns_youtube_properties').insert([insertData])
      if (error) {
        alert(`YouTube一覧への反映に失敗しました。\n${error.message}`)
        return
      }

      onSnsPropertyPromoted?.('youtube')
    }

    if (window.confirm('反映できたので、この行を進捗管理から削除しますか？')) {
      const { error } = await supabase.from('production_records').delete().eq('id', record.id)
      if (!error) {
        setRecords((prev) => prev.filter((item) => item.id !== record.id))
      }
    }
  }

  async function updateField(id: string, field: keyof ProductionRecord | 'shooting_date', value: string | boolean) {
    const dbField = field === 'material_saved' ? 'shooting_date' : field
    const { error } = await supabase.from('production_records').update({ [dbField]: value }).eq('id', id)
    if (error) {
      alert(`更新に失敗しました。\n${error.message}`)
      return
    }

    const currentRecord = records.find((record) => record.id === id) || null
    const updatedRecord: ProductionRecord | null = currentRecord
      ? {
        ...currentRecord,
        ...(field === 'material_saved' ? { material_saved: String(value) } : { [field]: value }),
      }
      : null

    setRecords((prev) => prev.map((record) => {
      if (record.id !== id || !updatedRecord) return record
      return updatedRecord
    }))

    if (updatedRecord && value === true && (field === 'post_completed' || field === 'youtube_reserved')) {
      await promoteToSnsPropertySafe(updatedRecord, field)
    }
  }

  function openSelectMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    record: ProductionRecord,
    field: keyof ProductionRecord,
    group: SelectOptionGroup,
    title: string,
  ) {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setSelectMenu({
      id: record.id,
      field,
      group,
      title,
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 108),
    })
  }

  function updateSelectOptions(group: SelectOptionGroup) {
    openSelectOptionEditor(group)
    return

    const current = selectOptions[group]
    const answer = window.prompt('選択肢を1行ずつ入力してください。', current.join('\n'))
    if (answer === null) return

    // @ts-expect-error 旧編集方式の名残。現在は return 済みで実行されない。
    const next = answer
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)

    if (next.length === 0) return

    setSelectOptions((prev) => ({ ...prev, [group]: next }))
    setSelectMenu(null)
  }

  function openSelectOptionEditor(group: SelectOptionGroup) {
    const title = selectMenu?.title || SELECT_OPTION_GROUP_LABELS[group]

    setSelectOptionEditor({
      group,
      title,
      items: selectOptions[group].length > 0 ? [...selectOptions[group]] : [''],
    })
    setSelectMenu(null)
  }

  function updateSelectOptionItem(index: number, value: string) {
    setSelectOptionEditor((prev) => {
      if (!prev) return prev
      const items = [...prev.items]
      items[index] = value
      return { ...prev, items }
    })
  }

  function addSelectOptionItem() {
    setSelectOptionEditor((prev) => {
      if (!prev) return prev
      return { ...prev, items: [...prev.items, ''] }
    })
  }

  function removeSelectOptionItem(index: number) {
    setSelectOptionEditor((prev) => {
      if (!prev) return prev
      const items = prev.items.filter((_, itemIndex) => itemIndex !== index)
      return { ...prev, items: items.length > 0 ? items : [''] }
    })
  }

  function moveSelectOptionItem(index: number, direction: 'up' | 'down') {
    setSelectOptionEditor((prev) => {
      if (!prev) return prev
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.items.length) return prev

      const items = [...prev.items]
      ;[items[index], items[targetIndex]] = [items[targetIndex], items[index]]
      return { ...prev, items }
    })
  }

  function saveSelectOptionItems() {
    if (!selectOptionEditor) return

    const nextOptions = normalizeSelectOptions(selectOptionEditor.items)
    if (nextOptions.length === 0) {
      window.alert('候補を1つ以上入れてください。')
      return
    }

    saveStoredSelectOptions(selectOptionEditor.group, nextOptions)
    setSelectOptions((prev) => ({ ...prev, [selectOptionEditor.group]: nextOptions }))
    setSelectOptionEditor(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const submissionData: any = {
      ...form,
      media: getMediaDisplayName(form.media),
      shooting_date: form.material_saved || null,
      scheduled_post_date: form.scheduled_post_date || null,
    }

    delete submissionData.material_saved

    let errorMessage = ''

    if (editId) {
      const { error } = await supabase.from('production_records').update(submissionData).eq('id', editId)
      errorMessage = error?.message || ''
    } else {
      const { error } = await supabase
        .from('production_records')
        .insert({ ...submissionData, id: crypto.randomUUID() })
      errorMessage = error?.message || ''
    }

    if (errorMessage) {
      alert(`保存に失敗しました。\n${errorMessage}`)
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

  function openEdit(record: ProductionRecord) {
    const { id, created_at, ...rest } = record
    setForm({ ...defaultForm, ...rest, media: getMediaDisplayName(rest.media) })
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

  async function applyTikTokCopy(targetId: string, source: ProductionRecord) {
    const patch = {
      property_url: source.property_url || '',
      property_name: source.property_name || '',
      room_number: source.room_number || '',
      property_address: source.property_address || '',
      area: source.area || '',
      nearest_station: source.nearest_station || '',
      floor_plan: source.floor_plan || '',
      rent: source.rent || '',
      management_company: source.management_company || '',
      contact_info: source.contact_info || '',
    }

    const { error } = await supabase.from('production_records').update(patch).eq('id', targetId)
    if (error) {
      alert(`コピーに失敗しました。\n${error.message}`)
      return
    }

    setRecords((prev) =>
      prev.map((record) => (record.id === targetId ? { ...record, ...patch } : record)),
    )
    setCopyTargetId(null)
  }

  async function deleteRecord(id: string) {
    if (!window.confirm('この行を削除しますか？')) return
    const { error } = await supabase.from('production_records').delete().eq('id', id)
    if (!error) {
      fetchRecords()
    }
  }

  function renderDateCell(record: ProductionRecord, field: 'material_saved' | 'scheduled_post_date', delayed = false) {
    return (
      <div className="progress-cell-hitbox" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className={`progress-cell-input is-date${delayed ? ' is-delayed' : ''}`}
          type="date"
          value={record[field] || ''}
          onChange={(e) => updateField(record.id, field, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )
  }

  function renderTextCell(
    record: ProductionRecord,
    field: keyof ProductionRecord,
    placeholder = '',
    className = 'progress-cell-input',
  ) {
    return (
      <div className="progress-cell-hitbox" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className={className}
          value={String(record[field] || '')}
          placeholder={placeholder}
          onChange={(e) => updateField(record.id, field, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )
  }

  function renderSelectCell(
    record: ProductionRecord,
    field: keyof ProductionRecord,
    group: SelectOptionGroup,
    title?: string,
    extraClassName = '',
    style?: React.CSSProperties,
  ) {
    const options = selectOptions[group]
    const value =
      group === 'register'
        ? Boolean(record[field]) ? '登録済' : '未登録'
        : String(record[field] || options[0] || '')
    const isOpen = selectMenu?.id === record.id && selectMenu.field === field

    return (
      <div
        className={`progress-editable-select progress-cell-hitbox${isOpen ? ' is-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`progress-editable-select-trigger ${extraClassName}`.trim()}
          style={style}
          onClick={(event) => openSelectMenu(
            event,
            record,
            field,
            group,
            title || SELECT_OPTION_FIELD_LABELS[field] || SELECT_OPTION_GROUP_LABELS[group],
          )}
        >
          <span className="progress-editable-select-label">{value}</span>
          <span className="progress-editable-select-caret" aria-hidden="true" />
        </button>
      </div>
    )
  }

  function renderProcessCell(record: ProductionRecord, field: keyof ProductionRecord) {
    const value = String(record[field] || PROCESS_STATUSES[0]) as ProcessStatus
    return renderSelectCell(record, field, 'process', SELECT_OPTION_FIELD_LABELS[field] || '工程', 'progress-cell-status', getStatusCellStyle(value))
  }

  function renderRegisterCell(record: ProductionRecord, field: 'wp_registered' | 'aos_registered' | 'youtube_reserved') {
    return renderSelectCell(record, field, 'register', SELECT_OPTION_FIELD_LABELS[field] || '登録状況')
  }

  function renderCheckboxCell(record: ProductionRecord, field: 'post_completed' | 'aos_registered') {
    return (
      <div className="progress-checkbox-cell" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={Boolean(record[field])}
          onChange={(e) => updateField(record.id, field, e.target.checked)}
        />
      </div>
    )
  }

  function renderPropertyLink(record: ProductionRecord) {
    if (record.property_url) {
      return (
        <div className="progress-link-cell" onClick={(e) => e.stopPropagation()}>
          <a
            className="progress-link-icon"
            href={record.property_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="資料を開く"
          >
            <LinkIcon />
          </a>
        </div>
      )
    }

    return (
      <div className="progress-link-cell" onClick={(e) => e.stopPropagation()}>
        <button className="progress-link-empty" type="button" onClick={() => openEdit(record)}>
          未登録
        </button>
      </div>
    )
  }

  function renderDeleteCell(record: ProductionRecord) {
    return (
      <button
        className="danger"
        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          deleteRecord(record.id)
        }}
      >
        削除
      </button>
    )
  }

  function renderTikTokTable(mediaRecords: ProductionRecord[]) {
    return (
      <table className="progress-table progress-table-tiktok">
        <colgroup>
          <col style={{ width: 115 }} />
          <col style={{ width: 115 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 157 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 232 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 146 }} />
          <col style={{ width: 83 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 166 }} />
          <col style={{ width: 152 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 148 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">素材保存</th>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-2">資料</th>
            <th className="ptcol-group-2">物件名</th>
            <th className="ptcol-group-2">号室</th>
            <th className="ptcol-group-2">住所</th>
            <th className="ptcol-group-2">エリア</th>
            <th className="ptcol-group-2">最寄り駅</th>
            <th className="ptcol-group-2">間取り</th>
            <th className="ptcol-group-2">家賃</th>
            <th className="ptcol-group-2">管理会社</th>
            <th className="ptcol-group-2">連絡先</th>
            <th className="ptcol-group-2">図面発注</th>
            <th className="ptcol-group-3">編集機器</th>
            <th className="ptcol-group-3">動画尺</th>
            <th className="ptcol-group-3">素材加工</th>
            <th className="ptcol-group-3">図面挿入</th>
            <th className="ptcol-group-3">アフレコ</th>
            <th className="ptcol-group-3">文字入れ</th>
            <th className="ptcol-group-3">図面確認</th>
            <th className="ptcol-group-4">メモ</th>
            <th className="ptcol-group-4">投稿文</th>
            <th className="ptcol-group-4">WP登録</th>
            <th className="ptcol-group-4">AOS登録</th>
            <th className="ptcol-group-4">YouTube</th>
            <th className="ptcol-group-4">完成品保存</th>
            <th className="ptcol-group-4">音源</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable" onClick={() => openEdit(record)}>
              <td className="ptcell-group-1">{renderDateCell(record, 'material_saved')}</td>
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-2">{renderPropertyLink(record)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', '物件名')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'room_number', '号室')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_address', '住所')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'area', 'エリア')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'nearest_station', '最寄り駅')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'floor_plan', '間取り')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'rent', '家賃')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'management_company', '管理会社')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'contact_info', '連絡先')}</td>
              <td className="ptcell-group-2">{renderProcessCell(record, 'floor_plan_order')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'device', 'device')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'video_duration', 'duration')}</td>
              <td className="ptcell-group-3">{renderProcessCell(record, 'material_processing')}</td>
              <td className="ptcell-group-3">{renderProcessCell(record, 'floor_plan_insert')}</td>
              <td className="ptcell-group-3">{renderProcessCell(record, 'afureko')}</td>
              <td className="ptcell-group-3">{renderProcessCell(record, 'text_overlay')}</td>
              <td className="ptcell-group-3">{renderProcessCell(record, 'floor_plan_check')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'post_text', '投稿文')}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'wp_registered')}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'aos_registered')}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'youtube_reserved')}</td>
              <td className="ptcell-group-4">{renderProcessCell(record, 'final_save')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'audio_source', 'audio')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function renderInstagramTable(mediaRecords: ProductionRecord[]) {
    return (
      <table className="progress-table progress-table-instagram">
        <colgroup>
          <col style={{ width: 122 }} />
          <col style={{ width: 85 }} />
          <col style={{ width: 121 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 157 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 232 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 146 }} />
          <col style={{ width: 83 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 166 }} />
          <col style={{ width: 152 }} />
          <col style={{ width: 148 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-1">種別</th>
            <th className="ptcol-group-1">物件番号</th>
            <th className="ptcol-group-1">コピー</th>
            <th className="ptcol-group-2">資料</th>
            <th className="ptcol-group-2">物件名</th>
            <th className="ptcol-group-2">号室</th>
            <th className="ptcol-group-2">住所</th>
            <th className="ptcol-group-2">エリア</th>
            <th className="ptcol-group-2">最寄り駅</th>
            <th className="ptcol-group-2">間取り</th>
            <th className="ptcol-group-2">家賃</th>
            <th className="ptcol-group-2">管理会社</th>
            <th className="ptcol-group-2">連絡先</th>
            <th className="ptcol-group-4">メモ</th>
            <th className="ptcol-group-4">編集完了</th>
            <th className="ptcol-group-4">投稿文</th>
            <th className="ptcol-group-4">WP登録</th>
            <th className="ptcol-group-4">音源</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable" onClick={() => openEdit(record)}>
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-1">{renderTextCell(record, 'post_type', '種別')}</td>
              <td className="ptcell-group-1">{renderTextCell(record, 'property_number', '物件番号')}</td>
              <td className="ptcell-group-1" onClick={(e) => e.stopPropagation()}>
                <button className="progress-copy-button" type="button" onClick={() => setCopyTargetId(record.id)}>
                  選択
                </button>
              </td>
              <td className="ptcell-group-2">{renderPropertyLink(record)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', '物件名')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'room_number', '号室')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_address', '住所')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'area', 'エリア')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'nearest_station', '最寄り駅')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'floor_plan', '間取り')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'rent', '家賃')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'management_company', '管理会社')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'contact_info', '連絡先')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-4">{renderProcessCell(record, 'final_save')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'post_text', '投稿文')}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'wp_registered')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'audio_source', 'audio')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function renderSimpleTable(mediaRecords: ProductionRecord[]) {
    return (
      <table className="progress-table progress-table-simple">
        <colgroup>
          <col style={{ width: 115 }} />
          <col style={{ width: 115 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 157 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 232 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 146 }} />
          <col style={{ width: 83 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 166 }} />
          <col style={{ width: 152 }} />
          <col style={{ width: 148 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">素材保存</th>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-2">資料</th>
            <th className="ptcol-group-2">物件名</th>
            <th className="ptcol-group-2">号室</th>
            <th className="ptcol-group-2">住所</th>
            <th className="ptcol-group-2">エリア</th>
            <th className="ptcol-group-2">最寄り駅</th>
            <th className="ptcol-group-2">間取り</th>
            <th className="ptcol-group-2">家賃</th>
            <th className="ptcol-group-2">管理会社</th>
            <th className="ptcol-group-2">連絡先</th>
            <th className="ptcol-group-4">メモ</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable" onClick={() => openEdit(record)}>
              <td className="ptcell-group-1">{renderDateCell(record, 'material_saved')}</td>
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-2">{renderPropertyLink(record)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', '物件名')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'room_number', '号室')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_address', '住所')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'area', 'エリア')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'nearest_station', '最寄り駅')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'floor_plan', '間取り')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'rent', '家賃')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'management_company', '管理会社')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'contact_info', '連絡先')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  void renderSimpleTable

  function renderFormBody() {
    if (formTab === 'basic') {
      return (
        <>
          <label className="form-label">
            媒体
            <select value={form.media} onChange={(e) => setForm({ ...form, media: e.target.value })}>
              {MEDIA_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              素材保存
              <input type="date" value={form.material_saved} onChange={(e) => setForm({ ...form, material_saved: e.target.value })} />
            </label>
            <label className="form-label">
              投稿予定日
              <input type="date" value={form.scheduled_post_date} onChange={(e) => setForm({ ...form, scheduled_post_date: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
            <label className="form-label">
              物件名
              <input value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
            </label>
            <label className="form-label">
              号室
              <input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} />
            </label>
          </div>
          <label className="form-label">
            住所
            <input value={form.property_address} onChange={(e) => setForm({ ...form, property_address: e.target.value })} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              エリア
              <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </label>
            <label className="form-label">
              最寄り駅
              <input value={form.nearest_station} onChange={(e) => setForm({ ...form, nearest_station: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              間取り
              <input value={form.floor_plan} onChange={(e) => setForm({ ...form, floor_plan: e.target.value })} />
            </label>
            <label className="form-label">
              家賃
              <input value={form.rent} onChange={(e) => setForm({ ...form, rent: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              管理会社
              <input value={form.management_company} onChange={(e) => setForm({ ...form, management_company: e.target.value })} />
            </label>
            <label className="form-label">
              連絡先
              <input value={form.contact_info} onChange={(e) => setForm({ ...form, contact_info: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              種別
              <input value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })} />
            </label>
            <label className="form-label">
              物件番号
              <input value={form.property_number} onChange={(e) => setForm({ ...form, property_number: e.target.value })} />
            </label>
          </div>
          <label className="form-label">
            資料URL
            <input value={form.property_url} onChange={(e) => setForm({ ...form, property_url: e.target.value })} />
          </label>
        </>
      )
    }

    if (formTab === 'production') {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              図面発注
              <select value={form.floor_plan_order} onChange={(e) => setForm({ ...form, floor_plan_order: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-label">
              編集機器
              <select value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })}>
                {DEVICE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              動画尺
              <select value={form.video_duration} onChange={(e) => setForm({ ...form, video_duration: e.target.value })}>
                {VIDEO_DURATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-label">
              担当者
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
                <option value="">未設定</option>
                {ASSIGNEE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              素材加工
              <select value={form.material_processing} onChange={(e) => setForm({ ...form, material_processing: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-label">
              文字入れ
              <select value={form.text_overlay} onChange={(e) => setForm({ ...form, text_overlay: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              図面挿入
              <select value={form.floor_plan_insert} onChange={(e) => setForm({ ...form, floor_plan_insert: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-label">
              アフレコ
              <select value={form.afureko} onChange={(e) => setForm({ ...form, afureko: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
        </>
      )
    }

    if (formTab === 'check') {
      return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              図面確認
              <select value={form.floor_plan_check} onChange={(e) => setForm({ ...form, floor_plan_check: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="form-label">
              編集完了
              <select value={form.final_save} onChange={(e) => setForm({ ...form, final_save: e.target.value as ProcessStatus })}>
                {PROCESS_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <label className="form-label">
            対策内容
            <input value={form.countermeasure} onChange={(e) => setForm({ ...form, countermeasure: e.target.value })} />
          </label>
          <label className="form-label">
            メモ
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </label>
        </>
      )
    }

    return (
      <>
        <label className="form-label">
          投稿文
          <textarea value={form.post_text} onChange={(e) => setForm({ ...form, post_text: e.target.value })} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="form-label">
            WP登録
            <select value={form.wp_registered ? 'true' : 'false'} onChange={(e) => setForm({ ...form, wp_registered: e.target.value === 'true' })}>
              {REGISTER_OPTIONS.map((option) => <option key={option.label} value={option.value ? 'true' : 'false'}>{option.label}</option>)}
            </select>
          </label>
          <label className="form-label">
            YouTube
            <select value={form.youtube_reserved ? 'true' : 'false'} onChange={(e) => setForm({ ...form, youtube_reserved: e.target.value === 'true' })}>
              {REGISTER_OPTIONS.map((option) => <option key={option.label} value={option.value ? 'true' : 'false'}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="form-label">
            音源
            <select value={form.audio_source} onChange={(e) => setForm({ ...form, audio_source: e.target.value })}>
              {AUDIO_SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="form-label">
            AOS
            <select value={form.aos_registered ? 'true' : 'false'} onChange={(e) => setForm({ ...form, aos_registered: e.target.value === 'true' })}>
              {REGISTER_OPTIONS.map((option) => <option key={option.label} value={option.value ? 'true' : 'false'}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </>
    )
  }

  return (
    <div className="progress-page" style={{ minWidth: 0, width: '100%' }}>
      <div className="progress-summary">
        <div className="progress-stat">
          <span className="progress-stat-label">全件数</span>
          <strong className="progress-stat-value">{records.length}</strong>
        </div>
        {MEDIA_OPTIONS.map((media, index) => (
          <div key={media} className="progress-stat">
            <span className="progress-stat-label">{SUMMARY_LABELS[index] || media}</span>
            <strong className="progress-stat-value">{records.filter((record) => getMediaDisplayName(record.media) === media).length}</strong>
          </div>
        ))}
        <div className="progress-stat progress-stat--delay">
          <span className="progress-stat-label">遅延合計</span>
          <strong className="progress-stat-value" style={{ color: '#dc2626' }}>{delayedCount}</strong>
        </div>
      </div>

      <section className="panel progress-table-panel">
        <div className="panel-heading progress-table-heading">
          <div>
            <h2>動画制作進捗一覧</h2>
          </div>
        </div>

        {loading && <p style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>読み込み中...</p>}

        {!loading && groupedRecords.map(({ media, records: mediaRecords }) => (
          <div key={media} className="progress-media-section">
            <div className="progress-media-section-header">
              <h3>{media}一覧</h3>
              <span>{mediaRecords.length} 件</span>
            </div>
            <div className="progress-table-wrap">
              {mediaRecords.length === 0 ? (
                <table className="progress-table">
                  <tbody>
                    <tr>
                      <td style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>まだデータがありません</td>
                    </tr>
                  </tbody>
                </table>
              ) : isTikTokMedia(media) ? (
                renderTikTokTable(mediaRecords)
              ) : isInstagramMedia(media) ? (
                renderInstagramTable(mediaRecords)
              ) : (
                renderTikTokTable(mediaRecords)
              )}
            </div>
          </div>
        ))}
      </section>

      {selectMenu && (
        <div
          ref={selectMenuRef}
          className="progress-editable-select-menu"
          style={{ top: selectMenu.top, left: selectMenu.left, minWidth: selectMenu.width }}
        >
          <div className="progress-editable-select-options">
            {selectOptions[selectMenu.group].map((option) => (
              <button
                key={option}
                type="button"
                className={`progress-editable-select-option${
                  (selectMenu.group === 'register'
                    ? (Boolean(records.find((record) => record.id === selectMenu.id)?.[selectMenu.field]) ? '登録済' : '未登録')
                    : String(records.find((record) => record.id === selectMenu.id)?.[selectMenu.field] || '')) === option
                    ? ' is-active'
                    : ''
                }`}
                onClick={() => {
                  updateField(
                    selectMenu.id,
                    selectMenu.field,
                    selectMenu.group === 'register' ? option === '登録済' : option,
                  )
                  setSelectMenu(null)
                }}
              >
                {option}
              </button>
            ))}
            {selectMenu.group !== 'register' && (
              <button
                type="button"
                className="progress-editable-select-edit"
                onClick={() => updateSelectOptions(selectMenu.group)}
              >
                ✎
              </button>
            )}
          </div>
        </div>
      )}

      {selectOptionEditor && (
        <div className="modal-overlay">
          <div className="modal-content progress-select-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{selectOptionEditor.title}の候補を編集</h2>
              <button className="modal-close" type="button" onClick={() => setSelectOptionEditor(null)}>
                ×
              </button>
            </div>

            <div className="progress-select-editor-list">
              {selectOptionEditor.items.map((item, index) => (
                <div key={`${selectOptionEditor.group}-${index}`} className="progress-select-editor-row">
                  <span className="progress-select-editor-grip" aria-hidden="true">⋮⋮</span>
                  <input
                    className="progress-select-editor-input"
                    value={item}
                    onChange={(e) => updateSelectOptionItem(index, e.target.value)}
                    placeholder="候補名を入力"
                  />
                  <div className="progress-select-editor-actions">
                    <button
                      type="button"
                      className="progress-select-editor-move-button"
                      onClick={() => moveSelectOptionItem(index, 'up')}
                      disabled={index === 0}
                      title="上へ移動"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="progress-select-editor-move-button"
                      onClick={() => moveSelectOptionItem(index, 'down')}
                      disabled={index === selectOptionEditor.items.length - 1}
                      title="下へ移動"
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    className="progress-select-editor-delete"
                    onClick={() => removeSelectOptionItem(index)}
                    title="この候補を削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="progress-select-editor-add-wrap">
              <button type="button" className="secondary" onClick={addSelectOptionItem}>項目を追加</button>
            </div>

            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setSelectOptionEditor(null)}>キャンセル</button>
              <button type="button" className="primary" onClick={saveSelectOptionItems}>完了</button>
            </div>
          </div>
        </div>
      )}

      {copyTargetId && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setCopyTargetId(null)}>
          <div className="modal-content progress-copy-modal">
            <div className="modal-header">
              <h2 className="modal-title">TikTokの行を選ぶ</h2>
              <button className="modal-close" type="button" onClick={() => setCopyTargetId(null)}>
                ✕
              </button>
            </div>
            <p className="progress-copy-modal-text">
              コピーしたいTikTokの行を選ぶと、資料から連絡先までInstagramに反映されます。
            </p>
            <div className="progress-copy-list">
              {tikTokSourceRecords.map((record) => (
                <article key={record.id} className="progress-copy-card">
                  <div className="progress-copy-card-head">
                    <div>
                      <strong>{record.media}</strong>
                      <p>投稿予定日: {record.scheduled_post_date || '未入力'}</p>
                    </div>
                    <button type="button" className="primary" onClick={() => applyTikTokCopy(copyTargetId, record)}>
                      この行を使う
                    </button>
                  </div>
                  <div className="progress-copy-grid">
                    <span>資料: {record.property_url ? 'あり' : 'なし'}</span>
                    <span>物件名: {record.property_name || '未入力'}</span>
                    <span>号室: {record.room_number || '未入力'}</span>
                    <span>住所: {record.property_address || '未入力'}</span>
                    <span>エリア: {record.area || '未入力'}</span>
                    <span>最寄り駅: {record.nearest_station || '未入力'}</span>
                    <span>間取り: {record.floor_plan || '未入力'}</span>
                    <span>家賃: {record.rent || '未入力'}</span>
                    <span>管理会社: {record.management_company || '未入力'}</span>
                    <span>連絡先: {record.contact_info || '未入力'}</span>
                  </div>
                </article>
              ))}
              {tikTokSourceRecords.length === 0 && (
                <p className="progress-copy-empty">コピー元にできるTikTokの行がまだありません。</p>
              )}
            </div>
          </div>
        </div>
      )}

      <button className="fab" onClick={openNew} aria-label="新しい進捗を追加" title="新しい進捗を追加">＋</button>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="modal-content" style={{ maxWidth: editId ? 700 : 520 }}>
            <div className="modal-header">
              <h2 className="modal-title">{editId ? '進捗を編集' : '新しい進捗を追加'}</h2>
              <button className="modal-close" type="button" onClick={closeModal}>✕</button>
            </div>

            {!editId && (
              <form className="data-form" onSubmit={handleSubmit}>
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--gray-500)', lineHeight: 1.8 }}>最初は3つだけ入れて保存できます。残りは下の一覧でそのまま入力できます。</p>
                <label className="form-label">
                  媒体
                  <select value={form.media} onChange={(e) => setForm({ ...form, media: e.target.value })}>
                    {MEDIA_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="form-label">
                  物件名
                  <input value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
                </label>
                <label className="form-label">
                  号室
                  <input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} />
                </label>
                <div className="form-actions" style={{ marginTop: 10 }}>
                  <button type="submit" className="primary">保存する</button>
                  <button type="button" className="secondary" onClick={closeModal}>キャンセル</button>
                </div>
              </form>
            )}

            {editId && (
              <>
                <div className="progress-form-tabs" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid var(--gray-200)', margin: '0 -24px 20px', padding: '10px 24px' }}>
                  {FORM_TABS.map((tab) => (
                    <button key={tab.key} type="button" className={`progress-form-tab-btn${formTab === tab.key ? ' active' : ''}`} onClick={() => setFormTab(tab.key)}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <form className="data-form" onSubmit={handleSubmit}>
                  {renderFormBody()}
                  <div className="form-actions" style={{ marginTop: 16 }}>
                    <button type="submit" className="primary">保存する</button>
                    <button type="button" className="secondary" onClick={closeModal}>閉じる</button>
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
