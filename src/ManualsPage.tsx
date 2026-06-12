import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { mergeAttributes } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TextAlign from '@tiptap/extension-text-align'
import { FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { supabase } from './supabase'
import './ManualsPage.css'

const integer = new Intl.NumberFormat('ja-JP')

function formatInteger(value: number | string | null | undefined): string {
  const numericValue = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value ?? 0)
  return integer.format(Number.isFinite(numericValue) ? numericValue : 0)
}

type NoteRecord = {
  id: string
  title: string
  content: string
  section_id: string | null
  sort_order: number
  created_at?: string
  updated_at?: string
}

type SectionRecord = {
  id: string
  name: string
  sort_order: number
}

type TagRecord = {
  id: string
  name: string
}

type NoteTagRecord = {
  page_id: string
  category_id: string
}

type NoteAccessRecord = {
  page_id: string
  email: string
}

type AllowedAccountOption = {
  id: string
  email: string
  is_master?: boolean
}

type NoteDraft = {
  id: string
  title: string
  content: string
  section_id: string | null
  sort_order: number
  tagIds: string[]
  accessMode: 'all' | 'selected'
  allowedEmails: string[]
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const IMAGE_BUCKET = 'manual-images'
const EMPTY_CONTENT = '<p></p>'
const NO_SECTION_ID = 'no-section'
const AUTOSAVE_DELAY = 1500
const SAVE_STATUS_TIMEOUT = 15000
const IMAGE_MIN_WIDTH = 80
const IMAGE_MAX_WIDTH = 920
const DEFAULT_IMAGE_WIDTH = 480
const DEFAULT_FONT_SIZE = 11

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

const TEXT_COLORS = [
  { label: '黒', value: '#111827' },
  { label: '赤', value: '#dc2626' },
  { label: '青', value: '#2563eb' },
  { label: '緑', value: '#16a34a' },
  { label: 'オレンジ', value: '#ea580c' },
  { label: '紫', value: '#7c3aed' },
] as const

const HIGHLIGHT_COLORS = [
  { label: '黄', value: '#fef08a' },
  { label: '緑', value: '#bbf7d0' },
  { label: 'ピンク', value: '#fbcfe8' },
] as const

function getSectionKey(sectionId: string | null) {
  return sectionId ?? NO_SECTION_ID
}

function sectionKeyToValue(sectionKey: string) {
  return sectionKey === NO_SECTION_ID ? null : sectionKey
}

function sortByOrder<T extends { sort_order: number; created_at?: string }>(items: T[]) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

function noteSignature(draft: NoteDraft) {
  return JSON.stringify({
    id: draft.id,
    title: draft.title,
    content: draft.content,
    section_id: draft.section_id,
    sort_order: draft.sort_order,
    tagIds: [...draft.tagIds].sort(),
    accessMode: draft.accessMode,
    allowedEmails: [...draft.allowedEmails].map(normalizeEmail).sort(),
  })
}

function createRealtimeDebouncedHandler(callback: () => void, delay = 300) {
  let timer: ReturnType<typeof window.setTimeout> | undefined

  const handler = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(callback, delay)
  }

  handler.cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer)
  }

  return handler
}

