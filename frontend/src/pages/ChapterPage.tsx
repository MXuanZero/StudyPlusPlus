import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { fetchTopic } from '../api/curriculum'
import { ApiError } from '../api/client'
import type { TopicDetail } from '../api/types'
import { ChatPanel } from '../components/chat/ChatPanel'
import { CatalogReveal } from '../components/layout/CatalogReveal'
import { CatalogTree } from '../components/layout/CatalogTree'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { NotesDrawer } from '../components/notes/NotesDrawer'
import { ProgressControl } from '../components/progress/ProgressControl'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useChatStore } from '../store/chatStore'
import { useLearningStore } from '../store/learningStore'
import { useProgressStore } from '../store/progressStore'
import { listAnnotations, type Annotation } from '../utils/annotations'

function StateBlock({
  title,
  message,
  actions,
}: {
  title: string
  message: string
  actions?: JSX.Element
}) {
  return (
    <div className="state-block">
      <h2>{title}</h2>
      <p>{message}</p>
      {actions ? <div className="state-actions">{actions}</div> : null}
    </div>
  )
}

function topicPath(chapterId: string, topicId: string, assistantMode: boolean): string {
  return `/learn/${chapterId}/${topicId}${assistantMode ? '/assistant' : ''}`
}

const CATALOG_WIDTH_KEY = 'spp.catalog.width'
const CATALOG_DEFAULT_WIDTH = 284
const CATALOG_MIN_WIDTH = 220
const CATALOG_MAX_WIDTH = 440

function catalogMaxWidth(): number {
  if (typeof window === 'undefined') return CATALOG_MAX_WIDTH
  return Math.max(
    CATALOG_MIN_WIDTH,
    Math.min(CATALOG_MAX_WIDTH, Math.floor(window.innerWidth * 0.35)),
  )
}

function clampCatalogWidth(value: number): number {
  return Math.min(catalogMaxWidth(), Math.max(CATALOG_MIN_WIDTH, value))
}

