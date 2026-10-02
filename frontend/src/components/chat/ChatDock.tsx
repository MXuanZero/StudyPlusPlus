import { useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { ChatPanel } from './ChatPanel'

export function ChatDock() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = useChatStore((state) => state.open)
  const togglePanel = useChatStore((state) => state.togglePanel)

  const assistantRoute = location.pathname.endsWith('/assistant')
  // /learn/:chapterId/:topicId（不含 /assistant）：知识点页面。
  const topicPage = /^\/learn\/[^/]+\/[^/]+$/.test(location.pathname)

  // 分屏页面已有常驻 AI 面板，不再显示悬浮按钮，避免重复入口。
  if (assistantRoute) return null

  const handleClick = () => {
    if (topicPage) {
      // 知识点页面不再弹出右侧抽屉，直接进入课程 + AI 分屏页面。
      navigate(`${location.pathname}/assistant`)
      return
    }
    togglePanel()
  }

  const label = topicPage ? 'AI 分屏' : 'AI 助教'
  return (
    <>
      <button
        type="button"
        className="chat-dock"
        aria-label={topicPage ? '进入 AI 分屏学习页面' : open ? '收起 AI 助教' : '打开 AI 助教'}
        aria-expanded={topicPage ? undefined : open}
        onClick={handleClick}
      >
        ✦
        <span className="dock-label">{label}</span>
      </button>
      {topicPage ? null : <ChatPanel />}
    </>
  )
}
