import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChatStore } from '../../store/chatStore'
import { ChatPanel } from './ChatPanel'

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

export function ChatDock() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = useChatStore((state) => state.open)
  const togglePanel = useChatStore((state) => state.togglePanel)
  const closePanel = useChatStore((state) => state.closePanel)

  const path = normalizePath(location.pathname)
  const segments = path.split('/').filter(Boolean)
  const isLearnPage = segments[0] === 'learn'
  const isAssistantRoute = path.endsWith('/assistant')
  // /learn/:chapterId/:topicId：有具体知识点，可进入分屏。
  const isTopicPage = isLearnPage && !isAssistantRoute && segments.length >= 3

  // 离开分屏路由时，关闭可能残留的抽屉状态；/learn 页面不再显示抽屉。
  useEffect(() => {
    if (isLearnPage) closePanel()
  }, [closePanel, isLearnPage])

  // 分屏页面已有常驻 AI 面板，不再显示悬浮按钮，避免重复入口。
  if (isAssistantRoute) return null

  // 任何 /learn 页面都不渲染旧抽屉；知识点页面的悬浮按钮只负责进入分屏。
  if (isLearnPage) {
    return (
      <button
        type="button"
        className="chat-dock"
        aria-label={isTopicPage ? '打开 AI 助教' : '打开课程后使用 AI 助教'}
        onClick={() => {
          if (isTopicPage) navigate(`${path}/assistant`)
        }}
        title="AI 助教"
      >
        ✦
        <span className="dock-label">AI 助教</span>
      </button>
    )
  }

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
