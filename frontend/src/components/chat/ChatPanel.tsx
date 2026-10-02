import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { usePageContext } from '../../hooks/usePageContext'
import { Button } from '../ui/Button'

const SUGGESTIONS = [
  '为什么欠阻尼系统会振荡？',
  '极点位置和稳定性是什么关系？',
  '超调量和阻尼比有什么关系？',
]

function contextLabel(context: ReturnType<typeof usePageContext>): string {
  if (context.topic) return `当前：${context.topic}`
  if (context.chapter) return `当前：${context.chapter}`
  return '当前：课程首页'
}

export function ChatPanel() {
  const open = useChatStore((state) => state.open)
  const closePanel = useChatStore((state) => state.closePanel)
  const sessions = useChatStore((state) => state.sessions)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const messages = useChatStore((state) => state.messages)
  const loadingSessions = useChatStore((state) => state.loadingSessions)
  const loadingMessages = useChatStore((state) => state.loadingMessages)
  const streaming = useChatStore((state) => state.streaming)
  const error = useChatStore((state) => state.error)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const selectSession = useChatStore((state) => state.selectSession)
  const startNewSession = useChatStore((state) => state.startNewSession)
  const removeSession = useChatStore((state) => state.removeSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const clearError = useChatStore((state) => state.clearError)

  const pageContext = usePageContext()
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) void loadSessions()
  }, [loadSessions, open])

  useEffect(() => {
    const host = messagesRef.current
    if (host) host.scrollTop = host.scrollHeight
  }, [messages, streaming])

  const contextChip = useMemo(() => contextLabel(pageContext), [pageContext])

  const submit = (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    setInput('')
    void sendMessage(content, pageContext)
  }

  return (
    <aside className={`chat-panel ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="AI 助教面板">
      <header className="chat-head">
        <span className="chat-title">AI 助教</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            startNewSession()
            setShowHistory(false)
          }}
        >
          新会话
        </button>
        <button
          type="button"
          className="icon-btn"
          title="历史会话"
          aria-label="历史会话"
          onClick={() => setShowHistory((value) => !value)}
        >
          ☰
        </button>
        <button type="button" className="icon-btn" title="关闭" aria-label="关闭对话面板" onClick={closePanel}>
          ×
        </button>
      </header>

      {showHistory ? (
        <div className="chat-history">
          {loadingSessions && !sessions.length ? <div className="chat-history-empty">会话加载中…</div> : null}
          {!loadingSessions && !sessions.length ? (
            <div className="chat-history-empty">还没有历史会话，发送第一条消息即可创建。</div>
          ) : null}
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`chat-history-item ${session.id === currentSessionId ? 'active' : ''}`}
            >
              <button
                type="button"
                className="chat-history-title"
                style={{ border: 'none', background: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}
                onClick={() => {
                  void selectSession(session.id)
                  setShowHistory(false)
                }}
              >
                {session.title || '未命名会话'}
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`删除会话 ${session.title}`}
                title="删除会话"
                onClick={() => {
                  if (window.confirm('确定删除这个会话吗？')) void removeSession(session.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="chat-messages" ref={messagesRef}>
        {loadingMessages ? <div className="chat-history-empty">历史消息加载中…</div> : null}
        {!loadingMessages && !messages.length ? (
          <div className="chat-history-empty" style={{ textAlign: 'left', padding: '8px 4px' }}>
            <p style={{ marginTop: 0 }}>你好，我是学习平台内置助教。你可以问我：</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-start' }}>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => submit(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1
          const isStreamingBubble = streaming && isLast && message.role === 'assistant'
          return (
            <div className={`chat-message ${message.role}`} key={message.id ?? `${message.role}-${index}`}>
              <span className="role">{message.role === 'user' ? '我' : 'AI 助教'}</span>
              <div className="chat-bubble">
                {message.content || (isStreamingBubble ? '' : '…')}
                {isStreamingBubble ? <span className="chat-cursor" /> : null}
              </div>
            </div>
          )
        })}
      </div>

      {error ? (
        <div className="chat-error" role="alert" onClick={clearError}>
          {error}
        </div>
      ) : null}

      <div className="chat-input-area">
        <span className="chat-context" title={contextChip}>
          {contextChip}
        </span>
        <div className="chat-input-row">
          <textarea
            value={input}
            placeholder="输入你的问题，Enter 发送，Shift+Enter 换行"
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            aria-label="聊天输入框"
          />
          {streaming ? (
            <Button variant="danger" onClick={stopStreaming}>
              停止生成
            </Button>
          ) : (
            <Button variant="primary" onClick={() => submit()} disabled={!input.trim()}>
              发送
            </Button>
          )}
        </div>
        <div className="chat-hint">
          <span>回答由 AI 生成，请结合课程内容判断</span>
          <span>{messages.length ? `${messages.length} 条消息` : ''}</span>
        </div>
      </div>
    </aside>
  )
}