function loadCatalogWidth(): number {
  if (typeof window === 'undefined') return CATALOG_DEFAULT_WIDTH
  try {
    const saved = Number(window.localStorage.getItem(CATALOG_WIDTH_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampCatalogWidth(saved) : CATALOG_DEFAULT_WIDTH
  } catch {
    return CATALOG_DEFAULT_WIDTH
  }
}

function persistCatalogWidth(width: number): void {
  try {
    window.localStorage.setItem(CATALOG_WIDTH_KEY, String(Math.round(width)))
  } catch {
    /* localStorage 不可用时仅本次页面生效 */
  }
}

interface ChapterPageProps {
  /** true：AI 分屏路由 /learn/:chapterId/:topicId/assistant */
  assistantMode?: boolean
}

export function ChapterPage({ assistantMode = false }: ChapterPageProps) {
  const { chapterId, topicId } = useParams()
  const navigate = useNavigate()
  const curriculum = useLearningStore((state) => state.curriculum)
  const loading = useLearningStore((state) => state.loading)
  const error = useLearningStore((state) => state.error)
  const loaded = useLearningStore((state) => state.loaded)
  const loadCurriculum = useLearningStore((state) => state.loadCurriculum)
  const findChapter = useLearningStore((state) => state.findChapter)
  const loadProgress = useProgressStore((state) => state.loadProgress)
  const loadChapterProgress = useProgressStore((state) => state.loadChapterProgress)
  const chapterProgress = useProgressStore((state) => (chapterId ? state.chapterProgress[chapterId] : undefined))

  const [collapsed, setCollapsed] = useState(false)
  const [catalogWidth, setCatalogWidth] = useState(loadCatalogWidth)
  const catalogWidthRef = useRef(catalogWidth)
  const [notesOpen, setNotesOpen] = useState(false)
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [topicLoading, setTopicLoading] = useState(false)
  const [topicError, setTopicError] = useState<{ code: string; message: string } | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  useEffect(() => {
    catalogWidthRef.current = catalogWidth
    document.documentElement.style.setProperty('--catalog-width', `${catalogWidth}px`)
  }, [catalogWidth])

  useEffect(() => {
    const handleWindowResize = () => {
      setCatalogWidth((current) => {
        const next = clampCatalogWidth(current)
        catalogWidthRef.current = next
        return next
      })
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    void loadCurriculum()
    void loadProgress()
  }, [loadCurriculum, loadProgress])

  useEffect(() => {
    if (!chapterId) return
    const info = findChapter(chapterId)
    if (info?.chapter.status === 'available' && info.chapter.topics.length > 0) {
      void loadChapterProgress(chapterId, true)
    }
  }, [chapterId, findChapter, loadChapterProgress])

  const chapterInfo = chapterId ? findChapter(chapterId) : null
  const firstTopicId = chapterInfo?.chapter.topics[0]?.id
  const targetTopicId = topicId ?? firstTopicId

  useEffect(() => {
    if (!targetTopicId) return
    let active = true
    setTopicLoading(true)
    setTopicError(null)
    setTopic(null)
    fetchTopic(targetTopicId)
      .then((result) => {
        if (active) setTopic(result)
      })
      .catch((err: unknown) => {
        if (!active) return
        if (err instanceof ApiError) setTopicError({ code: err.code, message: err.message })
        else setTopicError({ code: 'LOAD_ERROR', message: err instanceof Error ? err.message : '内容加载失败' })
      })
      .finally(() => {
        if (active) setTopicLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetTopicId])

  useEffect(() => {
    const topicId = topic?.id
    if (!topicId) {
      setAnnotations([])
      return
    }
    const reload = () => setAnnotations(listAnnotations(topicId))
    reload()
    window.addEventListener('spp:annotations-changed', reload)
    return () => window.removeEventListener('spp:annotations-changed', reload)
  }, [topic?.id])

  if (!loaded && loading) return <CenteredSpinner label="课程加载中…" />

  if (error && !curriculum) {
    return (
      <StateBlock
        title="课程加载失败"
        message={error}
        actions={
          <button type="button" className="btn" onClick={() => void loadCurriculum(true)}>
            重试
          </button>
        }
      />
    )
  }

  if (!chapterInfo) {
    return (
      <StateBlock
        title="未找到该章节"
        message={`章节 ${chapterId ?? ''} 不存在，可能链接已失效。`}
        actions={<Link className="btn btn-primary" to="/">返回首页</Link>}
      />
    )
  }

  const { book, chapter } = chapterInfo

  const handleAnnotationClick = (annotation: Annotation) => {
    if (!topic) return
    const target = topicPath(chapter.id, topic.id, true)
    if (annotation.session_id) {
      void useChatStore.getState().selectSession(annotation.session_id)
      navigate(`${target}?session=${encodeURIComponent(annotation.session_id)}`)
    } else {
      navigate(target)
    }
  }

  if (chapter.status !== 'available' || chapter.topics.length === 0) {
    return (
      <StateBlock
        title="该章节规划中"
        message={`《${book.title}》的“${chapter.title}”尚未开放正文。当前 MVP 只完整实现第 5 章。`}
        actions={<Link className="btn btn-primary" to="/">返回首页看看已开放章节</Link>}
      />
    )
  }

  if (!topicId && firstTopicId) {
    return <Navigate to={topicPath(chapter.id, firstTopicId, assistantMode)} replace />
  }

  const topicUnavailable = topicError?.code === 'TOPIC_NOT_AVAILABLE' || topicError?.code === 'TOPIC_NOT_FOUND'

  const handleCatalogResizerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = catalogWidth
    document.body.classList.add('is-col-resizing')

    const handleMove = (moveEvent: PointerEvent) => {
      const next = clampCatalogWidth(startWidth + (moveEvent.clientX - startX))
      setCatalogWidth(next)
      catalogWidthRef.current = next
    }
    const finish = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-col-resizing')
      persistCatalogWidth(catalogWidthRef.current)
      window.dispatchEvent(new Event('resize'))
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
  }

  const resetCatalogWidth = () => {
    const next = clampCatalogWidth(CATALOG_DEFAULT_WIDTH)
    setCatalogWidth(next)
    catalogWidthRef.current = next
    persistCatalogWidth(next)
    window.dispatchEvent(new Event('resize'))
  }

  return (
    <div className={`learn-layout${assistantMode ? ' with-assistant' : ''}${collapsed ? ' catalog-collapsed' : ''}`}>
      {collapsed ? <CatalogReveal onOpen={() => setCollapsed(false)} /> : null}
      {!collapsed ? (
        <aside className="catalog" style={{ width: catalogWidth, flexBasis: catalogWidth }}>
          <div className="catalog-head">
            <Link to="/" className="brand catalog-brand" title="返回首页">
              <span className="brand-mark">S+</span>
              <span className="brand-text">StudyPlusPlus</span>
            </Link>
            <button
              type="button"
              className="icon-btn"
              aria-label="折叠课程目录"
              title="折叠课程目录"
              onClick={() => setCollapsed(true)}
            >
              «
            </button>
          </div>
          <div className="catalog-section-title">课程目录</div>
          <CatalogTree collapsed={false} />
          <div
            className="catalog-resizer"
            onPointerDown={handleCatalogResizerPointerDown}
            onDoubleClick={resetCatalogWidth}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整课程目录宽度"
            title="拖动调整目录宽度，双击恢复默认"
          />
        </aside>
      ) : null}

      <div className="content-area">
        <article className="content-inner">
          <div className="breadcrumb">
            <Link to="/">首页</Link>
            <span>/</span>
            <span>{book.title}</span>
            <span>/</span>
            <Link to={`/learn/${chapter.id}`}>{chapter.title}</Link>
            {topic ? (
              <>
                <span>/</span>
                <span>{topic.title}</span>
              </>
            ) : null}
            {assistantMode ? (
              <>
                <span>/</span>
                <span>AI 分屏</span>
              </>
            ) : null}
          </div>

          {topicLoading && !topic ? <CenteredSpinner label="知识点加载中…" /> : null}

          {topicError ? (
            <StateBlock
              title={topicUnavailable ? '该知识点暂不可用' : '内容加载失败'}
              message={topicError.message}
              actions={<Link className="btn" to={`/learn/${chapter.id}`}>{`回到 ${chapter.title}`}</Link>}
            />
          ) : null}

          {topic ? (
            <>
              <div className="topic-toolbar">
                <span className="badge badge-accent">
                  第 {chapter.topics.findIndex((item) => item.id === topic.id) + 1} / {chapter.topics.length} 节
                </span>
                <ProgressControl
                  topicId={topic.id}
                  onChanged={() => void loadChapterProgress(chapter.id, true)}
                />
                {chapterProgress ? (
                  <span className="progress-row" title={`本章已完成 ${chapterProgress.completed}/${chapterProgress.total} 节`}>
                    <span className="small muted">
                      本章 {chapterProgress.completed}/{chapterProgress.total}
                    </span>
                    <span className="progress-bar">
                      <span style={{ width: `${chapterProgress.percent}%` }} />
                    </span>
                    <span className="small">{chapterProgress.percent}%</span>
                  </span>
                ) : null}
                <span className="spacer" />
                <Button size="sm" onClick={() => setNotesOpen(true)}>
                  笔记
                </Button>
              </div>
              <h1 className="topic-title">{topic.title}</h1>
              <p className="topic-summary">{topic.summary}</p>

              {topic.learning_objectives.length ? (
                <section className="objectives">
                  <h4>学习目标</h4>
                  <ul>
                    {topic.learning_objectives.map((objective) => (
                      <li key={objective}>{objective}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <MarkdownRenderer
                markdown={topic.body_markdown}
                widgets={topic.widgets}
                annotations={annotations}
                onAnnotationClick={handleAnnotationClick}
              />

              <nav className="topic-nav" aria-label="知识点导航">
                {topic.prev_topic ? (
                  <Link to={topicPath(chapter.id, topic.prev_topic.id, assistantMode)}>
                    <span className="dir">← 上一节</span>
                    <span className="name">{topic.prev_topic.title}</span>
                  </Link>
                ) : (
                  <span className="placeholder" />
                )}
                {topic.next_topic ? (
                  <Link
                    to={topicPath(chapter.id, topic.next_topic.id, assistantMode)}
                    style={{ textAlign: 'right' }}
                  >
                    <span className="dir">下一节 →</span>
                    <span className="name">{topic.next_topic.title}</span>
                  </Link>
                ) : (
                  <span className="placeholder" />
                )}
              </nav>
            </>
          ) : null}
        </article>
      </div>
      {assistantMode && topic ? (
        <ChatPanel
          variant="inline"
          onCollapse={() => navigate(topicPath(chapter.id, topic.id, false))}
        />
      ) : null}
      {topic ? (
        <NotesDrawer
          open={notesOpen}
          topicId={topic.id}
          topicTitle={topic.title}
          onClose={() => setNotesOpen(false)}
        />
      ) : null}
    </div>
  )
}
