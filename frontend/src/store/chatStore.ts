import { create } from 'zustand'
import {
  createChatSession,
  deleteChatSession,
  getChatMessages,
  listChatSessions,
  streamChat,
} from '../api/chat'
import type { ChatContext, ChatMessage, ChatQuote, ChatSession } from '../api/types'
import { useAppStore } from './appStore'
import { makeId } from '../utils/format'
import { attachSessionToAnnotations, removeAnnotation, removeAnnotationsBySession } from '../utils/annotations'

const PENDING_QUOTES_KEY = 'spp.chat.pendingQuotes'
const MAX_PENDING_QUOTES = 5

export type QuoteAddResult = 'added' | 'duplicate' | 'limit'

function sanitizeQuote(value: unknown): ChatQuote | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.text !== 'string' || !record.text.trim()) return null
  const text = record.text.trim()
  if (text.length > 5000) return null
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    text,
    source: typeof record.source === 'string' ? record.source : undefined,
    topic_id: typeof record.topic_id === 'string' ? record.topic_id : undefined,
    topic_title: typeof record.topic_title === 'string' ? record.topic_title : undefined,
    annotation_id: typeof record.annotation_id === 'string' ? record.annotation_id : undefined,
  }
}

/** 只从 localStorage 读取引用字段，绝不涉及任何 Key。 */
function loadPendingQuotes(): ChatQuote[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PENDING_QUOTES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeQuote)
      .filter((quote): quote is ChatQuote => quote !== null)
      .slice(0, MAX_PENDING_QUOTES)
      .map((quote, index) => (quote.id ? quote : { ...quote, id: `quote_restored_${Date.now()}_${index}` }))
  } catch {
    return []
  }
}

function persistPendingQuotes(quotes: ChatQuote[]): void {
  if (typeof window === 'undefined') return
  try {
    const slim = quotes.map(({ id, text, source, topic_id, topic_title, annotation_id }) => ({
      id,
      text,
      source,
      topic_id,
      topic_title,
      annotation_id,
    }))
    window.localStorage.setItem(PENDING_QUOTES_KEY, JSON.stringify(slim))
  } catch {
    /* localStorage 不可用时仅本次页面生效 */
  }
}

