import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLocation } from 'react-router-dom'
import type { ChatMessage, ChatQuote } from '../../api/types'
import { useChatStore } from '../../store/chatStore'
import { usePageContext } from '../../hooks/usePageContext'
import { Button } from '../ui/Button'
import { ChatMarkdown } from './ChatMarkdown'

const SUGGESTIONS = [
  '为什么欠阻尼系统会振荡？',
  '极点位置和稳定性是什么关系？',
  '超调量和阻尼比有什么关系？',
]

const CHAT_WIDTH_KEY = 'spp.chat.panelWidth'
const CHAT_DEFAULT_WIDTH = 440
const CHAT_MIN_WIDTH = 360
const CHAT_MAX_WIDTH = 860

function chatMaxWidth(): number {
  if (typeof window === 'undefined') return CHAT_MAX_WIDTH
  return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, Math.floor(window.innerWidth * 0.85)))
}

function clampChatWidth(value: number): number {
  return Math.min(chatMaxWidth(), Math.max(CHAT_MIN_WIDTH, value))
}

function loadChatWidth(): number {
  if (typeof window === 'undefined') return CHAT_DEFAULT_WIDTH
  try {
    const saved = Number(window.localStorage.getItem(CHAT_WIDTH_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampChatWidth(saved) : CHAT_DEFAULT_WIDTH
  } catch {
    return CHAT_DEFAULT_WIDTH
  }
}

function persistChatWidth(width: number): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(width)))
  } catch {
    /* localStorage 不可用时仅本次页面生效 */
  }
}

function quotesOf(message: ChatMessage): ChatQuote[] {
  const quotes = message.meta?.quotes
  return Array.isArray(quotes) ? quotes : []
}

function contextLabel(context: ReturnType<typeof usePageContext>): string {
  if (context.topic) return `当前：${context.topic}`
  if (context.chapter) return `当前：${context.chapter}`
  return '当前：课程首页'
}

export type ChatPanelVariant = 'drawer' | 'inline'

interface ChatPanelProps {
  /** drawer：右侧浮层（默认）；inline：常驻分屏，占据 learn-layout 的 flex 子项。 */
  variant?: ChatPanelVariant
  onCollapse?: () => void
}

export function ChatPanel({ variant = 'drawer', onCollapse }: ChatPanelProps) {
  const inline = variant === 'inline'
  const location = useLocation()
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
  const pendingQuotes = useChatStore((state) => state.pendingQuotes)
  const removeQuote = useChatStore((state) => state.removeQuote)
  const clearQuotes = useChatStore((state) => state.clearQuotes)

  const pageContext = usePageContext()
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(loadChatWidth)
  const widthRef = useRef(panelWidth)

  useEffect(() => {
    widthRef.current = panelWidth
  }, [panelWidth])

  useEffect(() => {
    const handleWindowResize = () => {
      setPanelWidth((current) => {
        const next = clampChatWidth(current)
        widthRef.current = next
        return next
      })
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    return () => document.body.classList.remove('is-col-resizing')
  }, [])

  useEffect(() => {
    if (open || inline) void loadSessions()
  }, [inline, loadSessions, open])

  useEffect(() => {
    const host = messagesRef.current
    if (host) host.scrollTop = host.scrollHeight
  }, [messages, streaming])

  const contextChip = useMemo(() => contextLabel(pageContext), [pageContext])

  const handleResizerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? panelWidth
    document.body.classList.add('is-col-resizing')
    const handleMove = (moveEvent: PointerEvent) => {
      const next = clampChatWidth(startWidth + (startX - moveEvent.clientX))
      setPanelWidth(next)
      widthRef.current = next
    }
    const finish = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-col-resizing')
      persistChatWidth(widthRef.current)
      // Plotly 等响应式图表在面板宽度变化后重新计算尺寸。
      window.dispatchEvent(new Event('resize'))
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
  }

  const resetPanelWidth = () => {
    const next = clampChatWidth(CHAT_DEFAULT_WIDTH)
    setPanelWidth(next)
    widthRef.current = next
    persistChatWidth(next)
    window.dispatchEvent(new Event('resize'))
  }

  const submit = (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    setInput('')
    void sendMessage(content, pageContext)
  }

  // 双保险：/learn 页面禁止 drawer 抽屉；知识点页面的 AI 入口统一走 /assistant 分屏。
  const normalizedPath = location.pathname.replace(/\/+$/, '')
  if (!inline && normalizedPath.startsWith('/learn/')) return null

  return (
    <aside
      className={`chat-panel ${inline ? 'inline' : open ? 'open' : ''}`}
      style={{ width: panelWidth }}
      aria-hidden={inline ? false : !open}
      aria-label="AI 助教面板"
    >
      <div
        className="chat-resizer"
        onPointerDown={handleResizerPointerDown}
        onDoubleClick={resetPanelWidth}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整 AI 面板宽度"
        title="拖动调整宽度，双击恢复默认"
      />
      <header className="chat-head">
        {inline ? (
          <button
            type="button"
            className="icon-btn chat-collapse-btn"
            title="收起 AI 助教"
            aria-label="收起 AI 助教"
            onClick={onCollapse}
          >
            »
          </button>
        ) : null}
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
        {inline ? null : (
          <button type="button" className="icon-btn" title="关闭" aria-label="关闭对话面板" onClick={closePanel}>
            ×
          </button>
        )}
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
          const quotes = message.role === 'user' ? quotesOf(message) : []
          return (
            <div className={`chat-message ${message.role}`} key={message.id ?? `${message.role}-${index}`}>
              <span className="role">{message.role === 'user' ? '我' : 'AI 助教'}</span>
              <div className={`chat-bubble${message.role === 'assistant' ? ' has-markdown' : ''}`}>
                {quotes.length ? (
                  <div className="message-quotes">
                    {quotes.map((quote, quoteIndex) => (
                      <blockquote
                        className="message-quote"
                        key={quote.id ?? `${message.id ?? 'msg'}-quote-${quoteIndex}`}
                      >
                        <span className="quote-tag">引用</span>
                        <div className="quote-text" title={quote.text}>
                          {quote.text}
                        </div>
                        {quote.source ? <div className="quote-source">— {quote.source}</div> : null}
                      </blockquote>
                    ))}
                  </div>
                ) : null}
                {message.role === 'assistant' ? (
                  message.content ? (
                    <ChatMarkdown content={message.content} />
                  ) : isStreamingBubble ? null : (
                    '…'
                  )
                ) : (
                  message.content
                )}
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
        {pendingQuotes.length ? (
          <div className="pending-quotes">
            <div className="pending-quotes-head">
              <span>待发送引用 {pendingQuotes.length}/5</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={clearQuotes}>
                全部清空
              </button>
            </div>
            <div className="pending-quotes-list">
              {pendingQuotes.map((quote, index) => (
                <div className="pending-quote" key={quote.id ?? `pending-${index}`}>
                  <div className="pending-quote-main">
                    <span className="quote-tag">引用</span>
                    <div className="pending-quote-text" title={quote.text}>
                      {quote.text}
                    </div>
                    {quote.source ? <div className="pending-quote-source">{quote.source}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="删除这条引用"
                    title="删除这条引用"
                    onClick={() => removeQuote(quote.id ?? '')}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <span className="chat-context" title={contextChip}>
          {contextChip}
        </span>
        <div className="chat-input-row">
          <textarea
            value={input}
            placeholder={
              pendingQuotes.length
                ? '引用已就绪，输入你的问题后发送'
                : '输入你的问题，Enter 发送，Shift+Enter 换行'
            }
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
