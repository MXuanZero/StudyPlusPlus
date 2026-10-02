import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { BookSummary, ChapterSummary } from '../api/types'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useLearningStore } from '../store/learningStore'
import { chapterHeading } from '../utils/chapter'

function BookCard({ book }: { book: BookSummary }) {
  return (
    <div className="card book-card">
      <h3>{book.title}</h3>
      <div className="book-sub">共 {book.chapters.length} 章</div>
      <ul className="chapter-list">
        {book.chapters.map((chapter) => (
          <ChapterRow key={chapter.id} chapter={chapter} />
        ))}
      </ul>
    </div>
  )
}

function ChapterRow({ chapter }: { chapter: ChapterSummary }) {
  const label = chapterHeading(chapter.id, chapter.title)
  if (chapter.status === 'available' && chapter.topics.length > 0) {
    return (
      <li>
        <Link className="chapter-row available" to={`/learn/${chapter.id}`}>
          <span className="chapter-name">{label}</span>
          <span className="badge badge-accent">可学习</span>
        </Link>
      </li>
    )
  }
  return (
    <li>
      <span className="chapter-row planned">
        <span className="chapter-name">{label}</span>
        <span className="badge">规划中</span>
      </span>
    </li>
  )
}

export function HomePage() {
  const curriculum = useLearningStore((state) => state.curriculum)
  const loading = useLearningStore((state) => state.loading)
  const error = useLearningStore((state) => state.error)
  const loadCurriculum = useLearningStore((state) => state.loadCurriculum)

  useEffect(() => {
    void loadCurriculum()
  }, [loadCurriculum])

  const books = curriculum?.books ?? []
  const firstAvailable = books
    .flatMap((book) => book.chapters)
    .find((chapter) => chapter.status === 'available' && chapter.topics.length > 0)

  return (
    <div className="home">
      <section className="home-hero">
        <div className="eyebrow">控制理论 · 交互式学习</div>
        <h1>把抽象的控制理论，变成看得见、拖得动的图像</h1>
        <p>
          StudyPlusPlus 用交互式可视化、Python 后端计算和全局 AI 助手，
          帮助数学与物理基础薄弱的你，从《控制之美》的目录出发逐步建立直觉。
        </p>
        <div className="home-actions">
          <Link className="btn btn-primary" to={firstAvailable ? `/learn/${firstAvailable.id}` : '/learn/ch05'}>
            开始学习第 5 章
          </Link>
          <Link className="btn" to="/settings">
            模型设置
          </Link>
        </div>
      </section>

      <section className="book-section">
        <h2>课程总览</h2>
        <p>目录与参考书一致；标有“规划中”的章节暂不开放正文。</p>
        {loading && !books.length ? <CenteredSpinner label="课程目录加载中…" /> : null}
        {error && !books.length ? (
          <div className="placeholder-note">
            {error}
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => void loadCurriculum(true)}>
                重新加载
              </button>
            </div>
          </div>
        ) : null}
        <div className="book-grid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      </section>
    </div>
  )
}
