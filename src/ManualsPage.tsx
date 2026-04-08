import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
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
  const editorRef = useRef<HTMLDivElement | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)
  const lastSavedSignatureRef = useRef('')
  const lastSelectionRef = useRef<Range | null>(null)

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
    loadManualData()

    const pagesChannel = supabase
      .channel('manual-pages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_pages' }, loadManualData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_categories' }, loadManualData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'manual_page_categories' }, loadManualData)
      .subscribe()

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
      supabase.removeChannel(pagesChannel)
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
      if (editorRef.current) editorRef.current.innerHTML = EMPTY_CONTENT
      lastSavedSignatureRef.current = ''
      return
    }

    const nextDraft = {
      id: selectedPage.id,
      title: selectedPage.title ?? '',
      content: selectedPage.content || EMPTY_CONTENT,
      categoryIds: selectedPageCategoryIds,
    }
    setDraft(nextDraft)
    lastSavedSignatureRef.current = JSON.stringify(nextDraft)
    setSaveState('idle')
    setSaveMessage('未保存の変更はありません')

    if (editorRef.current) {
      editorRef.current.innerHTML = nextDraft.content || EMPTY_CONTENT
    }
  }, [selectedPage, selectedPageCategoryIds])

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

  const flushPendingSave = async () => {
    if (!draft) return
    const signature = JSON.stringify(draft)
    if (signature === lastSavedSignatureRef.current) return
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }
    await savePage(draft)
  }

  const syncEditorToDraft = () => {
    const html = editorRef.current?.innerHTML || EMPTY_CONTENT
    updateDraft((current) => ({ ...current, content: html }))
  }

  const rememberSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    lastSelectionRef.current = selection.getRangeAt(0)
  }

  const restoreSelection = () => {
    if (!lastSelectionRef.current) return
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(lastSelectionRef.current)
  }

  const applyCommand = (command: string, value?: string) => {
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand(command, false, value)
    syncEditorToDraft()
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

    const pageResult = await supabase
      .from('manual_pages')
      .update(pagePayload)
      .eq('id', pageToSave.id)

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
    }, 900)

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
    if (!draft) return
    const confirmed = window.confirm(`「${draft.title || '無題'}」を削除しますか？`)
    if (!confirmed) return

    const deleteCategories = await supabase.from('manual_page_categories').delete().eq('page_id', draft.id)
    if (deleteCategories.error) {
      setSaveState('error')
      setSaveMessage(`カテゴリ削除に失敗しました: ${deleteCategories.error.message}`)
      return
    }

    const deletePage = await supabase.from('manual_pages').delete().eq('id', draft.id)
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

  const insertLink = () => {
    const url = window.prompt('リンクURLを入力してください')
    if (!url) return
    applyCommand('createLink', url)
  }

  const insertTable = () => {
    applyCommand(
      'insertHTML',
      '<table><tbody><tr><th>項目</th><th>内容</th></tr><tr><td>サンプル</td><td>ここに入力</td></tr></tbody></table><p></p>',
    )
  }

  const uploadImage = async (file: File) => {
    const extension = file.name.split('.').pop() || 'png'
    const filePath = `${draft?.id || 'manual'}/${crypto.randomUUID()}.${extension}`
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
    applyCommand('insertImage', data.publicUrl)
  }

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
      ?.getAsFile()

    if (!file) return

    event.preventDefault()
    await uploadImage(file)
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

              <div className="manual-editor-toolbar" onMouseUp={rememberSelection}>
                <button type="button" className="secondary" onClick={() => applyCommand('formatBlock', '<h1>')}>H1</button>
                <button type="button" className="secondary" onClick={() => applyCommand('formatBlock', '<h2>')}>H2</button>
                <button type="button" className="secondary" onClick={() => applyCommand('formatBlock', '<h3>')}>H3</button>
                <button type="button" className="secondary" onClick={() => applyCommand('bold')}>太字</button>
                <label className="manual-color-picker">
                  文字色
                  <input type="color" onChange={(event) => applyCommand('foreColor', event.target.value)} />
                </label>
                <button type="button" className="secondary" onClick={() => applyCommand('insertUnorderedList')}>箇条書き</button>
                <button type="button" className="secondary" onClick={insertLink}>リンク</button>
                <button type="button" className="secondary" onClick={insertTable}>表</button>
              </div>

              <div
                ref={editorRef}
                className="manual-rich-editor"
                contentEditable
                suppressContentEditableWarning
                onInput={syncEditorToDraft}
                onPaste={handlePaste}
                onKeyUp={rememberSelection}
                onMouseUp={rememberSelection}
              />
              <p className="manual-editor-note">画像は貼り付けでSupabase Storageに保存されます。バケット名は `manual-images` を想定しています。</p>
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
