import { useLocation } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { ChatPanel } from './ChatPanel'

export function ChatDock() {
  const location = useLocation()
  const open = useChatStore((state) => state.open)
  const togglePanel = useChatStore((state) => state.togglePanel)

  // 分屏页面已有常驻 AI 面板，不再显示悬浮按钮，避免重复入口。
  if (location.pathname.endsWith('/assistant')) return null

  return (
    <>
      <button
        type="button"
        className="chat-dock"
        aria-label={open ? '收起 AI 助教' : '打开 AI 助教'}
        aria-expanded={open}
        onClick={togglePanel}
      >
        ✦
        <span className="dock-label">AI 助教</span>
      </button>
      <ChatPanel />
    </>
  )
}