function ResizableImageView({ node, selected, updateAttributes }: NodeViewProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const width = typeof node.attrs.width === 'number' ? node.attrs.width : DEFAULT_IMAGE_WIDTH

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: width }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return
      const nextWidth = Math.max(
        IMAGE_MIN_WIDTH,
        Math.min(IMAGE_MAX_WIDTH, dragRef.current.startWidth + moveEvent.clientX - dragRef.current.startX),
      )
      updateAttributes({ width: Math.round(nextWidth) })
    }

    const handleMouseUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <NodeViewWrapper className={`note-image-box${selected ? ' is-selected' : ''}`} style={{ position: 'relative', display: 'inline-block' }}>
      <img src={String(node.attrs.src)} width={width} alt="" draggable={false} />
      <div className="note-image-handle" onMouseDown={handleMouseDown} />
    </NodeViewWrapper>
  )
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: DEFAULT_IMAGE_WIDTH,
        parseHTML: (element) => Number.parseInt(element.getAttribute('width') ?? `${DEFAULT_IMAGE_WIDTH}`, 10) || DEFAULT_IMAGE_WIDTH,
        renderHTML: (attributes) => ({ width: String(attributes.width) }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

const CustomHighlight = Highlight.extend({
  renderHTML({ HTMLAttributes }) {
    const color = (HTMLAttributes as Record<string, string>).color ?? '#fef08a'
    const restAttrs = { ...(HTMLAttributes as Record<string, unknown>) }
    delete restAttrs.style
    return [
      'mark',
      mergeAttributes(restAttrs, {
        style: `background: linear-gradient(transparent 62%, ${color} 62%); color: inherit;`,
        'data-hc': color,
      }),
      0,
    ]
  },
  parseHTML() {
    return [
      {
        tag: 'mark',
        getAttrs: (el) => ({
          color:
            (el as HTMLElement).getAttribute('data-hc') ??
            (el as HTMLElement).style.backgroundColor ??
            null,
        }),
      },
    ]
  },
})

function SortableNoteItem({
  note,
  selected,
  isPending,
  onSelect,
  onDelete,
}: {
  note: NoteRecord
  selected: boolean
  isPending: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    data: { type: 'note', sectionId: getSectionKey(note.section_id) },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="note-list-row">
      <button type="button" className={`note-list-item${selected ? ' is-selected' : ''}`} onClick={onSelect}>
        <span className="note-drag-handle" {...attributes} {...listeners}>⋮⋮</span>
        <span className="note-list-title">
          {note.title || '無題ノート'}
          {isPending && <span className="note-unsaved-badge"> 未保存</span>}
        </span>
      </button>
      <button type="button" className="note-icon-button note-delete-button" onClick={onDelete} aria-label="ノートを削除">
        ×
      </button>
    </div>
  )
}

function DroppableNoteGroup({
  sectionKey,
  noteIds,
  children,
}: {
  sectionKey: string
  noteIds: string[]
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${sectionKey}`,
    data: { type: 'section', sectionId: sectionKey },
  })

  return (
    <SortableContext items={noteIds} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={`note-group-body${isOver ? ' is-over' : ''}`}>
        {children}
      </div>
    </SortableContext>
  )
}

function SortableSectionItem({
  section,
  sectionNotes,
  collapsed,
  isEditing,
  editingName,
  selectedNoteId,
  pendingNoteId,
  onToggle,
  onStartEdit,
  onEditNameChange,
  onSaveName,
  onDelete,
  onSelectNote,
  onDeleteNote,
}: {
  section: SectionRecord
  sectionNotes: NoteRecord[]
  collapsed: boolean
  isEditing: boolean
  editingName: string
  selectedNoteId: string | null
  pendingNoteId: string | null
  onToggle: () => void
  onStartEdit: () => void
  onEditNameChange: (name: string) => void
  onSaveName: () => void
  onDelete: () => void
  onSelectNote: (noteId: string) => void
  onDeleteNote: (noteId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `section-sort:${section.id}`,
    data: { type: 'section' },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="note-section">
      <div className="note-section-head">
        <span className="note-drag-handle note-section-drag-handle" {...attributes} {...listeners}>⋮⋮</span>
        <button type="button" className="note-section-toggle" onClick={onToggle}>
          {collapsed ? '▶' : '▼'}
        </button>
        {isEditing ? (
          <input
            className="note-section-name-input"
            value={editingName}
            onChange={(event) => onEditNameChange(event.target.value)}
            onBlur={onSaveName}
            onKeyDown={(event) => { if (event.key === 'Enter') onSaveName() }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="note-section-name"
            onClick={onStartEdit}
          >
            {section.name}
          </button>
        )}
        <button type="button" className="note-icon-button" onClick={onDelete} aria-label="セクションを削除">×</button>
      </div>
      {!collapsed && (
        <DroppableNoteGroup sectionKey={section.id} noteIds={sectionNotes.map((note) => note.id)}>
          {sectionNotes.map((note) => (
            <SortableNoteItem
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              isPending={note.id === pendingNoteId}
              onSelect={() => onSelectNote(note.id)}
              onDelete={() => onDeleteNote(note.id)}
            />
          ))}
          {sectionNotes.length === 0 && <p className="note-empty-text">ここに移動できます</p>}
        </DroppableNoteGroup>
      )}
    </div>
  )
}

function ManualsPage({
  currentUserEmail,
  allowedAccounts,
}: {
  currentUserEmail: string | null
  allowedAccounts: AllowedAccountOption[]
}) {
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [pendingNote, setPendingNote] = useState<NoteRecord | null>(null)
  const [sections, setSections] = useState<SectionRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const [noteTags, setNoteTags] = useState<NoteTagRecord[]>([])
  const [noteAccess, setNoteAccess] = useState<NoteAccessRecord[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [searchText, setSearchText] = useState('')
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>([])
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set())
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [newTagName, setNewTagName] = useState('')
  const [newSectionName, setNewSectionName] = useState('')
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingSectionName, setEditingSectionName] = useState('')
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [markerPickerOpen, setMarkerPickerOpen] = useState(false)
  const [tablePickerOpen, setTablePickerOpen] = useState(false)
  const [tableHover, setTableHover] = useState<{ rows: number; cols: number } | null>(null)
  const [activeColor, setActiveColor] = useState('#111827')
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef<NoteDraft | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const fadeTimerRef = useRef<number | null>(null)
  const savingWatchdogRef = useRef<number | null>(null)
  const lastSavedSignatureRef = useRef('')
  const uploadImageRef = useRef<((file: File) => Promise<void>) | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const setTimedStatus = useCallback((state: SaveState, message: string) => {
    setSaveState(state)
    setSaveMessage(message)
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
    if (savingWatchdogRef.current) window.clearTimeout(savingWatchdogRef.current)
    if (state === 'saving') {
      savingWatchdogRef.current = window.setTimeout(() => {
        const currentDraft = draftRef.current
        if (currentDraft && noteSignature(currentDraft) === lastSavedSignatureRef.current) {
          setSaveMessage('')
          setSaveState('idle')
          return
        }
        setSaveState('error')
        setSaveMessage('保存が終わりませんでした。もう一度保存してください')
      }, SAVE_STATUS_TIMEOUT)
    }
    if (state === 'saved' || state === 'error') {
      fadeTimerRef.current = window.setTimeout(() => {
        setSaveMessage('')
        setSaveState('idle')
      }, state === 'saved' ? 1000 : 2500)
    }
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize.configure({ types: ['textStyle'] }),
      CustomHighlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, autolink: true }),
      ResizableImage,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: EMPTY_CONTENT,
    editorProps: {
      transformPastedHTML: (html) => {
        let cleaned = html

        // src無し・空srcのimgを削除（Google Docsから来る不可視ノード）
        cleaned = cleaned.replace(/<img(?![^>]*src\s*=\s*["'][^"']+["'])[^>]*\/?>/gi, '')

        // colgroupを削除（Tiptapが不要なスペースを生成する原因）
        cleaned = cleaned.replace(/<colgroup[^>]*>[\s\S]*?<\/colgroup>/gi, '')

        // td/th直後の空p・brのみ段落を削除
        cleaned = cleaned.replace(/(<t[dh][^>]*>)(\s*<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>)+/gi, '$1')

        const pastedDocument = new DOMParser().parseFromString(cleaned, 'text/html')

        pastedDocument.querySelectorAll('tr, td, th, p').forEach((element) => {
          if (!(element instanceof HTMLElement)) return
          element.style.removeProperty('height')
          element.style.removeProperty('min-height')
          if (!element.getAttribute('style')?.trim()) element.removeAttribute('style')
        })

        pastedDocument.querySelectorAll('td, th').forEach((cell) => {
          while (
            cell.firstElementChild?.tagName.toLowerCase() === 'p' &&
            !cell.firstElementChild.textContent?.replace(/\u00a0/g, '').trim() &&
            !cell.firstElementChild.querySelector('img, table')
          ) {
            cell.firstElementChild.remove()
          }
        })

        cleaned = pastedDocument.body.innerHTML

        return cleaned.replace(
          /<span([^>]*?)style="([^"]*?font-weight\s*:\s*(?:bold|[6-9]\d{2})[^"]*?)"([^>]*)>([\s\S]*?)<\/span>/gi,
          (_match, before, _style, after, inner) => `<strong><span${before}${after}>${inner}</span></strong>`,
        )
      },
      handlePaste: (_view, event) => {
        const imageFile = Array.from(event.clipboardData?.items ?? [])
          .find((item) => item.type.startsWith('image/'))
          ?.getAsFile()

        if (!imageFile || !uploadImageRef.current) return false
        void uploadImageRef.current(imageFile)
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setDraft((current) => (current ? { ...current, content: currentEditor.getHTML() } : current))
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const attrs = currentEditor.getAttributes('textStyle')
      const colorAtCursor = attrs.color as string | undefined
      setActiveColor(colorAtCursor ?? '#111827')
      const fontSizeStr = attrs.fontSize as string | undefined
      if (fontSizeStr) {
        const parsed = parseInt(fontSizeStr, 10)
        if (!isNaN(parsed) && parsed >= 8 && parsed <= 72) setFontSize(parsed)
      } else {
        setFontSize(DEFAULT_FONT_SIZE)
      }
    },
  })

  const applyFontSize = useCallback((size: number) => {
    const clamped = Math.min(72, Math.max(8, size))
    setFontSize(clamped)
    editor?.chain().focus().setFontSize(`${clamped}px`).run()
  }, [editor])

  const allowedAccountEmails = useMemo(
    () => allowedAccounts.map((account) => normalizeEmail(account.email)).filter(Boolean),
    [allowedAccounts],
  )

  const normalizedCurrentUserEmail = normalizeEmail(currentUserEmail ?? '')

  const loadData = useCallback(async () => {
    setLoading(true)
    const [notesResult, sectionsResult, tagsResult, noteTagsResult, noteAccessResult] = await Promise.all([
      supabase.from('manual_pages').select('id, title, content, section_id, sort_order, created_at, updated_at').order('sort_order', { ascending: true }),
      supabase.from('manual_sections').select('id, name, sort_order').order('sort_order', { ascending: true }),
      supabase.from('manual_categories').select('id, name').order('name', { ascending: true }),
      supabase.from('manual_page_categories').select('page_id, category_id'),
      supabase.from('manual_page_allowed_accounts').select('page_id, email'),
    ])

    if (notesResult.error || sectionsResult.error || tagsResult.error || noteTagsResult.error) {
      setTimedStatus('error', '読み込みに失敗しました')
      setLoading(false)
      return
    }

    const nextNotes = (notesResult.data ?? []) as NoteRecord[]
    setNotes(nextNotes)
    setSections((sectionsResult.data ?? []) as SectionRecord[])
    setTags((tagsResult.data ?? []) as TagRecord[])
    setNoteTags((noteTagsResult.data ?? []) as NoteTagRecord[])
    if (noteAccessResult.error) {
      console.warn('ノート閲覧設定を読み込めませんでした。', noteAccessResult.error.message)
      setNoteAccess([])
    } else {
      setNoteAccess((noteAccessResult.data ?? []) as NoteAccessRecord[])
    }
    setSelectedNoteId((current) => (current && nextNotes.some((note) => note.id === current) ? current : nextNotes[0]?.id ?? null))
    setLoading(false)
  }, [setTimedStatus])

  useEffect(() => {
    void loadData()
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
      if (savingWatchdogRef.current) window.clearTimeout(savingWatchdogRef.current)
    }
  }, [loadData])

  useEffect(() => {
    const reloadManuals = createRealtimeDebouncedHandler(() => {
      const currentDraft = draftRef.current
      if (currentDraft && noteSignature(currentDraft) !== lastSavedSignatureRef.current) return
      void loadData()
    })

    const channel = supabase
      .channel('manuals-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_pages' }, reloadManuals)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_sections' }, reloadManuals)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_categories' }, reloadManuals)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_page_categories' }, reloadManuals)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_page_allowed_accounts' }, reloadManuals)
      .subscribe()

    return () => {
      reloadManuals.cancel()
      supabase.removeChannel(channel)
    }
  }, [loadData])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.note-toolbar-menu, .note-tag-menu-wrap, .note-access-menu-wrap')) return
      setColorPickerOpen(false)
      setMarkerPickerOpen(false)
      setTablePickerOpen(false)
      setTableHover(null)
      setTagMenuOpen(false)
      setAccessMenuOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [])

  const noteAccessMap = useMemo(() => {
    const map = new Map<string, string[]>()
    noteAccess.forEach((entry) => {
      const email = normalizeEmail(entry.email)
      if (!email) return
      const list = map.get(entry.page_id) ?? []
      list.push(email)
      map.set(entry.page_id, list)
    })
    return map
  }, [noteAccess])

  const accessibleNotes = useMemo(
    () => notes.filter((note) => {
      const allowedEmailsForNote = noteAccessMap.get(note.id) ?? []
      return allowedEmailsForNote.length === 0 || allowedEmailsForNote.includes(normalizedCurrentUserEmail)
    }),
    [normalizedCurrentUserEmail, noteAccessMap, notes],
  )

  const selectedNote = useMemo(
    () => pendingNote?.id === selectedNoteId ? pendingNote : accessibleNotes.find((note) => note.id === selectedNoteId) ?? null,
    [accessibleNotes, pendingNote, selectedNoteId],
  )

  useEffect(() => {
    if (pendingNote) return
    if (selectedNoteId && accessibleNotes.some((note) => note.id === selectedNoteId)) return
    setSelectedNoteId(accessibleNotes[0]?.id ?? null)
  }, [accessibleNotes, pendingNote, selectedNoteId])

  const selectedNoteTagIds = useMemo(
    () => noteTags.filter((entry) => entry.page_id === selectedNoteId).map((entry) => entry.category_id),
    [noteTags, selectedNoteId],
  )

  const selectedNoteAllowedEmails = useMemo(
    () => noteAccessMap.get(selectedNoteId ?? '') ?? [],
    [noteAccessMap, selectedNoteId],
  )

  useEffect(() => {
    if (!selectedNote) {
      setDraft(null)
      lastSavedSignatureRef.current = ''
      editor?.commands.setContent(EMPTY_CONTENT, { emitUpdate: false })
      return
    }

    const nextDraft: NoteDraft = {
      id: selectedNote.id,
      title: selectedNote.title ?? '',
      content: selectedNote.content || EMPTY_CONTENT,
      section_id: selectedNote.section_id,
      sort_order: selectedNote.sort_order,
      tagIds: selectedNoteTagIds,
      accessMode: selectedNoteAllowedEmails.length > 0 ? 'selected' : 'all',
      allowedEmails: selectedNoteAllowedEmails.length > 0 ? selectedNoteAllowedEmails : allowedAccountEmails,
    }

    const currentDraft = draftRef.current
    const isSwitchingNote = currentDraft?.id !== selectedNote.id
    const nextSignature = noteSignature(nextDraft)
    lastSavedSignatureRef.current = nextSignature
    if (!isSwitchingNote && currentDraft && noteSignature(currentDraft) === nextSignature) return

    setDraft(nextDraft)
    if (isSwitchingNote) {
      setSaveState('idle')
      setSaveMessage('')
    }
    editor?.commands.setContent(nextDraft.content, { emitUpdate: false })
  }, [allowedAccountEmails, editor, selectedNote, selectedNoteAllowedEmails, selectedNoteTagIds])

  const noteTagMap = useMemo(() => {
    const map = new Map<string, string[]>()
    noteTags.forEach((entry) => {
      const list = map.get(entry.page_id) ?? []
      list.push(entry.category_id)
      map.set(entry.page_id, list)
    })
    return map
  }, [noteTags])

  const filteredNotes = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const base = accessibleNotes.filter((note) => {
      const currentTagIds = noteTagMap.get(note.id) ?? []
      const hasSelectedTag = selectedFilterTagIds.length === 0 || selectedFilterTagIds.some((tagId) => currentTagIds.includes(tagId))
      const matchesTitle = keyword.length === 0 || (note.title || '').toLowerCase().includes(keyword)
      return hasSelectedTag && matchesTitle
    })
    if (pendingNote) {
      return [pendingNote, ...base]
    }
    return base
  }, [accessibleNotes, noteTagMap, pendingNote, searchText, selectedFilterTagIds])

  const notesBySection = useMemo(() => {
    const map = new Map<string, NoteRecord[]>()
    filteredNotes.forEach((note) => {
      const key = getSectionKey(note.section_id)
      map.set(key, [...(map.get(key) ?? []), note])
    })
    map.forEach((items, key) => map.set(key, sortByOrder(items)))
    return map
  }, [filteredNotes])

  const saveDraft = useCallback(async (target: NoteDraft) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const payload = {
      id: target.id,
      title: target.title.trim() || '無題ノート',
      content: target.content || EMPTY_CONTENT,
      section_id: target.section_id,
      sort_order: target.sort_order,
      updated_at: new Date().toISOString(),
    }

    const pageResult = await supabase.from('manual_pages').upsert(payload)
    if (pageResult.error) {
      setTimedStatus('error', '保存失敗')
      return
    }

    const deleteResult = await supabase.from('manual_page_categories').delete().eq('page_id', target.id)
    if (deleteResult.error) {
      setTimedStatus('error', '保存失敗')
      return
    }

    if (target.tagIds.length > 0) {
      const insertResult = await supabase.from('manual_page_categories').insert(
        target.tagIds.map((categoryId) => ({ page_id: target.id, category_id: categoryId })),
      )
      if (insertResult.error) {
        setTimedStatus('error', '保存失敗')
        return
      }
    }

    const nextAllowedEmails = target.accessMode === 'selected'
      ? Array.from(new Set(target.allowedEmails.map(normalizeEmail)))
        .filter((email) => allowedAccountEmails.includes(email))
      : []

    const deleteAccessResult = await supabase.from('manual_page_allowed_accounts').delete().eq('page_id', target.id)
    if (deleteAccessResult.error) {
      setTimedStatus('error', '閲覧設定の保存に失敗しました')
      return
    }

    if (nextAllowedEmails.length > 0) {
      const insertAccessResult = await supabase.from('manual_page_allowed_accounts').insert(
        nextAllowedEmails.map((email) => ({ page_id: target.id, email })),
      )
      if (insertAccessResult.error) {
        setTimedStatus('error', '閲覧設定の保存に失敗しました')
        return
      }
    }

    const savedTarget: NoteDraft = { ...target, allowedEmails: nextAllowedEmails }
    lastSavedSignatureRef.current = noteSignature(savedTarget)
    setNotes((current) => {
      const isNew = !current.some((note) => note.id === target.id)
      return isNew
        ? [...current, { ...target, ...payload }]
        : current.map((note) => (note.id === target.id ? { ...note, ...payload } : note))
    })
    setNoteTags((current) => [
      ...current.filter((entry) => entry.page_id !== target.id),
      ...target.tagIds.map((categoryId) => ({ page_id: target.id, category_id: categoryId })),
    ])
    setNoteAccess((current) => [
      ...current.filter((entry) => entry.page_id !== target.id),
      ...nextAllowedEmails.map((email) => ({ page_id: target.id, email })),
    ])
    setDraft(savedTarget)
    if (pendingNote?.id === target.id) setPendingNote(null)
    setTimedStatus('saved', '保存済み ✓')
  }, [allowedAccountEmails, pendingNote?.id, setTimedStatus])

  const flushSave = useCallback(async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    if (noteSignature(currentDraft) !== lastSavedSignatureRef.current) {
      await saveDraft(currentDraft)
    }
  }, [saveDraft])

  useEffect(() => {
    if (!draft) return
    if (pendingNote?.id === draft.id) return
    if (noteSignature(draft) === lastSavedSignatureRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void saveDraft(draft)
    }, AUTOSAVE_DELAY)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [draft, pendingNote?.id, saveDraft, setTimedStatus])

  const createNote = async () => {
    await flushSave()
    if (pendingNote) {
      setSelectedNoteId(pendingNote.id)
      return
    }

    const id = crypto.randomUUID()
    const maxOrder = notes
      .filter((note) => note.section_id === null)
      .reduce((max, note) => Math.max(max, note.sort_order), -1)
    const newNote: NoteRecord = {
      id,
      title: '',
      content: EMPTY_CONTENT,
      section_id: null,
      sort_order: maxOrder + 1,
      updated_at: new Date().toISOString(),
    }
    setPendingNote(newNote)
    setSelectedNoteId(id)
  }

  const deleteNote = async (noteId: string) => {
    const title = pendingNote?.id === noteId
      ? '無題ノート（未保存）'
      : (notes.find((note) => note.id === noteId)?.title || '無題ノート')
    const ok = window.confirm(`「${title}」を削除しますか？`)
    if (!ok) return

    if (noteId === pendingNote?.id) {
      setPendingNote(null)
      setSelectedNoteId(notes[0]?.id ?? null)
      return
    }

    if (selectedNoteId === noteId) {
      setSelectedNoteId(null)
      setDraft(null)
    }
    await supabase.from('manual_page_allowed_accounts').delete().eq('page_id', noteId)
    await supabase.from('manual_page_categories').delete().eq('page_id', noteId)
    const result = await supabase.from('manual_pages').delete().eq('id', noteId)
    if (result.error) {
      setTimedStatus('error', 'ノート削除に失敗しました')
      return
    }
    setNotes((current) => {
      const next = current.filter((note) => note.id !== noteId)
      if (selectedNoteId === noteId) setSelectedNoteId(next[0]?.id ?? null)
      return next
    })
    setNoteTags((current) => current.filter((entry) => entry.page_id !== noteId))
    setNoteAccess((current) => current.filter((entry) => entry.page_id !== noteId))
  }

  const createTag = async () => {
    const name = newTagName.trim()
    if (!name) return
    const existingTag = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
    if (existingTag) {
      setNewTagName('')
      return
    }
    const newTag: TagRecord = { id: crypto.randomUUID(), name }
    const result = await supabase.from('manual_categories').insert(newTag)
    if (result.error) {
      setTimedStatus('error', 'タグ作成に失敗しました')
      return
    }
    setTags((current) => [...current, newTag].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
    setNewTagName('')
  }

  const deleteTag = async (tagId: string) => {
    const result = await supabase.from('manual_categories').delete().eq('id', tagId)
    if (result.error) {
      setTimedStatus('error', 'タグ削除に失敗しました')
      return
    }
    setTags((current) => current.filter((tag) => tag.id !== tagId))
    setNoteTags((current) => current.filter((entry) => entry.category_id !== tagId))
    setSelectedFilterTagIds((current) => current.filter((id) => id !== tagId))
    setDraft((current) => current ? { ...current, tagIds: current.tagIds.filter((id) => id !== tagId) } : current)
  }

  const createSection = async () => {
    const name = newSectionName.trim()
    if (!name) return
    const maxOrder = sections.reduce((max, section) => Math.max(max, section.sort_order), -1)
    const section: SectionRecord = { id: crypto.randomUUID(), name, sort_order: maxOrder + 1 }
    const result = await supabase.from('manual_sections').insert(section)
    if (result.error) {
      setTimedStatus('error', 'セクション作成に失敗しました')
      return
    }
    setSections((current) => sortByOrder([...current, section]))
    setNewSectionName('')
  }

  const saveSectionName = async () => {
    if (!editingSectionId) return
    const name = editingSectionName.trim()
    if (!name) {
      setEditingSectionId(null)
      return
    }
    const result = await supabase.from('manual_sections').update({ name }).eq('id', editingSectionId)
    if (result.error) {
      setTimedStatus('error', 'セクション名の保存に失敗しました')
      return
    }
    setSections((current) => current.map((section) => section.id === editingSectionId ? { ...section, name } : section))
    setEditingSectionId(null)
  }

  const deleteSection = async (sectionId: string) => {
    await supabase.from('manual_pages').update({ section_id: null }).eq('section_id', sectionId)
    const result = await supabase.from('manual_sections').delete().eq('id', sectionId)
    if (result.error) {
      setTimedStatus('error', 'セクション削除に失敗しました')
      return
    }
    setSections((current) => current.filter((section) => section.id !== sectionId))
    setNotes((current) => current.map((note) => note.section_id === sectionId ? { ...note, section_id: null } : note))
  }

  const toggleSection = (sectionKey: string) => {
    setCollapsedSectionIds((current) => {
      const next = new Set(current)
      if (next.has(sectionKey)) next.delete(sectionKey)
      else next.add(sectionKey)
      return next
    })
  }

  const toggleFilterTag = (tagId: string) => {
    setSelectedFilterTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId])
  }

  const addTagToDraft = (tagId: string) => {
    setDraft((current) => {
      if (!current || current.tagIds.includes(tagId)) return current
      return { ...current, tagIds: [...current.tagIds, tagId] }
    })
    setTagMenuOpen(false)
  }

  const removeTagFromDraft = (tagId: string) => {
    setDraft((current) => current ? { ...current, tagIds: current.tagIds.filter((id) => id !== tagId) } : current)
  }

  const toggleDraftAllowedEmail = (email: string) => {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail) return
    setDraft((current) => {
      if (!current) return current
      const baseEmails = current.accessMode === 'all' ? allowedAccountEmails : current.allowedEmails
      const hasEmail = baseEmails.includes(normalizedEmail)
      const nextEmails = hasEmail
        ? baseEmails.filter((item) => item !== normalizedEmail)
        : [...baseEmails, normalizedEmail]
      const dedupedEmails = Array.from(new Set(nextEmails)).filter((item) => allowedAccountEmails.includes(item))
      if (dedupedEmails.length === 0) return current
      const isAllChecked = allowedAccountEmails.length > 0 && dedupedEmails.length === allowedAccountEmails.length
      return {
        ...current,
        accessMode: isAllChecked ? 'all' : 'selected',
        allowedEmails: isAllChecked ? allowedAccountEmails : dedupedEmails,
      }
    })
  }

  const uploadImage = useCallback(async (file: File) => {
    if (!editor || !draftRef.current) return
    setTimedStatus('saving', '画像を保存中...')
    const extension = file.name.split('.').pop() || 'png'
    const path = `${draftRef.current.id}/${crypto.randomUUID()}.${extension}`
    const uploadResult = await supabase.storage.from(IMAGE_BUCKET).upload(path, file)
    if (uploadResult.error) {
      setTimedStatus('error', '画像アップロード失敗')
      return
    }
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path)
    editor.chain().focus().setImage({ src: data.publicUrl, width: DEFAULT_IMAGE_WIDTH }).run()
    setTimedStatus('saved', '画像を追加しました ✓')
  }, [editor, setTimedStatus])

  useEffect(() => {
    uploadImageRef.current = uploadImage
  }, [uploadImage])

  const handleImageFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await uploadImage(file)
    event.target.value = ''
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null)
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!overId || activeId === overId) return

    // セクション並べ替え
    if (activeId.startsWith('section-sort:')) {
      if (!overId.startsWith('section-sort:')) return
      const activeSectionId = activeId.replace('section-sort:', '')
      const overSectionId = overId.replace('section-sort:', '')
      const oldIndex = sections.findIndex((s) => s.id === activeSectionId)
      const newIndex = sections.findIndex((s) => s.id === overSectionId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const nextSections = [...sections]
      const [moved] = nextSections.splice(oldIndex, 1)
      nextSections.splice(newIndex, 0, moved)
      const updatedSections = nextSections.map((s, i) => ({ ...s, sort_order: i }))
      setSections(updatedSections)
      for (const s of updatedSections) {
        await supabase.from('manual_sections').update({ sort_order: s.sort_order }).eq('id', s.id)
      }
      return
    }

    const activeNote = notes.find((note) => note.id === activeId)
    if (!activeNote) return

    const overNote = notes.find((note) => note.id === overId)
    const targetSectionKey = overId.startsWith('section:')
      ? overId.replace('section:', '')
      : overId.startsWith('section-sort:')
      ? overId.replace('section-sort:', '')
      : getSectionKey(overNote?.section_id ?? null)
    const targetSectionId = sectionKeyToValue(targetSectionKey)
    const targetSectionNotes = sortByOrder(notes.filter((note) => getSectionKey(note.section_id) === targetSectionKey && note.id !== activeId))
    const overIndex = overNote ? Math.max(0, targetSectionNotes.findIndex((note) => note.id === overNote.id)) : targetSectionNotes.length
    const nextSectionNotes = [...targetSectionNotes]
    nextSectionNotes.splice(overIndex < 0 ? nextSectionNotes.length : overIndex, 0, { ...activeNote, section_id: targetSectionId })

    const updates = nextSectionNotes.map((note, index) => ({ id: note.id, section_id: targetSectionId, sort_order: index }))
    setNotes((current) => current.map((note) => {
      const update = updates.find((item) => item.id === note.id)
      return update ? { ...note, section_id: update.section_id, sort_order: update.sort_order } : note
    }))

    for (const update of updates) {
      await supabase.from('manual_pages').update({ section_id: update.section_id, sort_order: update.sort_order }).eq('id', update.id)
    }
  }

  const handleSelectNote = async (noteId: string) => {
    await flushSave()
    setSelectedNoteId(noteId)
  }

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void createTag()
    }
  }

  const handleSectionInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void createSection()
    }
  }

  const activeDragNote = notes.find((note) => note.id === activeDragId)
  const activeDragSection = activeDragId?.startsWith('section-sort:')
    ? sections.find((s) => s.id === activeDragId.replace('section-sort:', ''))
    : null
  const selectedTags = tags.filter((tag) => Boolean(draft?.tagIds.includes(tag.id)))
  const availableTags = tags.filter((tag) => !draft?.tagIds.includes(tag.id))
  const selectedAccessCount = draft?.accessMode === 'selected' ? draft.allowedEmails.length : allowedAccountEmails.length
  const checkedAccessEmails = draft?.accessMode === 'all' ? allowedAccountEmails : draft?.allowedEmails ?? []
  const isInTable = editor?.isActive('table') ?? false

  return (
    <div className="note-page-wrapper">
      <section className={`note-page${sidebarOpen ? '' : ' sidebar-closed'}`}>
      <aside className="note-sidebar">
        <div className="note-sidebar-head">
          <strong>Note</strong>
          <button type="button" className="note-plain-button" onClick={() => setSidebarOpen(false)}>閉じる</button>
        </div>

        <label className="note-search">
          <span>🔍</span>
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="タイトル検索" />
        </label>

        <div className="note-filter-block">
          <div className="note-block-title">タグフィルター</div>
          <div className="note-tag-create-row">
            <input
              className="note-new-chip-input"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={handleTagInputKeyDown}
              placeholder="新しいタグ名"
            />
            <button type="button" className="note-secondary-button" onClick={() => void createTag()}>追加</button>
          </div>
          <div className="note-chip-list note-tag-filter-chips">
            {tags.map((tag) => (
              <span key={tag.id} className={`note-chip${selectedFilterTagIds.includes(tag.id) ? ' is-active' : ''}`}>
                <button type="button" onClick={() => toggleFilterTag(tag.id)}>{tag.name}</button>
                <button type="button" className="note-chip-x" onClick={() => void deleteTag(tag.id)} aria-label="タグを削除">×</button>
              </span>
            ))}
          </div>
          <div className="note-section-add">
            <input value={newSectionName} onChange={(event) => setNewSectionName(event.target.value)} onKeyDown={handleSectionInputKeyDown} placeholder="セクション名" />
            <button type="button" className="note-secondary-button" onClick={() => void createSection()}>+ セクション</button>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="note-section-list">
            {loading && <p className="note-empty-text">読み込み中...</p>}
            <SortableContext items={sections.map((s) => `section-sort:${s.id}`)} strategy={verticalListSortingStrategy}>
              {sections.map((section) => {
                const sectionNotes = notesBySection.get(section.id) ?? []
                const collapsed = collapsedSectionIds.has(section.id)
                return (
                  <SortableSectionItem
                    key={section.id}
                    section={section}
                    sectionNotes={sectionNotes}
                    collapsed={collapsed}
                    isEditing={editingSectionId === section.id}
                    editingName={editingSectionName}
                    selectedNoteId={selectedNoteId}
                    pendingNoteId={pendingNote?.id ?? null}
                    onToggle={() => toggleSection(section.id)}
                    onStartEdit={() => {
                      setEditingSectionId(section.id)
                      setEditingSectionName(section.name)
                    }}
                    onEditNameChange={setEditingSectionName}
                    onSaveName={() => void saveSectionName()}
                    onDelete={() => void deleteSection(section.id)}
                    onSelectNote={(noteId) => void handleSelectNote(noteId)}
                    onDeleteNote={(noteId) => void deleteNote(noteId)}
                  />
                )
              })}
            </SortableContext>

            <div className="note-section note-section-none">
              <div className="note-section-head">
                <button type="button" className="note-section-toggle" onClick={() => toggleSection(NO_SECTION_ID)}>
                  {collapsedSectionIds.has(NO_SECTION_ID) ? '▶' : '▼'}
                </button>
                <span className="note-section-name-text">セクションなし</span>
              </div>
              {!collapsedSectionIds.has(NO_SECTION_ID) && (
                <DroppableNoteGroup sectionKey={NO_SECTION_ID} noteIds={(notesBySection.get(NO_SECTION_ID) ?? []).map((note) => note.id)}>
                  {(notesBySection.get(NO_SECTION_ID) ?? []).map((note) => (
                    <SortableNoteItem
                      key={note.id}
                      note={note}
                      selected={note.id === selectedNoteId}
                      isPending={note.id === pendingNote?.id}
                      onSelect={() => void handleSelectNote(note.id)}
                      onDelete={() => void deleteNote(note.id)}
                    />
                  ))}
                  {(notesBySection.get(NO_SECTION_ID) ?? []).length === 0 && <p className="note-empty-text">ノートはありません</p>}
                </DroppableNoteGroup>
              )}
            </div>
          </div>

          <DragOverlay>
            {activeDragSection
              ? <div className="note-drag-preview">{activeDragSection.name}</div>
              : activeDragNote
              ? <div className="note-drag-preview">{activeDragNote.title || '無題ノート'}</div>
              : null}
          </DragOverlay>
        </DndContext>

      </aside>

      <main className="note-main">
        {!sidebarOpen && (
          <button type="button" className="note-main-open-btn" onClick={() => setSidebarOpen(true)}>
            ◀ ノート一覧
          </button>
        )}
        {!draft ? (
          <div className="note-empty-editor">
            <h2>ノートを選んでください</h2>
            <p>左の一覧からノートを選ぶか、新しいノートを作成してください。</p>
          </div>
        ) : (
          <div className="note-editor-card">
            <div className="note-title-row">
              <input
                className="note-title-input"
                value={draft.title}
                onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
                placeholder="タイトルを入力..."
              />
              <span className={`note-save-status ${saveState}`}>{saveMessage}</span>
            </div>

            <div className="note-editor-tags">
              {selectedTags.map((tag) => (
                <span key={tag.id} className="note-chip is-attached">
                  <button type="button">{tag.name}</button>
                  <button type="button" className="note-chip-x" onClick={() => removeTagFromDraft(tag.id)}>×</button>
                </span>
              ))}
              <div className="note-tag-menu-wrap">
                <button type="button" className="note-add-chip" onClick={() => setTagMenuOpen((current) => !current)}>+ タグ</button>
                {tagMenuOpen && (
                  <div className="note-tag-menu">
                    {availableTags.map((tag) => (
                      <button key={tag.id} type="button" onClick={() => addTagToDraft(tag.id)}>{tag.name}</button>
                    ))}
                    {availableTags.length === 0 && <span>追加できるタグはありません</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="note-toolbar">
              <button
                type="button"
                title="元に戻す (Undo)"
                onClick={() => editor?.chain().focus().undo().run()}
                disabled={!editor?.can().undo()}
              >
                ↩
              </button>
              <button
                type="button"
                title="やり直す (Redo)"
                onClick={() => editor?.chain().focus().redo().run()}
                disabled={!editor?.can().redo()}
              >
                ↪
              </button>
              <span className="note-font-size-ctrl">
                <button
                  type="button"
                  title="文字サイズを縮小"
                  onClick={() => applyFontSize(fontSize - 1)}
                >
                  −
                </button>
                <input
                  type="number"
                  className="note-font-size-input"
                  value={fontSize}
                  min={8}
                  max={72}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!isNaN(v)) applyFontSize(v)
                  }}
                />
                <button
                  type="button"
                  title="文字サイズを拡大"
                  onClick={() => applyFontSize(fontSize + 1)}
                >
                  +
                </button>
              </span>
              <button type="button" title="太字 (Bold)" className={editor?.isActive('bold') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></button>
              <button type="button" title="下線 (Underline)" className={editor?.isActive('underline') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>

              <div className="note-toolbar-menu">
                <button
                  type="button"
                  title="文字の色"
                  aria-label="文字色"
                  onClick={() => {
                    setColorPickerOpen((current) => !current)
                    setMarkerPickerOpen(false)
                    setTablePickerOpen(false)
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', lineHeight: 1 }}>
                    <span style={{ fontWeight: 'bold', fontSize: '13px', color: activeColor }}>A</span>
                    <span style={{ width: '14px', height: '3px', background: activeColor, borderRadius: '1px' }} />
                  </span>
                </button>
                <div className={`note-toolbar-popover${colorPickerOpen ? ' is-open' : ''}`}>
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => {
                        setActiveColor(color.value)
                        editor?.chain().focus().setColor(color.value).run()
                        setColorPickerOpen(false)
                      }}
                    >
                      <span className="note-color-swatch" style={{ background: color.value }} />{color.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="note-toolbar-menu">
                <button
                  type="button"
                  title="マーカー (ハイライト)"
                  onClick={() => {
                    setMarkerPickerOpen((current) => !current)
                    setColorPickerOpen(false)
                    setTablePickerOpen(false)
                  }}
                >
                  🖊 マーカー
                </button>
                <div className={`note-toolbar-popover${markerPickerOpen ? ' is-open' : ''}`}>
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => {
                        editor?.chain().focus().setHighlight({ color: color.value }).run()
                        setMarkerPickerOpen(false)
                      }}
                    >
                      <span className="note-color-swatch" style={{ background: color.value }} />{color.label}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" title="箇条書き" className={editor?.isActive('bulletList') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleBulletList().run()}>≡</button>
              <button type="button" title="番号付きリスト" className={editor?.isActive('orderedList') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
              <div className="note-toolbar-menu">
                <button
                  type="button"
                  title="表を挿入"
                  onClick={() => {
                    setTablePickerOpen((current) => !current)
                    setColorPickerOpen(false)
                    setMarkerPickerOpen(false)
                  }}
                >
                  ◫
                </button>
                {tablePickerOpen && (
                  <div className="note-table-picker">
                    <div className="note-table-grid">
                      {Array.from({ length: 8 }, (_, rowIndex) =>
                        Array.from({ length: 8 }, (_, colIndex) => (
                          <div
                            key={`${rowIndex}-${colIndex}`}
                            className={`note-table-cell${tableHover && rowIndex < tableHover.rows && colIndex < tableHover.cols ? ' is-hover' : ''}`}
                            onMouseEnter={() => setTableHover({ rows: rowIndex + 1, cols: colIndex + 1 })}
                            onClick={() => {
                              const size = tableHover ?? { rows: rowIndex + 1, cols: colIndex + 1 }
                              editor?.chain().focus().insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true }).run()
                              setTablePickerOpen(false)
                              setTableHover(null)
                            }}
                          />
                        ))
                      )}
                    </div>
                    <div className="note-table-picker-label">
                      {tableHover ? `${tableHover.rows}行 × ${tableHover.cols}列` : '表のサイズを選択'}
                    </div>
                  </div>
                )}
              </div>
              {isInTable && (
                <span className="note-toolbar-table-ops">
                  <button type="button" title="行を上に追加" onClick={() => editor?.chain().focus().addRowBefore().run()}>↑行</button>
                  <button type="button" title="行を下に追加" onClick={() => editor?.chain().focus().addRowAfter().run()}>↓行</button>
                  <button type="button" title="この行を削除" onClick={() => editor?.chain().focus().deleteRow().run()}>行×</button>
                  <button type="button" title="列を左に追加" onClick={() => editor?.chain().focus().addColumnBefore().run()}>←列</button>
                  <button type="button" title="列を右に追加" onClick={() => editor?.chain().focus().addColumnAfter().run()}>→列</button>
                  <button type="button" title="この列を削除" onClick={() => editor?.chain().focus().deleteColumn().run()}>列×</button>
                  <button type="button" title="表を削除" className="note-toolbar-danger" onClick={() => editor?.chain().focus().deleteTable().run()}>表削除</button>
                </span>
              )}
              <button type="button" title="左寄せ" onClick={() => editor?.chain().focus().setTextAlign('left').run()}>←</button>
              <button type="button" title="中央寄せ" onClick={() => editor?.chain().focus().setTextAlign('center').run()}>↔</button>
              <button type="button" title="右寄せ" onClick={() => editor?.chain().focus().setTextAlign('right').run()}>→</button>
              <button type="button" title="画像を挿入" onClick={() => fileInputRef.current?.click()}>🖼 画像</button>
              <button type="button" title="保存 (自動保存も有効)" className="note-save-button" onClick={() => { if (draft) void saveDraft(draft) }}>保存</button>
              <div className="note-access-menu-wrap">
                <button
                  type="button"
                  className="note-access-button"
                  title="閲覧設定"
                  onClick={() => setAccessMenuOpen((current) => !current)}
                >
                  閲覧設定
                  <span>{draft.accessMode === 'all' ? '全員' : `${formatInteger(selectedAccessCount)}人`}</span>
                </button>
                {accessMenuOpen && (
                  <div className="note-access-popover">
                    <div className="note-access-popover-head">
                      <strong>閲覧できるGoogleアカウント</strong>
                      <span>{formatInteger(selectedAccessCount)}人</span>
                    </div>
                    <div className="note-access-list">
                      {allowedAccounts.map((account) => {
                        const email = normalizeEmail(account.email)
                        return (
                          <label key={account.id} className="note-access-account">
                            <input
                              type="checkbox"
                              checked={checkedAccessEmails.includes(email)}
                              onChange={() => toggleDraftAllowedEmail(email)}
                            />
                            <span>{account.email}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageFileChange} />
            </div>

            <EditorContent editor={editor} className="note-editor" />
          </div>
        )}
      </main>
      </section>
      <button type="button" className="note-fab" onClick={() => void createNote()} aria-label="新規ノート">+</button>
    </div>
  )
}

export default ManualsPage
