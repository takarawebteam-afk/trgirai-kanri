import { useEffect, useMemo, useRef, useState } from 'react'
import Color from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'
import { supabase } from './supabase'

type ManualPageRecord = {
  id: string
  title: string
  content: string
  created_at?: string
  updated_at?: string
}

type ManualCategoryRecord = {
  id: string
  name: string
  created_at?: string
}

type ManualPageCategoryRecord = {
  page_id: string
  category_id: string
}

type ManualPageDraft = {
  id: string
  title: string
  content: string
  categoryIds: string[]
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const MANUAL_IMAGE_BUCKET = 'manual-images'
const EMPTY_CONTENT = '<p></p>'

const ManualImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 480,
        parseHTML: (element) => Number.parseInt(element.getAttribute('data-width') || element.getAttribute('width') || '480', 10) || 480,
        renderHTML: (attributes) => ({
          'data-width': attributes.width,
          width: String(attributes.width),
        }),
      },
    }
  },
})

function ManualsPage() {
  const [pages, setPages] = useState<ManualPageRecord[]>([])
  const [categories, setCategories] = useState<ManualCategoryRecord[]>([])
  const [pageCategories, setPageCategories] = useState<ManualPageCategoryRecord[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ManualPageDraft | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategoryFilters, setActiveCategoryFilters] = useState<string[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveMessage, setSaveMessage] = useState('未保存の変更はありません')
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const lastSavedSignatureRef = useRef('')
  const draftRef = useRef<ManualPageDraft | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      ManualImage,
    ],
    content: EMPTY_CONTENT,
    onUpdate: ({ editor: currentEditor }) => {
      setDraft((current) => {
        if (!current) return current
        return {
          ...current,
          content: currentEditor.getHTML(),
        }
      })
    },
  })

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const loadManualData = async () => {
    setLoading(true)
    const [pagesResult, categoriesResult, junctionsResult] = await Promise.all([
      supabase.from('manual_pages').select('id, title, content, created_at, updated_at').order('updated_at', { ascending: false }),
      supabase.from('manual_categories').select('id, name, created_at').order('name', { ascending: true }),
      supabase.from('manual_page_categories').select('page_id, category_id'),
    ])

    if (pagesResult.error) {
      setSaveState('error')
      setSaveMessage(`ページ取得に失敗しました: ${pagesResult.error.message}`)
    }

    if (categoriesResult.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ取得に失敗しました: ${categoriesResult.error.message}`)
    }

    if (junctionsResult.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ紐付け取得に失敗しました: ${junctionsResult.error.message}`)
    }

    const nextPages = (pagesResult.data ?? []) as ManualPageRecord[]
    const nextCategories = (categoriesResult.data ?? []) as ManualCategoryRecord[]
    const nextPageCategories = (junctionsResult.data ?? []) as ManualPageCategoryRecord[]

    setPages(nextPages)
    setCategories(nextCategories)
    setPageCategories(nextPageCategories)
    setLoading(false)

    setSelectedPageId((currentId) => {
      if (currentId && nextPages.some((page) => page.id === currentId)) return currentId
      return nextPages[0]?.id ?? null
    })
  }

  useEffect(() => {
    void loadManualData()

    const channel = supabase
      .channel('manual-pages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_pages' }, loadManualData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_categories' }, loadManualData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_page_categories' }, loadManualData)
      .subscribe()

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [])

  const categoryNameMap = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  )

  const selectedPageCategoryIds = useMemo(
    () => pageCategories.filter((entry) => entry.page_id === selectedPageId).map((entry) => entry.category_id),
    [pageCategories, selectedPageId],
  )

  useEffect(() => {
    if (!selectedPage) {
      setDraft(null)
      lastSavedSignatureRef.current = ''
      editor?.commands.setContent(EMPTY_CONTENT, { emitUpdate: false })
      return
    }

    const nextDraft = {
      id: selectedPage.id,
      title: selectedPage.title ?? '',
      content: selectedPage.content || EMPTY_CONTENT,
      categoryIds: selectedPageCategoryIds,
    }

    lastSavedSignatureRef.current = JSON.stringify(nextDraft)
    setDraft(nextDraft)
    setSaveState('idle')
    setSaveMessage('未保存の変更はありません')
    editor?.commands.setContent(nextDraft.content || EMPTY_CONTENT, { emitUpdate: false })
  }, [editor, selectedPage, selectedPageCategoryIds])

  const filteredPages = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    return pages.filter((page) => {
      const pageCategoryIds = pageCategories.filter((entry) => entry.page_id === page.id).map((entry) => entry.category_id)
      const pageCategoryNames = pageCategoryIds.map((categoryId) => categoryNameMap[categoryId] || '')
      const plainText = stripHtml(page.content || '').toLowerCase()

      if (activeCategoryFilters.length > 0 && !activeCategoryFilters.every((filterId) => pageCategoryIds.includes(filterId))) {
        return false
      }

      if (!keyword) return true

      return (
        page.title.toLowerCase().includes(keyword) ||
        plainText.includes(keyword) ||
        pageCategoryNames.some((name) => name.toLowerCase().includes(keyword))
      )
    })
  }, [activeCategoryFilters, categoryNameMap, pageCategories, pages, search])

  const updateDraft = (updater: (current: ManualPageDraft) => ManualPageDraft) => {
    setDraft((current) => {
      if (!current) return current
      return updater(current)
    })
  }

  const savePage = async (pageToSave: ManualPageDraft) => {
    setSaveState('saving')
    setSaveMessage('自動保存中...')

    const timestamp = new Date().toISOString()
    const pagePayload = {
      title: pageToSave.title.trim() || '無題',
      content: pageToSave.content || EMPTY_CONTENT,
      updated_at: timestamp,
    }

    const pageResult = await supabase.from('manual_pages').update(pagePayload).eq('id', pageToSave.id)
    if (pageResult.error) {
      setSaveState('error')
      setSaveMessage(`保存に失敗しました: ${pageResult.error.message}`)
      return
    }

    const deleteResult = await supabase.from('manual_page_categories').delete().eq('page_id', pageToSave.id)
    if (deleteResult.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ保存に失敗しました: ${deleteResult.error.message}`)
      return
    }

    if (pageToSave.categoryIds.length > 0) {
      const insertResult = await supabase.from('manual_page_categories').insert(
        pageToSave.categoryIds.map((categoryId) => ({
          page_id: pageToSave.id,
          category_id: categoryId,
        })),
      )
      if (insertResult.error) {
        setSaveState('error')
        setSaveMessage(`カテゴリ保存に失敗しました: ${insertResult.error.message}`)
        return
      }
    }

    lastSavedSignatureRef.current = JSON.stringify(pageToSave)
    setPages((current) =>
      current
        .map((page) => (page.id === pageToSave.id ? { ...page, ...pagePayload } : page))
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    )
    setPageCategories((current) => [
      ...current.filter((entry) => entry.page_id !== pageToSave.id),
      ...pageToSave.categoryIds.map((categoryId) => ({ page_id: pageToSave.id, category_id: categoryId })),
    ])
    setSaveState('saved')
    setSaveMessage(`保存済み ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`)
  }

  const flushPendingSave = async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    const signature = JSON.stringify(currentDraft)
    if (signature === lastSavedSignatureRef.current) return
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }
    await savePage(currentDraft)
  }

  useEffect(() => {
    if (!draft) return

    const signature = JSON.stringify(draft)
    if (signature === lastSavedSignatureRef.current) return

    setSaveState('saving')
    setSaveMessage('変更を検知しました...')

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void savePage(draft)
    }, 800)

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [draft])

  const handleCreatePage = async () => {
    const id = crypto.randomUUID()
    const insertResult = await supabase.from('manual_pages').insert({
      id,
      title: '新しいページ',
      content: EMPTY_CONTENT,
      updated_at: new Date().toISOString(),
    })

    if (insertResult.error) {
      setSaveState('error')
      setSaveMessage(`ページ作成に失敗しました: ${insertResult.error.message}`)
      return
    }

    await loadManualData()
    setSelectedPageId(id)
  }

  const handleDeletePage = async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return

    const confirmed = window.confirm(`「${currentDraft.title || '無題'}」を削除しますか？`)
    if (!confirmed) return

    const deleteCategories = await supabase.from('manual_page_categories').delete().eq('page_id', currentDraft.id)
    if (deleteCategories.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ削除に失敗しました: ${deleteCategories.error.message}`)
      return
    }

    const deletePage = await supabase.from('manual_pages').delete().eq('id', currentDraft.id)
    if (deletePage.error) {
      setSaveState('error')
      setSaveMessage(`ページ削除に失敗しました: ${deletePage.error.message}`)
      return
    }

    setDraft(null)
    await loadManualData()
  }

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return

    const existing = categories.find((category) => category.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setNewCategoryName('')
      return
    }

    const insertResult = await supabase.from('manual_categories').insert({
      id: crypto.randomUUID(),
      name,
    })

    if (insertResult.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ作成に失敗しました: ${insertResult.error.message}`)
      return
    }

    setNewCategoryName('')
    await loadManualData()
  }

  const toggleCategoryForDraft = (categoryId: string) => {
    updateDraft((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }))
  }

  const toggleCategoryFilter = (categoryId: string) => {
    setActiveCategoryFilters((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    )
  }

  const setLink = () => {
    const previousUrl = editor?.getAttributes('link').href as string | undefined
    const url = window.prompt('リンクURLを入力してください', previousUrl || 'https://')
    if (!editor || url === null) return

    if (!url.trim()) {
      editor.chain().focus().unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  const handleImageUpload = async (file: File) => {
    const currentDraft = draftRef.current
    if (!editor || !currentDraft) return

    setSaveState('saving')
    setSaveMessage('画像をアップロード中...')

    const extension = file.name.split('.').pop() || 'png'
    const filePath = `${currentDraft.id}/${crypto.randomUUID()}.${extension}`

    const uploadResult = await supabase.storage.from(MANUAL_IMAGE_BUCKET).upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

    if (uploadResult.error) {
      setSaveState('error')
      setSaveMessage(`画像アップロードに失敗しました: ${uploadResult.error.message}`)
      return
    }

    const { data } = supabase.storage.from(MANUAL_IMAGE_BUCKET).getPublicUrl(filePath)
    editor.chain().focus().setImage({ src: data.publicUrl, width: 480 }).run()
  }

  const handleImagePickerChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await handleImageUpload(file)
    event.target.value = ''
  }

  const handleEditorPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile()

    if (!file) return

    event.preventDefault()
    await handleImageUpload(file)
  }

  const insertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  const resizeSelectedImage = (width: number) => {
    editor?.chain().focus().updateAttributes('image', { width }).run()
  }

  const tableActions = [
    { label: '行+上', onClick: () => editor?.chain().focus().addRowBefore().run() },
    { label: '行+下', onClick: () => editor?.chain().focus().addRowAfter().run() },
    { label: '列+左', onClick: () => editor?.chain().focus().addColumnBefore().run() },
    { label: '列+右', onClick: () => editor?.chain().focus().addColumnAfter().run() },
    { label: '行削除', onClick: () => editor?.chain().focus().deleteRow().run() },
    { label: '列削除', onClick: () => editor?.chain().focus().deleteColumn().run() },
    { label: '表削除', onClick: () => editor?.chain().focus().deleteTable().run() },
  ]

  const imageSizeActions = [
    { label: '画像 小', width: 240 },
    { label: '画像 中', width: 480 },
    { label: '画像 大', width: 720 },
  ]

  const activeHeadingLevel = editor?.isActive('heading', { level: 1 })
    ? 'h1'
    : editor?.isActive('heading', { level: 2 })
      ? 'h2'
      : editor?.isActive('heading', { level: 3 })
        ? 'h3'
        : 'paragraph'

  const showTableTools = !!editor?.isActive('table')
  const showImageTools = !!editor?.isActive('image')

  const handleHeadingChange = (value: string) => {
    if (!editor) return

    const chain = editor.chain().focus()
    if (value === 'paragraph') {
      chain.setParagraph().run()
      return
    }

    const levelMap = { h1: 1, h2: 2, h3: 3 } as const
    chain.toggleHeading({ level: levelMap[value as keyof typeof levelMap] }).run()
  }

  return (
    <section className="manuals-page">
      <div className="manuals-layout">
        <aside className="panel manuals-sidebar">
          <div className="panel-heading">
            <div>
              <h2>ページ一覧</h2>
              <p>{filteredPages.length}件表示 / 全{pages.length}件</p>
            </div>
            <button type="button" className="primary" onClick={handleCreatePage}>ページ追加</button>
          </div>

          <div className="manuals-search">
            <input
              type="search"
              placeholder="タイトル・本文・カテゴリを検索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="manuals-filter-block">
            <div className="manuals-filter-header">
              <strong>カテゴリフィルタ</strong>
              {activeCategoryFilters.length > 0 && (
                <button type="button" className="secondary" onClick={() => setActiveCategoryFilters([])}>
                  クリア
                </button>
              )}
            </div>

            <div className="manual-tag-list">
              {categories.length === 0 && <p className="empty-text">カテゴリがまだありません</p>}
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`manual-chip ${activeCategoryFilters.includes(category.id) ? 'active' : ''}`}
                  onClick={() => toggleCategoryFilter(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="manual-category-create">
              <input
                type="text"
                placeholder="新しいカテゴリ名"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleCreateCategory()
                  }
                }}
              />
              <button type="button" className="secondary" onClick={handleCreateCategory}>追加</button>
            </div>
          </div>

          <div className="manual-page-list">
            {loading && <p className="empty-text">読み込み中...</p>}
            {!loading && filteredPages.length === 0 && <p className="empty-text">該当するページがありません</p>}
            {filteredPages.map((page) => {
              const pageCategoryIds = pageCategories.filter((entry) => entry.page_id === page.id).map((entry) => entry.category_id)
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`manual-page-item ${page.id === selectedPageId ? 'active' : ''}`}
                  onClick={() => {
                    void flushPendingSave()
                    setSelectedPageId(page.id)
                  }}
                >
                  <strong>{page.title || '無題'}</strong>
                  <span>{stripHtml(page.content || '').slice(0, 56) || '本文はまだありません'}</span>
                  <div className="manual-page-tags">
                    {pageCategoryIds.slice(0, 3).map((categoryId) => (
                      <span key={categoryId} className="manual-chip small">
                        {categoryNameMap[categoryId]}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="panel manuals-editor-panel">
          {!draft ? (
            <div className="manual-empty-state">
              <h2>ルール・マニュアル</h2>
              <p>左の「ページ追加」から新しいマニュアルページを作成できます。</p>
            </div>
          ) : (
            <>
              <div className="panel-heading manuals-editor-header">
                <div>
                  <h2>ページ編集</h2>
                  <p className={`manual-save-status ${saveState}`}>{saveMessage}</p>
                </div>
                <button type="button" className="danger" onClick={handleDeletePage}>削除</button>
              </div>

              <div className="manual-title-field">
                <label className="form-label">タイトル
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="ページタイトルを入力"
                  />
                </label>
              </div>

              <div className="manual-category-section">
                <div className="form-label">カテゴリ設定</div>
                <div className="manual-tag-list">
                  {categories.map((category) => (
                    <label key={category.id} className={`manual-chip toggle ${draft.categoryIds.includes(category.id) ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={draft.categoryIds.includes(category.id)}
                        onChange={() => toggleCategoryForDraft(category.id)}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="manual-editor-toolbar">
                <div className="manual-toolbar-group">
                  <select
                    className="manual-toolbar-select"
                    value={activeHeadingLevel}
                    onChange={(event) => handleHeadingChange(event.target.value)}
                  >
                    <option value="paragraph">標準テキスト</option>
                    <option value="h1">見出し1</option>
                    <option value="h2">見出し2</option>
                    <option value="h3">見出し3</option>
                  </select>
                </div>

                <div className="manual-toolbar-divider" />

                <div className="manual-toolbar-group">
                  <button
                    type="button"
                    className={`manual-tool-button ${editor?.isActive('bold') ? 'active' : ''}`}
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                  >
                    B
                  </button>
                  <label className="manual-tool-button manual-tool-color" title="文字色">
                    A
                    <span className="manual-color-dot" />
                    <input type="color" onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()} />
                  </label>
                  <button
                    type="button"
                    className={`manual-tool-button ${editor?.isActive('bulletList') ? 'active' : ''}`}
                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                  >
                    箇条書き
                  </button>
                </div>

                <div className="manual-toolbar-divider" />

                <div className="manual-toolbar-group">
                  <button
                    type="button"
                    className={`manual-tool-button ${editor?.isActive('link') ? 'active' : ''}`}
                    onClick={setLink}
                  >
                    リンク
                  </button>
                </div>

                <div className="manual-toolbar-divider" />

                <div className="manual-toolbar-group manual-toolbar-insert">
                  <details className="manual-insert-menu">
                    <summary>挿入</summary>
                    <div className="manual-insert-popover">
                      <button type="button" className="manual-insert-item" onClick={insertTable}>表を追加</button>
                      <button type="button" className="manual-insert-item" onClick={() => fileInputRef.current?.click()}>画像を追加</button>
                    </div>
                  </details>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={handleImagePickerChange}
                />
              </div>

              {(showTableTools || showImageTools) && (
                <div className="manual-context-toolbar">
                  {showTableTools && (
                    <div className="manual-context-group">
                      <span className="manual-context-label">表</span>
                      {tableActions.map((action) => (
                        <button key={action.label} type="button" className="manual-context-button" onClick={action.onClick}>
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {showImageTools && (
                    <div className="manual-context-group">
                      <span className="manual-context-label">画像</span>
                      {imageSizeActions.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          className="manual-context-button"
                          onClick={() => resizeSelectedImage(action.width)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="manual-editor-surface" onPaste={handleEditorPaste}>
                <EditorContent editor={editor} className="manual-rich-editor" />
              </div>

              <p className="manual-editor-note">
                表は列境界ドラッグで幅変更できます。画像はボタン追加と貼り付けの両方に対応し、画像選択後にサイズボタンで幅変更できます。
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default ManualsPage
