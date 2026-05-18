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
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { supabase } from './supabase'
import './ManualsPage.css'

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

type NoteDraft = {
  id: string
  title: string
  content: string
  section_id: string | null
  sort_order: number
  tagIds: string[]
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const IMAGE_BUCKET = 'manual-images'
const EMPTY_CONTENT = '<p></p>'
const NO_SECTION_ID = 'no-section'
const AUTOSAVE_DELAY = 1500
const IMAGE_MIN_WIDTH = 80
const IMAGE_MAX_WIDTH = 920
const DEFAULT_IMAGE_WIDTH = 480

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
  })
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

function ManualsPage() {
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [pendingNote, setPendingNote] = useState<NoteRecord | null>(null)
  const [sections, setSections] = useState<SectionRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const [noteTags, setNoteTags] = useState<NoteTagRecord[]>([])
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
  const lastSavedSignatureRef = useRef('')
  const uploadImageRef = useRef<((file: File) => Promise<void>) | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const setTimedStatus = useCallback((state: SaveState, message: string) => {
    setSaveState(state)
    setSaveMessage(message)
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
    if (state === 'saved' || state === 'error') {
      fadeTimerRef.current = window.setTimeout(() => setSaveMessage(''), 2000)
    }
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
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
      const colorAtCursor = currentEditor.getAttributes('textStyle').color as string | undefined
      setActiveColor(colorAtCursor ?? '#111827')
    },
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    const [notesResult, sectionsResult, tagsResult, noteTagsResult] = await Promise.all([
      supabase.from('manual_pages').select('id, title, content, section_id, sort_order, created_at, updated_at').order('sort_order', { ascending: true }),
      supabase.from('manual_sections').select('id, name, sort_order').order('sort_order', { ascending: true }),
      supabase.from('manual_categories').select('id, name').order('name', { ascending: true }),
      supabase.from('manual_page_categories').select('page_id, category_id'),
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
    setSelectedNoteId((current) => (current && nextNotes.some((note) => note.id === current) ? current : nextNotes[0]?.id ?? null))
    setLoading(false)
  }, [setTimedStatus])

  useEffect(() => {
    void loadData()
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
    }
  }, [loadData])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.note-toolbar-menu, .note-tag-menu-wrap')) return
      setColorPickerOpen(false)
      setMarkerPickerOpen(false)
      setTablePickerOpen(false)
      setTableHover(null)
      setTagMenuOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [])

  const selectedNote = useMemo(
    () => pendingNote?.id === selectedNoteId ? pendingNote : notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, pendingNote, selectedNoteId],
  )

  const selectedNoteTagIds = useMemo(
    () => noteTags.filter((entry) => entry.page_id === selectedNoteId).map((entry) => entry.category_id),
    [noteTags, selectedNoteId],
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
    }

    lastSavedSignatureRef.current = noteSignature(nextDraft)
    setDraft(nextDraft)
    setSaveState('idle')
    setSaveMessage('')
    editor?.commands.setContent(nextDraft.content, { emitUpdate: false })
  }, [editor, selectedNote, selectedNoteTagIds])

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
    const base = notes.filter((note) => {
      const currentTagIds = noteTagMap.get(note.id) ?? []
      const hasSelectedTag = selectedFilterTagIds.length === 0 || selectedFilterTagIds.some((tagId) => currentTagIds.includes(tagId))
      const matchesTitle = keyword.length === 0 || (note.title || '').toLowerCase().includes(keyword)
      return hasSelectedTag && matchesTitle
    })
    if (pendingNote) {
      return [pendingNote, ...base]
    }
    return base
  }, [noteTagMap, notes, pendingNote, searchText, selectedFilterTagIds])

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
    setTimedStatus('saving', '保存中...')
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

    lastSavedSignatureRef.current = noteSignature(target)
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
    if (pendingNote?.id === target.id) setPendingNote(null)
    setTimedStatus('saved', '保存済み ✓')
  }, [pendingNote?.id, setTimedStatus])

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
    if (noteSignature(draft) === lastSavedSignatureRef.current) return
    setTimedStatus('saving', '保存中...')
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void saveDraft(draft)
    }, AUTOSAVE_DELAY)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [draft, saveDraft, setTimedStatus])

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

    const activeNote = notes.find((note) => note.id === activeId)
    if (!activeNote) return

    const overNote = notes.find((note) => note.id === overId)
    const targetSectionKey = overId.startsWith('section:')
      ? overId.replace('section:', '')
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
  const selectedTags = tags.filter((tag) => Boolean(draft?.tagIds.includes(tag.id)))
  const availableTags = tags.filter((tag) => !draft?.tagIds.includes(tag.id))
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
            {sections.map((section) => {
              const sectionKey = section.id
              const sectionNotes = notesBySection.get(sectionKey) ?? []
              const collapsed = collapsedSectionIds.has(sectionKey)
              return (
                <div key={section.id} className="note-section">
                  <div className="note-section-head">
                    <button type="button" className="note-section-toggle" onClick={() => toggleSection(sectionKey)}>
                      {collapsed ? '▶' : '▼'}
                    </button>
                    {editingSectionId === section.id ? (
                      <input
                        className="note-section-name-input"
                        value={editingSectionName}
                        onChange={(event) => setEditingSectionName(event.target.value)}
                        onBlur={() => void saveSectionName()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveSectionName()
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="note-section-name"
                        onClick={() => {
                          setEditingSectionId(section.id)
                          setEditingSectionName(section.name)
                        }}
                      >
                        {section.name}
                      </button>
                    )}
                    <button type="button" className="note-icon-button" onClick={() => void deleteSection(section.id)} aria-label="セクションを削除">×</button>
                  </div>
                  {!collapsed && (
                    <DroppableNoteGroup sectionKey={sectionKey} noteIds={sectionNotes.map((note) => note.id)}>
                      {sectionNotes.map((note) => (
                        <SortableNoteItem
                          key={note.id}
                          note={note}
                          selected={note.id === selectedNoteId}
                          isPending={note.id === pendingNote?.id}
                          onSelect={() => void handleSelectNote(note.id)}
                          onDelete={() => void deleteNote(note.id)}
                        />
                      ))}
                      {sectionNotes.length === 0 && <p className="note-empty-text">ここに移動できます</p>}
                    </DroppableNoteGroup>
                  )}
                </div>
              )
            })}

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
            {activeDragNote ? <div className="note-drag-preview">{activeDragNote.title || '無題ノート'}</div> : null}
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
