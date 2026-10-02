import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ChapterSummary } from '../../api/types'
import { useLearningStore } from '../../store/learningStore'
import { chapterHeading } from '../../utils/chapter'

interface CatalogTreeProps {
  collapsed: boolean
}

export function CatalogTree({ collapsed }: CatalogTreeProps) {
  const { chapterId: activeChapterId, topicId: activeTopicId } = useParams()
  const curriculum = useLearningStore((state) => state.curriculum)
  const loading = useLearningStore((state) => state.loading)
  const error = useLearningStore((state) => state.error)
  const loadCurriculum = useLearningStore((state) => state.loadCurriculum)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['ch05']))

  useEffect(() => {
    void loadCurriculum()
  }, [loadCurriculum])

  useEffect(() => {
    if (activeChapterId) {
      setExpanded((previous) => {
        if (previous.has(activeChapterId)) return previous
        const next = new Set(previous)
        next.add(activeChapterId)
        return next
      })
    }
  }, [activeChapterId])

  const books = useMemo(() => curriculum?.books ?? [], [curriculum])

  const toggleChapter = (chapter: ChapterSummary) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(chapter.id)) next.delete(chapter.id)
      else next.add(chapter.id)
      return next
    })
  }

  if (collapsed) {
    return (
      <nav className="catalog-body" aria-label="课程目录（已折叠）">
        <div className="catalog-empty" style={{ writingMode: 'vertical-rl', padding: '14px 8px' }}>
          目录已折叠
        </div>
      </nav>
    )
  }

  return (
    <nav className="catalog-body" aria-label="课程目录">
      {loading && !books.length ? <div className="catalog-empty">目录加载中…</div> : null}
      {error && !books.length ? (
        <div className="catalog-empty">
          {error}
          <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => void loadCurriculum(true)}>
            重试
          </button>
        </div>
      ) : null}
      {books.map((book) => (
        <div className="catalog-book" key={book.id}>
          <div className="catalog-book-title">{book.title}</div>
          {book.chapters.map((chapter) => {
            const isAvailable = chapter.status === 'available' && chapter.topics.length > 0
            const isOpen = expanded.has(chapter.id)
            return (
              <div className={`catalog-chapter ${isAvailable ? '' : 'planned'}`} key={chapter.id}>
                <button
                  type="button"
                  className="catalog-chapter-toggle"
                  onClick={() => isAvailable && toggleChapter(chapter)}
                  aria-expanded={isAvailable ? isOpen : undefined}
                  disabled={!isAvailable}
                >
                  <span className="caret">{isAvailable ? (isOpen ? '▾' : '▸') : '·'}</span>
                  <span className="chapter-title">{chapterHeading(chapter.id, chapter.title)}</span>
                  {!isAvailable ? <span className="badge">规划中</span> : null}
                </button>
                {isAvailable && isOpen ? (
                  <ul className="catalog-topics">
                    {chapter.topics.map((topic) => {
                      const isActive = topic.id === activeTopicId
                      return (
                        <li key={topic.id}>
                          <Link
                            to={`/learn/${chapter.id}/${topic.id}`}
                            className={`catalog-topic ${isActive ? 'active' : ''}`}
                          >
                            <span className="dot" />
                            <span>{topic.title}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
