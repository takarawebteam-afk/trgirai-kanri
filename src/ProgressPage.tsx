import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

type ProductionStatus = '撮影済' | '制作中' | 'チェック中' | '完了'
type ProcessStatus = string
type StorePromoteTarget = 'keihan-karilun' | 'nishinomiya-karilun' | 'nagase' | 'nishikita' | 'yao'
type StoreProgressTableName =
  | 'sns_keihan_karilun_properties'
  | 'sns_nishinomiya_karilun_properties'
  | 'sns_nagase_properties'
  | 'sns_nishikita_properties'
  | 'sns_yao_properties'
type PromoteTarget = 'tiktok' | 'instagram' | 'youtube' | 'recruitment' | StorePromoteTarget

interface ProductionRecord {
  id: string
  created_at?: string
  status: ProductionStatus
  material_saved: string
  scheduled_post_date: string
  aos_registered: string
  media: string
  post_type: string
  property_number: string
  property_name: string
  room_number: string
  property_address: string
  acquisition_source: string
  management_company: string
  contact_info: string
  floor_plan: string
  rent: string
  area: string
  nearest_station: string
  assignee: string
  device: string
  property_url: string
  wp_registered: string
  youtube_reserved: string
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

type ProgressTextCellInputProps = {
  value: string
  placeholder?: string
  className?: string
  linkify?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  lang?: string
  imeMode?: 'active' | 'inactive'
  autoCapitalize?: React.HTMLAttributes<HTMLInputElement>['autoCapitalize']
  autoCorrect?: string
  spellCheck?: boolean
  onSave: (value: string) => boolean | void | Promise<boolean | void>
}

type FormTabKey = 'basic' | 'production' | 'check' | 'finish'
type ProcessField =
  | 'floor_plan_order'
  | 'material_processing'
  | 'floor_plan_insert'
  | 'afureko'
  | 'text_overlay'
  | 'floor_plan_check'
  | 'final_save'
type SelectOptionGroup =
  | 'process'
  | 'process_floor_plan_order'
  | 'process_material_processing'
  | 'process_floor_plan_insert'
  | 'process_afureko'
  | 'process_text_overlay'
  | 'process_floor_plan_check'
  | 'process_final_save'
  | 'device'
  | 'duration'
  | 'audio'
  | 'instagram_post_type'
  | 'recruitment_post_type'
  | 'register'
  | 'register_wp'
  | 'register_aos'
  | 'register_youtube'
  | 'acquisition_source'
  | 'post_text'
type SelectMenuState = {
  id: string
  field: keyof ProductionRecord
  group: SelectOptionGroup
  title: string
  top: number
  left: number
  width: number
  showEditButton: boolean
} | null
type SelectOptionEditorState = {
  group: SelectOptionGroup
  title: string
  items: string[]
} | null

const PROCESS_STATUSES: ProcessStatus[] = ['未着手', '進行中', '完了']
const ASSIGNEE_OPTIONS = ['泉', '坂本', '吉田', '新居']
const DEVICE_OPTIONS = ['未設定', 'iPhone', 'Android', 'カメラ', 'その他']
const VIDEO_DURATION_OPTIONS = ['未設定', '15秒', '30秒', '45秒', '60秒', '編集中']
const REGISTER_OPTIONS = [
  { value: false, label: '未登録' },
  { value: true, label: '登録済' },
]

const INSTAGRAM_POST_TYPE_OPTIONS = ['動画', '画像'] as const
const RECRUITMENT_POST_TYPE_OPTIONS = ['リール', 'フィード'] as const
const ACQUISITION_SOURCE_OPTIONS = ['SUUMO', 'HOME’S', 'at home', '自社', 'その他'] as const
const DEFAULT_PROCESS_OPTIONS: string[] = [...PROCESS_STATUSES]
void ACQUISITION_SOURCE_OPTIONS
const PROCESS_FIELD_GROUPS: Record<ProcessField, SelectOptionGroup> = {
  floor_plan_order: 'process_floor_plan_order',
  material_processing: 'process_material_processing',
  floor_plan_insert: 'process_floor_plan_insert',
  afureko: 'process_afureko',
  text_overlay: 'process_text_overlay',
  floor_plan_check: 'process_floor_plan_check',
  final_save: 'process_final_save',
}

const INITIAL_SELECT_OPTIONS: Record<SelectOptionGroup, string[]> = {
  process: ['未着手', '進行中', '完了'],
  device: ['未設定', 'iPhone', 'Android', 'カメラ', 'その他'],
  duration: ['未設定', '15秒', '30秒', '45秒', '60秒', '編集中'],
  audio: ['未登録', '候補あり', '登録済'],
  register: ['未登録', '登録済'],
  instagram_post_type: [...INSTAGRAM_POST_TYPE_OPTIONS],
  recruitment_post_type: [...RECRUITMENT_POST_TYPE_OPTIONS],
  process_floor_plan_order: [...DEFAULT_PROCESS_OPTIONS],
  process_material_processing: [...DEFAULT_PROCESS_OPTIONS],
  process_floor_plan_insert: [...DEFAULT_PROCESS_OPTIONS],
  process_afureko: [...DEFAULT_PROCESS_OPTIONS],
  process_text_overlay: [...DEFAULT_PROCESS_OPTIONS],
  process_floor_plan_check: [...DEFAULT_PROCESS_OPTIONS],
  process_final_save: [...DEFAULT_PROCESS_OPTIONS],
  register_wp: REGISTER_OPTIONS.map((option) => option.label),
  register_aos: REGISTER_OPTIONS.map((option) => option.label),
  register_youtube: REGISTER_OPTIONS.map((option) => option.label),
  post_text: ['未設定', '作成中', '完了'],
  acquisition_source: ['リアプロ', 'イタンジ', 'レインズ', '管理会社HP', 'その他'],
}

const SELECT_OPTION_STORAGE_PREFIX = 'progress_select_options:'
/*
const SELECT_OPTION_GROUP_LABELS: Partial<Record<SelectOptionGroup, string>> = {
  process: '工程',
  device: '使用端末',
  duration: '動画尺',
  audio: '音源',
  register: '登録状況',
  instagram_post_type: '遞ｮ蛻･',
  register_wp: 'WP逋ｻ骭ｲ',
  register_aos: 'AOS逋ｻ骭ｲ',
  acquisition_source: '資料取得先',
  register_youtube: 'YouTube莠育ｴ・,
}
*/
const SELECT_OPTION_GROUP_LABELS: Partial<Record<SelectOptionGroup, string>> = {
  process: '進捗',
  device: '使用端末',
  duration: '動画尺',
  audio: '音源',
  register: '登録状況',
  register_wp: 'WP登録',
  register_aos: 'AOS登録',
  register_youtube: 'YouTube予約',
  acquisition_source: '資料取得先',
  post_text: '投稿文',
}
const SELECT_OPTION_FIELD_LABELS: Partial<Record<keyof ProductionRecord, string>> = {
  floor_plan_order: '図面準備',
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
  post_text: '投稿文',
}

function normalizeSelectOptions(options: string[]) {
  return Array.from(new Set(options.map((item) => item.trim()).filter(Boolean)))
}

function normalizeRegisterOptions(options: string[]) {
  const normalized = normalizeSelectOptions(options)
  const fallback = REGISTER_OPTIONS.map((option) => option.label)

  if (normalized.length === 0) return fallback
  return normalized
}

function getDefaultRegisterLabel() {
  return REGISTER_OPTIONS[0]?.label || ''
}

function getRegisterLabel(value: string, options: string[]) {
  void options
  const normalizedValue = String(value || '').trim()
  if (normalizedValue) return normalizedValue
  return getDefaultRegisterLabel()
}

function getRegisterGroupByField(field: 'wp_registered' | 'aos_registered' | 'youtube_reserved') {
  if (field === 'wp_registered') return 'register_wp' as const
  if (field === 'aos_registered') return 'register_aos' as const
  return 'register_youtube' as const
}

const FULL_WIDTH_PROGRESS_FIELDS: (keyof ProductionRecord)[] = [
  'property_name',
  'property_address',
  'area',
  'nearest_station',
  'management_company',
  'memo',
  'audio_source',
  'post_text',
]

const HALF_WIDTH_PROGRESS_FIELDS: (keyof ProductionRecord)[] = [
  'room_number',
  'floor_plan',
  'contact_info',
]

function toHalfWidthAscii(value: string) {
  return value
    .replace(/　/g, ' ')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/g

function formatRentValue(value: string) {
  const normalized = toHalfWidthAscii(value).replace(/,/g, '').trim()
  if (!normalized) return ''
  if (!/^\d+$/.test(normalized)) return normalized
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function normalizeProgressFieldValue(field: keyof ProductionRecord | 'shooting_date', value: string | boolean) {
  if (typeof value !== 'string') return value
  if (field === 'rent') return formatRentValue(value)
  return value
}

function getProgressTextInputProps(field: keyof ProductionRecord) {
  if (field === 'rent') {
    return { inputMode: 'numeric' as const, imeMode: 'inactive' as const, autoCapitalize: 'off' as const, autoCorrect: 'off', spellCheck: false }
  }

  if (HALF_WIDTH_PROGRESS_FIELDS.includes(field)) {
    return { inputMode: 'text' as const, imeMode: 'inactive' as const, autoCapitalize: 'off' as const, autoCorrect: 'off', spellCheck: false }
  }

  if (FULL_WIDTH_PROGRESS_FIELDS.includes(field)) {
    return { inputMode: 'text' as const, lang: 'ja', imeMode: 'active' as const }
  }

  return {}
}

function getProgressFormInputProps(field: keyof ProductionRecord, className = '') {
  const { imeMode, ...inputProps } = getProgressTextInputProps(field)
  const imeClass = imeMode ? `progress-ime-${imeMode}` : ''

  return {
    ...inputProps,
    className: [className, imeClass].filter(Boolean).join(' ') || undefined,
    'data-ime-mode': imeMode,
  }
}

function getProcessGroupByField(field: ProcessField) {
  return PROCESS_FIELD_GROUPS[field]
}

function getStoredSelectOptions(): Record<SelectOptionGroup, string[]> {
  if (typeof window === 'undefined') {
    return INITIAL_SELECT_OPTIONS
  }

  const next = { ...INITIAL_SELECT_OPTIONS }

  ;(Object.keys(INITIAL_SELECT_OPTIONS) as SelectOptionGroup[]).forEach((group) => {
    try {
      if (group === 'acquisition_source') {
        next[group] = [...INITIAL_SELECT_OPTIONS[group]]
        return
      }

      let raw = window.localStorage.getItem(`${SELECT_OPTION_STORAGE_PREFIX}${group}`)
      if (!raw && group.startsWith('process_')) {
        raw = window.localStorage.getItem(`${SELECT_OPTION_STORAGE_PREFIX}process`)
      }
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return

      const normalized = group.startsWith('register')
        ? normalizeRegisterOptions(parsed.filter((item): item is string => typeof item === 'string'))
        : normalizeSelectOptions(parsed.filter((item): item is string => typeof item === 'string'))
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
    JSON.stringify(group.startsWith('register') ? normalizeRegisterOptions(options) : normalizeSelectOptions(options)),
  )
}

function getUrlParts(value: string) {
  const halfWidthValue = toHalfWidthAscii(value)
  const parts: { text: string; isUrl: boolean; href?: string }[] = []
  let lastIndex = 0

  halfWidthValue.replace(URL_PATTERN, (match, _url, offset) => {
    if (offset > lastIndex) {
      parts.push({ text: value.slice(lastIndex, offset), isUrl: false })
    }
    parts.push({ text: value.slice(offset, offset + match.length), isUrl: true, href: match })
    lastIndex = offset + match.length
    return match
  })

  if (lastIndex < value.length) {
    parts.push({ text: value.slice(lastIndex), isUrl: false })
  }

  return parts
}

function toHref(value: string) {
  return value.startsWith('www.') ? `https://${value}` : value
}

function ProgressTextCellInput({
  value,
  placeholder = '',
  className = 'progress-cell-input',
  linkify = true,
  inputMode,
  lang,
  imeMode,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  onSave,
}: ProgressTextCellInputProps) {
  const [draft, setDraft] = useState(value)
  const [isComposing, setIsComposing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [unsavedDraft, setUnsavedDraft] = useState<string | null>(null)
  const shouldCommitAfterCompositionRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (unsavedDraft !== null && draft === unsavedDraft) return
    if (!isComposing && !isSaving && !isFocused) {
      setDraft(value)
    }
  }, [draft, isComposing, isFocused, isSaving, unsavedDraft, value])

  const urlParts = getUrlParts(draft)
  const shouldShowLinkView = linkify && !isFocused && urlParts.some((part) => part.isUrl)

  function startEditing() {
    setIsFocused(true)
    window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }

  async function commit(nextValue = draft) {
    if (isSaving || nextValue === value) return
    setIsSaving(true)
    try {
      const saved = await onSave(nextValue)
      if (saved === false) {
        setUnsavedDraft(nextValue)
        setDraft(nextValue)
        return
      }
      setUnsavedDraft(null)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="progress-cell-hitbox" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {shouldShowLinkView ? (
        <div className="progress-cell-link-view" onClick={(e) => e.stopPropagation()}>
          <span className="progress-cell-link-text">
            {urlParts.map((part, index) =>
              part.isUrl ? (
                <a
                  key={`${part.text}-${index}`}
                  className="progress-inline-link"
                  href={toHref(part.href || part.text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {part.text}
                </a>
              ) : (
                <span key={`${part.text}-${index}`}>{part.text}</span>
              ),
            )}
          </span>
          <button type="button" className="progress-cell-link-edit" onClick={startEditing}>
            編集
          </button>
        </div>
      ) : (
      <input
        ref={inputRef}
        className={`${className}${imeMode ? ` progress-ime-${imeMode}` : ''}`}
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        lang={lang}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        onFocus={() => setIsFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => {
          shouldCommitAfterCompositionRef.current = false
          setIsComposing(true)
        }}
        onCompositionEnd={(e) => {
          setIsComposing(false)
          const nextValue = e.currentTarget.value
          setDraft(nextValue)
          if (shouldCommitAfterCompositionRef.current) {
            shouldCommitAfterCompositionRef.current = false
            window.setTimeout(() => {
              void commit(nextValue)
              e.currentTarget.blur()
            }, 0)
          }
        }}
        onBlur={(e) => {
          setIsFocused(false)
          const nextValue = e.currentTarget.value
          setDraft(nextValue)
          void commit(nextValue)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (isComposing || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
              shouldCommitAfterCompositionRef.current = true
              return
            }
            const input = e.currentTarget
            const nextValue = input.value
            setDraft(nextValue)
            window.setTimeout(() => {
              void commit(nextValue)
              input.blur()
            }, 0)
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
      )}
    </div>
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
  '採用',
]

const SUMMARY_LABELS = ['Tiktok', 'Instagram', '京阪', '西宮市', '近大', '関学', '八尾', '採用']

const STORE_PROGRESS_CONFIGS: {
  target: StorePromoteTarget
  tableName: StoreProgressTableName
  matchText: string
  label: string
  typeLabel: string
}[] = [
  {
    target: 'keihan-karilun',
    tableName: 'sns_keihan_karilun_properties',
    matchText: '京阪',
    label: '京阪かりるん',
    typeLabel: '場所',
  },
  {
    target: 'nishinomiya-karilun',
    tableName: 'sns_nishinomiya_karilun_properties',
    matchText: '西宮市',
    label: '西宮かりるん',
    typeLabel: '種別',
  },
  {
    target: 'nagase',
    tableName: 'sns_nagase_properties',
    matchText: '長瀬',
    label: '長瀬店',
    typeLabel: '種別',
  },
  {
    target: 'nishikita',
    tableName: 'sns_nishikita_properties',
    matchText: '西北',
    label: '西北店',
    typeLabel: '種別',
  },
  {
    target: 'yao',
    tableName: 'sns_yao_properties',
    matchText: '八尾',
    label: '八尾店',
    typeLabel: '種別',
  },
]

const PROGRESS_SHARED_COLUMN_WIDTHS = {
  propertyName: 155,
  address: 146,
  area: 83,
  nearestStation: 118,
  floorPlan: 83,
  rent: 101,
  acquisitionSource: 118,
  managementCompany: 166,
  audioSource: 160,
  postText: 90,
} as const

const PROGRESS_INSTAGRAM_COLUMN_WIDTHS = {
  propertyName: 155,
  address: 146,
  area: 83,
  nearestStation: 118,
  floorPlan: 83,
  rent: PROGRESS_SHARED_COLUMN_WIDTHS.rent,
  acquisitionSource: PROGRESS_SHARED_COLUMN_WIDTHS.acquisitionSource,
  managementCompany: 166,
  memo: 296,
  audioSource: 160,
} as const

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
  aos_registered: INITIAL_SELECT_OPTIONS.register_aos[0],
  media: 'Karilun｜TikTok',
  post_type: '',
  property_number: '',
  property_name: '',
  room_number: '',
  property_address: '',
  acquisition_source: '',
  management_company: '',
  contact_info: '',
  floor_plan: '',
  rent: '',
  area: '',
  nearest_station: '',
  assignee: '',
  device: '未設定',
  property_url: '',
  wp_registered: INITIAL_SELECT_OPTIONS.register_wp[0],
  youtube_reserved: INITIAL_SELECT_OPTIONS.register_youtube[0],
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
  if (normalized.includes('採用') || normalized.includes('recruit')) return '採用'
  return media || '未設定'
}

function isTikTokMedia(media: string) {
  return normalizeMediaName(getMediaDisplayName(media)).includes('tiktok')
}

function isInstagramMedia(media: string) {
  return normalizeMediaName(getMediaDisplayName(media)).includes('instagram')
}

function isRecruitmentMedia(media: string) {
  return getMediaDisplayName(media) === '採用'
}

function getStoreProgressConfig(media: string) {
  const normalized = normalizeMediaName(getMediaDisplayName(media))
  return STORE_PROGRESS_CONFIGS.find((config) => normalized.includes(normalizeMediaName(config.matchText))) || null
}

function getWeekdayLabel(dateText: string) {
  if (!dateText) return ''
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
}

function toRegisteredLabel(value: boolean) {
  return value ? '登録済' : ''
}

void toRegisteredLabel

function sanitizeProcessStatus(value: unknown): ProcessStatus {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return PROCESS_STATUSES[0]
}

function sanitizeSelectText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function sanitizeRegisterText(value: unknown, options = INITIAL_SELECT_OPTIONS.register) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value === true) return options[1] || options[0] || ''
  return options[0] || ''
}

function isCustomRegisterSelected(value: string, options: string[]) {
  void options
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return false
  return normalizedValue !== getDefaultRegisterLabel()
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
          acquisition_source: sanitizeSelectText(record.acquisition_source),
          youtube_reserved: sanitizeRegisterText(record.youtube_reserved),
          post_completed: Boolean(record.post_completed),
          aos_registered: sanitizeRegisterText(record.aos_registered),
          wp_registered: sanitizeRegisterText(record.wp_registered),
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
  const stockedRecords = records.filter((record) => record.property_name.trim())

  const groupedRecords = useMemo(() => {
    return MEDIA_OPTIONS
      .map((media) => ({
        media,
        records: records
          .filter((record) => getMediaDisplayName(record.media) === media)
          .sort((a, b) => (a.scheduled_post_date || '').localeCompare(b.scheduled_post_date || '')),
      }))
      .filter(({ records: mediaRecords }) => mediaRecords.length > 0)
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

  async function getNextStorePropertyNumber(tableName: StoreProgressTableName) {
    const { data } = await supabase
      .from(tableName)
      .select('property_number')

    const maxValue = (data || []).reduce((max, row) => {
      const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0)

    return String(maxValue + 1)
  }

  async function getNextRecruitmentPropertyNumber() {
    const { data } = await supabase
      .from('sns_recruitment_properties')
      .select('property_number')

    const maxValue = (data || []).reduce((max, row) => {
      const value = Number(String(row.property_number || '').match(/\d+/)?.[0] || 0)
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0)

    return String(maxValue + 1)
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
        acquisition_source: record.acquisition_source || '',
        management_company: record.management_company || '',
        contact: record.contact_info || '',
        floor_plan: record.floor_plan || '',
        rent: record.rent || '',
        area: record.area || '',
        nearest_station: record.nearest_station || '',
        memo: record.memo || '',
        wp_registered: record.wp_registered || '',
        post_date: null,
        document_url: '',
        ...(tableName === 'sns_tiktok_properties'
          ? { aos_registered: record.aos_registered || '' }
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
        acquisition_source: record.acquisition_source || '',
        management_company: record.management_company || '',
        contact: record.contact_info || '',
        memo: record.memo || '',
        wp_registered: record.wp_registered || '',
        post_date: null,
        document_url: '',
      }

      const { error } = await supabase.from('sns_youtube_properties').insert([insertData])
      if (error) {
        alert(`YouTube一覧への追加に失敗しました。\n${error.message}`)
        return
      }

      onSnsPropertyPromoted?.('youtube')
      return
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
      acquisition_source: record.acquisition_source || '',
      management_company: record.management_company || '',
      contact: record.contact_info || '',
      memo: record.memo || '',
      wp_registered: record.wp_registered || '',
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

  async function saveInstagramPropertyFromProgress(record: ProductionRecord) {
    const progressPropertyNumber = record.property_number.trim()
    const propertyNumber = progressPropertyNumber || await getNextPropertyNumber('sns_instagram_properties')
    const rowData = {
      property_number: propertyNumber,
      ...buildExtendedSnsPropertyData(record),
      category: record.post_type || '',
    }

    if (progressPropertyNumber) {
      const { data: existingRows, error: findError } = await supabase
        .from('sns_instagram_properties')
        .select('id')
        .eq('property_number', progressPropertyNumber)
        .limit(1)

      if (findError) {
        alert(`Instagram一覧の物件番号確認に失敗しました。\n${findError.message}`)
        return false
      }

      const existingId = existingRows?.[0]?.id
      if (existingId) {
        const { error } = await supabase
          .from('sns_instagram_properties')
          .update(rowData)
          .eq('id', existingId)

        if (error) {
          alert(`Instagram一覧への反映に失敗しました。\n${error.message}`)
          return false
        }

        return true
      }
    }

    const { error } = await supabase.from('sns_instagram_properties').insert([rowData])
    if (error) {
      alert(`Instagram一覧への反映に失敗しました。\n${error.message}`)
      return false
    }

    return true
  }

  async function promoteToSnsPropertySafe(record: ProductionRecord, trigger: 'post_completed' | 'youtube_reserved') {
    if (trigger === 'post_completed') {
      let tableName: 'sns_tiktok_properties' | 'sns_instagram_properties' | null = null
      let target: PromoteTarget | null = null
      let label = ''

      const storeConfig = getStoreProgressConfig(record.media)

      if (isRecruitmentMedia(record.media)) {
        if (!window.confirm('SNS物件管理の「採用」へ反映しますか？')) return

        const insertData = {
          memo: record.memo || '',
          post_date: record.scheduled_post_date || null,
          category: record.post_type || '',
          title: record.property_name || '',
          property_number: await getNextRecruitmentPropertyNumber(),
          post_reserved: '',
          youtube_reserved: '',
        }

        const { error } = await supabase.from('sns_recruitment_properties').insert([insertData])
        if (error) {
          alert(`採用一覧への反映に失敗しました。\n${error.message}`)
          return
        }

        onSnsPropertyPromoted?.('recruitment')
      } else if (storeConfig) {
        if (!window.confirm(`SNS物件管理の「${storeConfig.label}」へ反映しますか？`)) return

        const insertData = {
          memo: record.memo || '',
          post_date: record.scheduled_post_date || null,
          category: record.post_type || '',
          property_name: record.property_name || '',
          room_number: record.room_number || '',
          property_number: record.property_number || await getNextStorePropertyNumber(storeConfig.tableName),
          document_url: record.property_url || '',
          tiktok_reserved: '',
          tiktok_wp: '',
          instagram_reserved: '',
          instagram_wp: '',
          youtube_reserved: '',
          youtube_wp: '',
          threads_post_date: '',
          post_text: '',
        }

        const { error } = await supabase.from(storeConfig.tableName).insert([insertData])
        if (error) {
          alert(`${storeConfig.label}一覧への反映に失敗しました。\n${error.message}`)
          return
        }

        onSnsPropertyPromoted?.(storeConfig.target)
      } else if (isTikTokMedia(record.media)) {
        tableName = 'sns_tiktok_properties'
        target = 'tiktok'
        label = 'Karilun｜TikTok'
      } else if (isInstagramMedia(record.media)) {
        tableName = 'sns_instagram_properties'
        target = 'instagram'
        label = 'Karilun｜Instagram'
      }

      if (tableName) {
        if (!window.confirm(`SNS物件管理の「${label}」へ反映しますか？`)) return

        if (tableName === 'sns_instagram_properties') {
          const saved = await saveInstagramPropertyFromProgress(record)
          if (!saved) return
          if (target) onSnsPropertyPromoted?.(target)
        } else {
          const insertData = {
            property_number: await getNextPropertyNumber(tableName),
            ...buildExtendedSnsPropertyData(record),
            ...(tableName === 'sns_tiktok_properties'
              ? { aos_registered: record.aos_registered || '' }
              : { category: record.post_type || '' }),
          }

          const { error } = await supabase.from(tableName).insert([insertData])
          if (error) {
            alert(`SNS物件管理への反映に失敗しました。\n${error.message}`)
            return
          }

          if (target) onSnsPropertyPromoted?.(target)
        }
      } else if (!storeConfig && !isRecruitmentMedia(record.media)) {
        return
      }
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
      return
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
    const normalizedValue = normalizeProgressFieldValue(field, value)
    const { error } = await supabase.from('production_records').update({ [dbField]: normalizedValue }).eq('id', id)
    if (error) {
      alert(`更新に失敗しました。\n${error.message}`)
      return false
    }

    const currentRecord = records.find((record) => record.id === id) || null
    const updatedRecord: ProductionRecord | null = currentRecord
      ? {
        ...currentRecord,
        ...(field === 'material_saved' ? { material_saved: String(normalizedValue) } : { [field]: normalizedValue }),
      }
      : null

    setRecords((prev) => prev.map((record) => {
      if (record.id !== id || !updatedRecord) return record
      return updatedRecord
    }))

    if (updatedRecord && field === 'post_completed' && value === true) {
      await promoteToSnsPropertySafe(updatedRecord, field)
    }

    if (
      updatedRecord
      && field === 'youtube_reserved'
      && typeof normalizedValue === 'string'
      && currentRecord
      && currentRecord.youtube_reserved !== normalizedValue
      && isCustomRegisterSelected(normalizedValue, selectOptions.register_youtube)
    ) {
      await promoteToSnsPropertySafe(updatedRecord, field)
    }

    return true
  }

  function openSelectMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    record: ProductionRecord,
    field: keyof ProductionRecord,
    group: SelectOptionGroup,
    title: string,
    showEditButton = true,
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
      showEditButton,
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
    const title = selectMenu?.title || SELECT_OPTION_GROUP_LABELS[group] || ''

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

    const nextOptions = selectOptionEditor.group.startsWith('register')
      ? normalizeRegisterOptions(selectOptionEditor.items)
      : normalizeSelectOptions(selectOptionEditor.items)
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
      property_name: normalizeProgressFieldValue('property_name', form.property_name),
      room_number: normalizeProgressFieldValue('room_number', form.room_number),
      property_address: normalizeProgressFieldValue('property_address', form.property_address),
      area: normalizeProgressFieldValue('area', form.area),
      nearest_station: normalizeProgressFieldValue('nearest_station', form.nearest_station),
      floor_plan: normalizeProgressFieldValue('floor_plan', form.floor_plan),
      rent: normalizeProgressFieldValue('rent', form.rent),
      management_company: normalizeProgressFieldValue('management_company', form.management_company),
      contact_info: normalizeProgressFieldValue('contact_info', form.contact_info),
      memo: normalizeProgressFieldValue('memo', form.memo),
      audio_source: normalizeProgressFieldValue('audio_source', form.audio_source),
      post_text: normalizeProgressFieldValue('post_text', form.post_text),
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

  function handleMediaChange(media: string) {
    setForm((prev) => ({
      ...prev,
      media,
      post_type: isInstagramMedia(media) || isRecruitmentMedia(media) ? prev.post_type : '',
    }))
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
      acquisition_source: source.acquisition_source || '',
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
      <ProgressTextCellInput
        className={className}
        value={String(record[field] || '')}
        placeholder={placeholder}
        {...getProgressTextInputProps(field)}
        onSave={(value) => updateField(record.id, field, value)}
      />
    )
  }

  function renderPostTypeCell(record: ProductionRecord) {
    return renderSelectCell(record, 'post_type', 'instagram_post_type', '種別', '', undefined, false, false)
  }

  function renderRecruitmentPostTypeCell(record: ProductionRecord) {
    return renderSelectCell(record, 'post_type', 'recruitment_post_type', '投稿種類', '', undefined, false, false)
  }

  function renderSelectCell(
    record: ProductionRecord,
    field: keyof ProductionRecord,
    group: SelectOptionGroup,
    title?: string,
    extraClassName = '',
    style?: React.CSSProperties,
    showEditButton = true,
    useFirstOptionAsFallback = true,
  ) {
    const effectiveGroup = group === 'register'
      ? getRegisterGroupByField(field as 'wp_registered' | 'aos_registered' | 'youtube_reserved')
      : group
    const options = selectOptions[effectiveGroup]
    const value =
      effectiveGroup.startsWith('register')
        ? getRegisterLabel(String(record[field] || ''), options)
        : useFirstOptionAsFallback
          ? String(record[field] || options[0] || '')
          : String(record[field] || '')
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
            effectiveGroup,
            title || SELECT_OPTION_FIELD_LABELS[field] || SELECT_OPTION_GROUP_LABELS[effectiveGroup] || '',
            showEditButton,
          )}
        >
          <span className="progress-editable-select-label">{value}</span>
          <span className="progress-editable-select-caret" aria-hidden="true" />
        </button>
      </div>
    )
  }

  function renderProcessCell(record: ProductionRecord, field: keyof ProductionRecord) {
    return renderSelectCell(record, field, 'process', SELECT_OPTION_FIELD_LABELS[field] || '工程')
  }

  void renderProcessCell

  function renderIndependentProcessCell(record: ProductionRecord, field: ProcessField) {
    return renderSelectCell(
      record,
      field,
      getProcessGroupByField(field),
      SELECT_OPTION_FIELD_LABELS[field] || '工程',
    )
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
    function editPropertyUrl() {
      const nextValue = window.prompt('資料URLを入力してください', record.property_url || '')
      if (nextValue === null) return
      void updateField(record.id, 'property_url', nextValue.trim())
    }

    if (record.property_url) {
      return (
        <div className="progress-link-cell" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="progress-link-icon"
            title="資料URLを変更"
            aria-label="資料URLを変更"
            onClick={editPropertyUrl}
          >
            <LinkIcon />
          </button>
        </div>
      )
    }

    return (
      <div className="progress-link-cell" onClick={(e) => e.stopPropagation()}>
        <button
          className="progress-link-empty"
          type="button"
          onClick={editPropertyUrl}
        >
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

  function renderEditCell(record: ProductionRecord) {
    return (
      <button
        className="secondary"
        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          openEdit(record)
        }}
      >
        編集
      </button>
    )
  }

  function renderTikTokTable(mediaRecords: ProductionRecord[]) {
    return (
      <table className="progress-table progress-table-tiktok">
        <colgroup>
          <col style={{ width: 135 }} />
          <col style={{ width: 135 }} />
          <col style={{ width: 102 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 200 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.address }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.area }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.nearestStation }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.floorPlan }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.rent }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.acquisitionSource }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.managementCompany }} />
          <col style={{ width: 101 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 296 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.audioSource }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.postText }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">素材保存</th>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-2">WP登録</th>
            <th className="ptcol-group-2">AOS登録</th>
            <th className="ptcol-group-2">資料</th>
            <th className="ptcol-group-2">物件名</th>
            <th className="ptcol-group-2">号室</th>
            <th className="ptcol-group-2">住所</th>
            <th className="ptcol-group-2">エリア</th>
            <th className="ptcol-group-2">最寄り駅</th>
            <th className="ptcol-group-2">間取り</th>
            <th className="ptcol-group-2">家賃</th>
            <th className="ptcol-group-2">資料取得先</th>
            <th className="ptcol-group-2">管理会社</th>
            <th className="ptcol-group-2">連絡先</th>
            <th className="ptcol-group-2">図面準備</th>
            <th className="ptcol-group-3 progress-col-memo-wide">メモ</th>
            <th className="ptcol-group-3">編集機器</th>
            <th className="ptcol-group-3">音源</th>
            <th className="ptcol-group-3">動画尺</th>
            <th className="ptcol-group-3">素材加工</th>
            <th className="ptcol-group-3">図面挿入</th>
            <th className="ptcol-group-3">アフレコ</th>
            <th className="ptcol-group-3">文字入れ</th>
            <th className="ptcol-group-3">図面確認</th>
            <th className="ptcol-group-4">投稿文</th>
            <th className="ptcol-group-4">YouTube</th>
            <th className="ptcol-group-4">完成品保存</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable">
              <td className="ptcell-group-1">{renderDateCell(record, 'material_saved')}</td>
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-2">{renderRegisterCell(record, 'wp_registered')}</td>
              <td className="ptcell-group-2">{renderRegisterCell(record, 'aos_registered')}</td>
              <td className="ptcell-group-2">{renderPropertyLink(record)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', '物件名')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'room_number', '号室')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_address', '住所')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'area', 'エリア')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'nearest_station', '最寄り駅')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'floor_plan', '間取り')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'rent', '家賃')}</td>
              <td className="ptcell-group-2">{renderSelectCell(record, 'acquisition_source', 'acquisition_source', '資料取得先', '', undefined, true, false)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'management_company', '管理会社')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'contact_info', '連絡先')}</td>
              <td className="ptcell-group-2">{renderIndependentProcessCell(record, 'floor_plan_order')}</td>
              <td className="ptcell-group-3 progress-col-memo-wide">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'device', 'device')}</td>
              <td className="ptcell-group-3">{renderTextCell(record, 'audio_source', '音源')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'video_duration', 'duration')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'material_processing')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'floor_plan_insert')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'afureko')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'text_overlay')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'floor_plan_check')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'post_text', 'post_text', '投稿文', '', undefined, true, false)}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'youtube_reserved')}</td>
              <td className="ptcell-group-4">{renderIndependentProcessCell(record, 'final_save')}</td>
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
          <col style={{ width: 135 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 200 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.address }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.area }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.nearestStation }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.floorPlan }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.rent }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.acquisitionSource }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.managementCompany }} />
          <col style={{ width: 101 }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.memo }} />
          <col style={{ width: 98 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.postText }} />
          <col style={{ width: 98 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.audioSource }} />
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
            <th className="ptcol-group-2">資料取得先</th>
            <th className="ptcol-group-2">管理会社</th>
            <th className="ptcol-group-2">連絡先</th>
            <th className="ptcol-group-3 progress-col-memo-wide">メモ</th>
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
            <tr key={record.id} className="row-hoverable">
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-1">{renderPostTypeCell(record)}</td>
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
              <td className="ptcell-group-2">{renderSelectCell(record, 'acquisition_source', 'acquisition_source', '資料取得先', '', undefined, true, false)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'management_company', '管理会社')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'contact_info', '連絡先')}</td>
              <td className="ptcell-group-3 progress-col-memo-wide">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-4">{renderIndependentProcessCell(record, 'final_save')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'post_text', 'post_text', '投稿文', '', undefined, true, false)}</td>
              <td className="ptcell-group-4">{renderRegisterCell(record, 'wp_registered')}</td>
              <td className="ptcell-group-4">{renderTextCell(record, 'audio_source', '音源')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function renderStoreProgressTable(mediaRecords: ProductionRecord[], config: NonNullable<ReturnType<typeof getStoreProgressConfig>>) {
    return (
      <table className="progress-table progress-table-keihan">
        <colgroup>
          <col style={{ width: 135 }} />
          <col style={{ width: PROGRESS_INSTAGRAM_COLUMN_WIDTHS.area }} />
          <col style={{ width: 200 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.postText }} />
          <col style={{ width: 296 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-2">{config.typeLabel}</th>
            <th className="ptcol-group-2">物件名</th>
            <th className="ptcol-group-2">号室</th>
            <th className="ptcol-group-2">資料</th>
            <th className="ptcol-group-4">画像編集</th>
            <th className="ptcol-group-4">投稿文</th>
            <th className="ptcol-group-3 progress-col-memo-wide">メモ</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable">
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'post_type', config.typeLabel)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', '物件名')}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'room_number', '号室')}</td>
              <td className="ptcell-group-2">{renderPropertyLink(record)}</td>
              <td className="ptcell-group-4">{renderIndependentProcessCell(record, 'floor_plan_insert')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'post_text', 'post_text', '投稿文', '', undefined, true, false)}</td>
              <td className="ptcell-group-3 progress-col-memo-wide">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function renderRecruitmentTable(mediaRecords: ProductionRecord[]) {
    return (
      <table className="progress-table progress-table-recruitment">
        <colgroup>
          <col style={{ width: 135 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 135 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 296 }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.postText }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ptcol-group-1">投稿予定日</th>
            <th className="ptcol-group-1">曜日</th>
            <th className="ptcol-group-1">撮影予定日</th>
            <th className="ptcol-group-2">投稿種類</th>
            <th className="ptcol-group-2">タイトル</th>
            <th className="ptcol-group-3 progress-col-memo-wide">メモ</th>
            <th className="ptcol-group-3">動画尺</th>
            <th className="ptcol-group-3">文字入れ</th>
            <th className="ptcol-group-3">仕上げ</th>
            <th className="ptcol-group-4">投稿文</th>
            <th className="ptcol-group-4">完成品保存</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable">
              <td className="ptcell-group-1">{renderDateCell(record, 'scheduled_post_date', isDelayed(record))}</td>
              <td className="ptcell-group-1">{getWeekdayLabel(record.scheduled_post_date)}</td>
              <td className="ptcell-group-1">{renderDateCell(record, 'material_saved')}</td>
              <td className="ptcell-group-2">{renderRecruitmentPostTypeCell(record)}</td>
              <td className="ptcell-group-2">{renderTextCell(record, 'property_name', 'タイトル')}</td>
              <td className="ptcell-group-3 progress-col-memo-wide">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'video_duration', 'duration')}</td>
              <td className="ptcell-group-3">{renderIndependentProcessCell(record, 'text_overlay')}</td>
              <td className="ptcell-group-3">{renderSelectCell(record, 'floor_plan_check', getProcessGroupByField('floor_plan_check'), '仕上げ')}</td>
              <td className="ptcell-group-4">{renderSelectCell(record, 'post_text', 'post_text', '投稿文', '', undefined, true, false)}</td>
              <td className="ptcell-group-4">{renderIndependentProcessCell(record, 'final_save')}</td>
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
          <col style={{ width: 135 }} />
          <col style={{ width: 135 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 200 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 232 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 146 }} />
          <col style={{ width: 83 }} />
          <col style={{ width: PROGRESS_SHARED_COLUMN_WIDTHS.rent }} />
          <col style={{ width: 166 }} />
          <col style={{ width: 101 }} />
          <col style={{ width: 296 }} />
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
            <th className="ptcol-group-3 progress-col-memo-wide">メモ</th>
            <th className="ptcol-group-5">完了</th>
            <th className="ptcol-group-5">削除</th>
          </tr>
        </thead>
        <tbody>
          {mediaRecords.map((record) => (
            <tr key={record.id} className="row-hoverable">
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
              <td className="ptcell-group-3 progress-col-memo-wide">{renderTextCell(record, 'memo', 'メモ')}</td>
              <td className="ptcell-group-5">{renderCheckboxCell(record, 'post_completed')}</td>
              <td className="ptcell-group-5">{renderEditCell(record)}</td>
              <td className="ptcell-group-5">{renderDeleteCell(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  void renderSimpleTable

  function renderFormBody() {
    if (formTab === 'basic' && isRecruitmentMedia(form.media)) {
      return (
        <>
          <label className="form-label">
            媒体
            <select value={form.media} onChange={(e) => handleMediaChange(e.target.value)}>
              {MEDIA_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              投稿予定日
              <input type="date" value={form.scheduled_post_date} onChange={(e) => setForm({ ...form, scheduled_post_date: e.target.value })} />
            </label>
            <label className="form-label">
              撮影予定日
              <input type="date" value={form.material_saved} onChange={(e) => setForm({ ...form, material_saved: e.target.value })} />
            </label>
          </div>
          <label className="form-label">
            投稿種類
            <select value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
              <option value="">選んでください</option>
              {RECRUITMENT_POST_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            タイトル
            <input {...getProgressFormInputProps('property_name')} value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
          </label>
          <label className="form-label">
            メモ
            <textarea {...getProgressFormInputProps('memo')} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </label>
        </>
      )
    }

    if (formTab === 'basic') {
      return (
        <>
          <label className="form-label">
            媒体
            <select value={form.media} onChange={(e) => handleMediaChange(e.target.value)}>
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
              <input {...getProgressFormInputProps('property_name')} value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
            </label>
            <label className="form-label">
              号室
              <input {...getProgressFormInputProps('room_number')} value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} />
            </label>
          </div>
          <label className="form-label">
            住所
            <input {...getProgressFormInputProps('property_address')} value={form.property_address} onChange={(e) => setForm({ ...form, property_address: e.target.value })} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              エリア
              <input {...getProgressFormInputProps('area')} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </label>
            <label className="form-label">
              最寄り駅
              <input {...getProgressFormInputProps('nearest_station')} value={form.nearest_station} onChange={(e) => setForm({ ...form, nearest_station: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              間取り
              <input {...getProgressFormInputProps('floor_plan')} value={form.floor_plan} onChange={(e) => setForm({ ...form, floor_plan: e.target.value })} />
            </label>
            <label className="form-label">
              家賃
              <input
                {...getProgressFormInputProps('rent')}
                value={form.rent}
                onChange={(e) => setForm({ ...form, rent: e.target.value })}
                onBlur={(e) => setForm((prev) => ({ ...prev, rent: formatRentValue(e.target.value) }))}
              />
            </label>
            <label className="form-label">
              資料取得先
              <select value={form.acquisition_source} onChange={(e) => setForm({ ...form, acquisition_source: e.target.value })}>
                <option value="">未設定</option>
                {selectOptions.acquisition_source.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="form-label">
              管理会社
              <input {...getProgressFormInputProps('management_company')} value={form.management_company} onChange={(e) => setForm({ ...form, management_company: e.target.value })} />
            </label>
            <label className="form-label">
              連絡先
              <input {...getProgressFormInputProps('contact_info')} value={form.contact_info} onChange={(e) => setForm({ ...form, contact_info: e.target.value })} />
            </label>
          </div>
          {isInstagramMedia(form.media) ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="form-label">
                種別
                <select value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
                  <option value="">選んでください</option>
                  {INSTAGRAM_POST_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                物件番号
                <input value={form.property_number} onChange={(e) => setForm({ ...form, property_number: e.target.value })} />
              </label>
            </div>
          ) : (
            <label className="form-label">
              物件番号
              <input value={form.property_number} onChange={(e) => setForm({ ...form, property_number: e.target.value })} />
            </label>
          )}
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
              図面準備
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
            <textarea {...getProgressFormInputProps('memo')} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </label>
        </>
      )
    }

    return (
      <>
        <label className="form-label">
          投稿文
          <select value={form.post_text} onChange={(e) => setForm({ ...form, post_text: e.target.value })}>
            <option value="">未設定</option>
            {selectOptions.post_text.map((option) => <option key={option} value={option}>{option}</option>)}
            {form.post_text && !selectOptions.post_text.includes(form.post_text) && (
              <option value={form.post_text}>{form.post_text}</option>
            )}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="form-label">
            WP登録
            <select value={form.wp_registered} onChange={(e) => setForm({ ...form, wp_registered: e.target.value })}>
              {selectOptions.register_wp.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="form-label">
            YouTube
            <select value={form.youtube_reserved} onChange={(e) => setForm({ ...form, youtube_reserved: e.target.value })}>
              {selectOptions.register_youtube.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="form-label">
            音源
            <input {...getProgressFormInputProps('audio_source')} value={form.audio_source} onChange={(e) => setForm({ ...form, audio_source: e.target.value })} />
          </label>
          <label className="form-label">
            AOS
            <select value={form.aos_registered} onChange={(e) => setForm({ ...form, aos_registered: e.target.value })}>
              {selectOptions.register_aos.map((option) => <option key={option} value={option}>{option}</option>)}
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
          <strong className="progress-stat-value">{stockedRecords.length}</strong>
        </div>
        {MEDIA_OPTIONS.map((media, index) => (
          <div key={media} className="progress-stat">
            <span className="progress-stat-label">{SUMMARY_LABELS[index] || media}</span>
            <strong className="progress-stat-value">{stockedRecords.filter((record) => getMediaDisplayName(record.media) === media).length}</strong>
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

        {!loading && groupedRecords.length === 0 && (
          <p style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>まだ進捗データがありません</p>
        )}

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
              ) : isRecruitmentMedia(media) ? (
                renderRecruitmentTable(mediaRecords)
              ) : isTikTokMedia(media) ? (
                renderTikTokTable(mediaRecords)
              ) : isInstagramMedia(media) ? (
                renderInstagramTable(mediaRecords)
              ) : getStoreProgressConfig(media) ? (
                renderStoreProgressTable(mediaRecords, getStoreProgressConfig(media)!)
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
                  (selectMenu.group.startsWith('register')
                    ? getRegisterLabel(
                        String(records.find((record) => record.id === selectMenu.id)?.[selectMenu.field] || ''),
                        selectOptions[selectMenu.group],
                      )
                    : String(records.find((record) => record.id === selectMenu.id)?.[selectMenu.field] || '')) === option
                    ? ' is-active'
                    : ''
                }`}
                onClick={() => {
                  updateField(
                    selectMenu.id,
                    selectMenu.field,
                    option,
                  )
                  setSelectMenu(null)
                }}
              >
                {option}
              </button>
            ))}
            <button
              type="button"
              className="progress-editable-select-edit"
              onClick={() => updateSelectOptions(selectMenu.group)}
              title="編集"
              aria-label="編集"
            >
              ✎
            </button>
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
                    <span>資料取得先: {record.acquisition_source || '未入力'}</span>
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
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--gray-500)', lineHeight: 1.8 }}>最初は4つだけ入れて保存できます。残りは下の一覧でそのまま入力できます。</p>
                <label className="form-label">
                  媒体
                  <select value={form.media} onChange={(e) => handleMediaChange(e.target.value)}>
                    {MEDIA_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                {isInstagramMedia(form.media) && (
                  <label className="form-label">
                    種別
                    <select value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
                      <option value="">選んでください</option>
                      {INSTAGRAM_POST_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                )}
                {isRecruitmentMedia(form.media) && (
                  <label className="form-label">
                    投稿種類
                    <select value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
                      <option value="">選んでください</option>
                      {RECRUITMENT_POST_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="form-label">
                  {isRecruitmentMedia(form.media) ? '撮影予定日' : '素材保存日'}
                  <input type="date" value={form.material_saved} onChange={(e) => setForm({ ...form, material_saved: e.target.value })} />
                </label>
                <label className="form-label">
                  投稿予定日
                  <input type="date" value={form.scheduled_post_date} onChange={(e) => setForm({ ...form, scheduled_post_date: e.target.value })} />
                </label>
                <label className="form-label">
                  {isRecruitmentMedia(form.media) ? 'タイトル' : '物件名'}
                  <input {...getProgressFormInputProps('property_name')} value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
                </label>
                {!isRecruitmentMedia(form.media) && (
                  <label className="form-label">
                    号室
                    <input {...getProgressFormInputProps('room_number')} value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} />
                  </label>
                )}
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
