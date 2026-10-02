import { useEffect, useState } from 'react'
import { createNote, deleteNote, listNotes, updateNote, type Note } from '../../api/notes'
import { useAppStore } from '../../store/appStore'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface NotesDrawerProps {
  open: boolean
  topicId: string
  topicTitle: string
  onClose: () => void
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function NotesDrawer({ open, topicId, topicTitle, onClose }: NotesDrawerProps) {
  const pushToast = useAppStore((state) => state.pushToast)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    listNotes(topicId)
      .then((items) => {
        if (active) setNotes(items)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '笔记加载失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, topicId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  const handleCreate = async () => {
    const content = draft.trim()
    if (!content || creating) return
    setCreating(true)
    try {
      const note = await createNote(topicId, content)
      setNotes((previous) => [note, ...previous])
      setDraft('')
      pushToast('笔记已保存', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '笔记保存失败', 'error')
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (note: Note) => {
    setEditingId(note.id)
    setEditContent(note.content)
  }

  const handleUpdate = async () => {
    if (editingId === null) return
    const content = editContent.trim()
    if (!content || savingEdit) return
    setSavingEdit(true)
    try {
      const updated = await updateNote(editingId, content)
      setNotes((previous) => previous.map((note) => (note.id === updated.id ? updated : note)))
      setEditingId(null)
      setEditContent('')
      pushToast('笔记已更新', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '笔记更新失败', 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (note: Note) => {
    if (!window.confirm('确定删除这条笔记吗？')) return
    setRemovingId(note.id)
    try {
      await deleteNote(note.id)
      setNotes((previous) => previous.filter((item) => item.id !== note.id))
      if (editingId === note.id) {
        setEditingId(null)
        setEditContent('')
      }
      pushToast('笔记已删除', 'success')
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '笔记删除失败', 'error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <>
      {open ? <div className="notes-backdrop" onClick={onClose} aria-hidden /> : null}
      <aside className={`notes-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="学习笔记">
        <header className="notes-head">
          <div>
            <div className="notes-title">学习笔记</div>
            <div className="notes-topic">{topicTitle || topicId}</div>
          </div>
          <span className="spacer" />
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>

        <div className="notes-body">
          <div className="notes-editor card" style={{ padding: 12 }}>
            <label className="form-label" htmlFor="note-draft">
              新建笔记
            </label>
            <textarea
              id="note-draft"
              value={draft}
              placeholder="写下你的理解、类比或疑问……"
              maxLength={20000}
              onChange={(event) => setDraft(event.target.value)}
              style={{ marginTop: 6 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span className="faint small">{draft.length} / 20000</span>
              <span className="spacer" style={{ flex: 1 }} />
              <Button size="sm" variant="primary" onClick={() => void handleCreate()} disabled={!draft.trim() || creating}>
                {creating ? '保存中…' : '保存笔记'}
              </Button>
            </div>
          </div>

          {error ? <div className="diagnostic-item error">{error}</div> : null}
          {loading ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '24px 0' }}>
              <Spinner />
            </div>
          ) : null}

          {!loading && !notes.length && !error ? (
            <div className="notes-empty">
              <span className="empty-icon">📝</span>
              这个知识点还没有笔记。
              <br />
              把“我自己的理解”写下来，复习时会很有用。
            </div>
          ) : null}

          {notes.map((note) => (
            <div className="note-card" key={note.id}>
              {editingId === note.id ? (
                <div className="note-edit-area">
                  <textarea
                    value={editContent}
                    maxLength={20000}
                    onChange={(event) => setEditContent(event.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Button size="sm" variant="primary" onClick={() => void handleUpdate()} disabled={!editContent.trim() || savingEdit}>
                      {savingEdit ? '保存中…' : '保存'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingId(null)
                        setEditContent('')
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="note-content">{note.content}</div>
                  <div className="note-meta">
                    <span>更新于 {formatDateTime(note.updated_at)}</span>
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => startEdit(note)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => void handleDelete(note)}
                      disabled={removingId === note.id}
                    >
                      {removingId === note.id ? '删除中…' : '删除'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <footer className="notes-footer">
          <span className="faint small">
            共 {notes.length} 条笔记 · 保存在后端 SQLite，刷新或重启后仍会保留
          </span>
        </footer>
      </aside>
    </>
  )
}