function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface ChatState {
  open: boolean
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  loadingSessions: boolean
  loadingMessages: boolean
  streaming: boolean
  streamingText: string
  error: string | null
  abortController: AbortController | null
  pendingQuotes: ChatQuote[]
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  loadSessions: () => Promise<void>
  selectSession: (sessionId: string | null) => Promise<void>
  startNewSession: (context?: ChatContext) => void
  removeSession: (sessionId: string) => Promise<void>
  ensureSession: (context?: ChatContext) => Promise<string>
  sendMessage: (content: string, context?: ChatContext) => Promise<void>
  stopStreaming: () => void
  clearError: () => void
  addQuote: (quote: ChatQuote) => QuoteAddResult
  removeQuote: (id: string) => void
  clearQuotes: (options?: { keepAnnotations?: boolean }) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  open: false,
  sessions: [],
  currentSessionId: null,
  messages: [],
  loadingSessions: false,
  loadingMessages: false,
  streaming: false,
  streamingText: '',
  error: null,
  abortController: null,
  pendingQuotes: loadPendingQuotes(),

  openPanel: () => {
    set({ open: true })
    void get().loadSessions()
  },
  closePanel: () => set({ open: false }),
  togglePanel: () => (get().open ? get().closePanel() : get().openPanel()),

  loadSessions: async () => {
    if (get().loadingSessions) return
    set({ loadingSessions: true })
    try {
      const sessions = await listChatSessions()
      set({ sessions, loadingSessions: false })
    } catch (error) {
      set({ loadingSessions: false })
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '会话列表加载失败', 'error')
    }
  },

  selectSession: async (sessionId) => {
    if (sessionId === get().currentSessionId) return
    get().stopStreaming()
    set({ currentSessionId: sessionId, messages: [], error: null })
    if (!sessionId) return
    set({ loadingMessages: true })
    try {
      const messages = await getChatMessages(sessionId)
      if (get().currentSessionId === sessionId) set({ messages, loadingMessages: false })
    } catch (error) {
      set({ loadingMessages: false })
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '历史消息加载失败', 'error')
    }
  },

  startNewSession: () => {
    get().stopStreaming()
    set({ currentSessionId: null, messages: [], streamingText: '', error: null })
  },

  ensureSession: async (context) => {
    const current = get().currentSessionId
    if (current) return current
    const session = await createChatSession(context)
    set((state) => ({
      sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
      currentSessionId: session.id,
    }))
    return session.id
  },

  removeSession: async (sessionId) => {
    const previous = get().sessions
    set((state) => ({ sessions: state.sessions.filter((item) => item.id !== sessionId) }))
    if (get().currentSessionId === sessionId) {
      get().startNewSession()
    }
    try {
      await deleteChatSession(sessionId)
      removeAnnotationsBySession(sessionId)
    } catch (error) {
      set({ sessions: previous })
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '删除会话失败', 'error')
    }
  },

  sendMessage: async (content, context) => {
    const trimmed = content.trim()
    if (!trimmed || get().streaming) return
    set({ error: null })
    const quotes = get().pendingQuotes
    let sessionId: string
    try {
      sessionId = await get().ensureSession(context)
    } catch (error) {
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '创建会话失败', 'error')
      return
    }

    const annotationIds = quotes
      .map((quote) => quote.annotation_id)
      .filter((item): item is string => Boolean(item))
    if (annotationIds.length) attachSessionToAnnotations(annotationIds, sessionId)

    const userMessage: ChatMessage = {
      id: makeId('local_user'),
      role: 'user',
      content: trimmed,
      meta: quotes.length ? { quotes } : undefined,
    }
    const assistantMessage: ChatMessage = { id: makeId('local_assistant'), role: 'assistant', content: '' }
    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      streaming: true,
      streamingText: '',
    }))

    const controller = new AbortController()
    set({ abortController: controller })

    const append = (text: string) => {
      set((state) => {
        const streamingText = state.streamingText + text
        const messages = state.messages.map((message) =>
          message.id === assistantMessage.id ? { ...message, content: streamingText } : message,
        )
        return { streamingText, messages }
      })
    }

    let delivered = false
    await streamChat(
      sessionId,
      trimmed,
      context,
      {
        onMeta: (data) => {
          delivered = true
          const messageId = data.message_id
          if (typeof messageId === 'string') {
            // Keep the stable local id for the lifetime of this stream.
            // Replacing it here makes later `delta` events unable to find the
            // assistant message, which caused the bubble to stay at "…".
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === assistantMessage.id
                  ? {
                      ...message,
                      meta: {
                        ...(message.meta ?? {}),
                        message_id: messageId,
                      },
                    }
                  : message,
              ),
            }))
          }
        },
        onDelta: append,
        onDone: () => {
          set({ streaming: false, abortController: null })
          void get().loadSessions()
        },
        onError: (code, message) => {
          set({ streaming: false, abortController: null, error: message })
          useAppStore.getState().pushToast(`AI 回复失败：${message}（${code}）`, 'error')
          void get().loadSessions()
        },
      },
      { quotes, signal: controller.signal },
    )

    // 后端已确认收到用户消息（meta 事件）后，才让“待发送引用”出队。
    if (delivered) get().clearQuotes({ keepAnnotations: true })
    if (get().streaming) set({ streaming: false, abortController: null })
    void get().loadSessions()
  },

  stopStreaming: () => {
    get().abortController?.abort()
    set({ streaming: false, abortController: null })
    const messages = get().messages
    let lastAssistant = -1
    messages.forEach((message, index) => {
      if (message.role === 'assistant') lastAssistant = index
    })
    if (lastAssistant >= 0 && messages[lastAssistant].content) {
      set({
        messages: messages.map((message, index) =>
          index === lastAssistant ? { ...message, content: `${message.content}\n\n_（已停止生成）_` } : message,
        ),
      })
    }
  },

  clearError: () => set({ error: null }),

  addQuote: (quote) => {
    const text = quote.text.trim()
    if (!text) return 'duplicate'
    const existing = get().pendingQuotes
    const normalized = normalizeQuoteText(text)
    if (existing.some((item) => normalizeQuoteText(item.text) === normalized)) return 'duplicate'
    if (existing.length >= MAX_PENDING_QUOTES) return 'limit'
    const next = [...existing, { ...quote, id: quote.id ?? makeId('quote'), text }]
    set({ pendingQuotes: next })
    persistPendingQuotes(next)
    return 'added'
  },

  removeQuote: (id) => {
    const target = get().pendingQuotes.find((item) => item.id === id)
    if (target?.annotation_id) removeAnnotation(target.annotation_id)
    const next = get().pendingQuotes.filter((item) => item.id !== id)
    set({ pendingQuotes: next })
    persistPendingQuotes(next)
  },

  clearQuotes: (options) => {
    if (!options?.keepAnnotations) {
      for (const quote of get().pendingQuotes) {
        if (quote.annotation_id) removeAnnotation(quote.annotation_id)
      }
    }
    set({ pendingQuotes: [] })
    persistPendingQuotes([])
  },
}))
