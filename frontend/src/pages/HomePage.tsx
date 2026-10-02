import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { BookSummary, ChapterSummary } from '../api/types'
import { CenteredSpinner } from '../components/ui/Spinner'
import { useAppStore } from '../store/appStore'
import { useLearningStore } from '../store/learningStore'
import { useProgressStore } from '../store/progressStore'
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
  const progressItems = useProgressStore((state) => state.items)
  const chapterProgressMap = useProgressStore((state) => state.chapterProgress)
  const loadProgress = useProgressStore((state) => state.loadProgress)
  const loadChapterProgress = useProgressStore((state) => state.loadChapterProgress)
  const dataSource = useAppStore((state) => state.dataSource)

  useEffect(() => {
    void loadCurriculum()
    void loadProgress()
  }, [loadCurriculum, loadProgress])

  const books = curriculum?.books ?? []
  const chapters = books.flatMap((book) => book.chapters)
  const firstAvailable = chapters.find(
    (chapter) => chapter.status === 'available' && chapter.topics.length > 0,
  )
  const availableTopics = chapters
    .filter((chapter) => chapter.status === 'available' && chapter.topics.length > 0)
    .flatMap((chapter) =>
      chapter.topics.map((topic) => ({
        chapterId: chapter.id,
        topicId: topic.id,
        title: topic.title,
      })),
    )
  const completedCount = availableTopics.filter(
    (topic) => progressItems[topic.topicId]?.status === 'completed',
  ).length
  const totalTopics = availableTopics.length
  const overallPercent = totalTopics ? Math.round((completedCount / totalTopics) * 100) : 0
  const hasAnyProgress = Object.values(progressItems).some(
    (item) => item.status !== 'not_started',
  )
  const nextTopic =
    availableTopics.find((topic) => progressItems[topic.topicId]?.status !== 'completed') ??
    availableTopics[0]
  const currentChapterProgress = firstAvailable ? chapterProgressMap[firstAvailable.id] : undefined

  useEffect(() => {
    if (firstAvailable) void loadChapterProgress(firstAvailable.id)
  }, [firstAvailable?.id, loadChapterProgress])

  const primaryTo = nextTopic ? `/learn/${nextTopic.chapterId}/${nextTopic.topicId}` : '/learn/ch05'
  const primaryLabel = hasAnyProgress ? '继续学习' : '开始学习第 5 章'

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
          <Link className="btn btn-primary" to={primaryTo}>
            {primaryLabel}
          </Link>
          <Link className="btn" to="/settings">
            模型设置
          </Link>
        </div>
        {dataSource === 'mock' ? (
          <div className="status-banner mock" style={{ maxWidth: 560, marginTop: 20 }}>
            <div>
              <div className="status-title">开发 Mock 数据</div>
              后端接口暂不可用，课程与计算使用了本地固定数据；配置后端后会自动切换为真实接口。
            </div>
          </div>
        ) : null}
      </section>

      <section className="home-progress">
        <h2>学习进度</h2>
        <p>进度保存在后端 SQLite，刷新页面或重启服务后依然保留。</p>
        <div className="home-progress-grid">
          <div className="card stat-card">
            <div className="stat-label">总体进度</div>
            <div className="stat-value">{overallPercent}%</div>
            <div className="stat-sub">
              已完成 {completedCount} / {totalTopics} 个知识点
            </div>
            <div className="progress-bar" style={{ maxWidth: '100%', marginTop: 10 }}>
              <span style={{ width: `${overallPercent}%` }} />
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">当前章节</div>
            <div className="stat-value" style={{ fontSize: 16, lineHeight: 1.45 }}>
              {firstAvailable ? chapterHeading(firstAvailable.id, firstAvailable.title) : '—'}
            </div>
            <div className="stat-sub">
              {currentChapterProgress
                ? `已完成 ${currentChapterProgress.completed} / ${currentChapterProgress.total} 节 · ${currentChapterProgress.percent}%`
                : '章节进度加载中…'}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">下一步</div>
            <div className="stat-value" style={{ fontSize: 16, lineHeight: 1.45 }}>
              {nextTopic ? nextTopic.title : '已学完当前所有内容'}
            </div>
            {nextTopic ? (
              <Link
                className="btn btn-primary btn-sm"
                style={{ marginTop: 10 }}
                to={`/learn/${nextTopic.chapterId}/${nextTopic.topicId}`}
              >
                继续学习
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="home-settings">
        <div className="card home-settings-card">
          <div>
            <h3>模型设置</h3>
            <p>配置 DeepSeek / OpenAI / Ollama 或其他 OpenAI 兼容服务，查看当前 live / mock 状态。</p>
          </div>
          <Link className="btn btn-primary" to="/settings">
            打开模型设置
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
