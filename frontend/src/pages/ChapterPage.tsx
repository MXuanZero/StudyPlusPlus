import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { fetchTopic } from '../api/curriculum'
import { ApiError } from '../api/client'
import type { TopicDetail } from '../api/types'
import { CatalogTree } from '../components/layout/CatalogTree'
import { MarkdownRenderer } from '../components/markdown/MarkdownRenderer'
import { NotesDrawer } from '../components/notes/NotesDrawer'
import { ProgressControl } from '../components/progress/ProgressControl'
import { Button } from '../components/ui/Button'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useLearningStore } from '../store/learningStore'
import { useProgressStore } from '../store/progressStore'

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

export function ChapterPage() {
  const { chapterId, topicId } = useParams()
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
  const [notesOpen, setNotesOpen] = useState(false)
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [topicLoading, setTopicLoading] = useState(false)
  const [topicError, setTopicError] = useState<{ code: string; message: string } | null>(null)

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
    return <Navigate to={`/learn/${chapter.id}/${firstTopicId}`} replace />
  }

  const topicUnavailable = topicError?.code === 'TOPIC_NOT_AVAILABLE' || topicError?.code === 'TOPIC_NOT_FOUND'

  return (
    <div className="learn-layout">
      <aside className={`catalog ${collapsed ? 'collapsed' : ''}`}>
        <div className="catalog-head">
          {!collapsed ? <span className="title">课程目录</span> : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={collapsed ? '展开课程目录' : '折叠课程目录'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <CatalogTree collapsed={collapsed} />
      </aside>

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

              <MarkdownRenderer markdown={topic.body_markdown} widgets={topic.widgets} />

              <nav className="topic-nav" aria-label="知识点导航">
                {topic.prev_topic ? (
                  <Link to={`/learn/${chapter.id}/${topic.prev_topic.id}`}>
                    <span className="dir">← 上一节</span>
                    <span className="name">{topic.prev_topic.title}</span>
                  </Link>
                ) : (
                  <span className="placeholder" />
                )}
                {topic.next_topic ? (
                  <Link to={`/learn/${chapter.id}/${topic.next_topic.id}`} style={{ textAlign: 'right' }}>
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
