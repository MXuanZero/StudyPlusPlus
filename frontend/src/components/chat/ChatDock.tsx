import { useChatStore } from '../../store/chatStore'
import { ChatPanel } from './ChatPanel'

export function ChatDock() {
  const open = useChatStore((state) => state.open)
  const togglePanel = useChatStore((state) => state.togglePanel)
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
