import { create } from 'zustand'
import {
  createChatSession,
  deleteChatSession,
  getChatMessages,
  listChatSessions,
  streamChat,
} from '../api/chat'
import type { ChatContext, ChatMessage, ChatSession } from '../api/types'
import { useAppStore } from './appStore'
import { makeId } from '../utils/format'

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

  startNewSession: (context) => {
    get().stopStreaming()
    set({ currentSessionId: null, messages: [], streamingText: '', error: null })
    if (context) set({ error: null })
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
    } catch (error) {
      set({ sessions: previous })
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '删除会话失败', 'error')
    }
  },

  sendMessage: async (content, context) => {
    const trimmed = content.trim()
    if (!trimmed || get().streaming) return
    set({ error: null })
    let sessionId: string
    try {
      sessionId = await get().ensureSession(context)
    } catch (error) {
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '创建会话失败', 'error')
      return
    }

    const userMessage: ChatMessage = { id: makeId('local_user'), role: 'user', content: trimmed }
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

    await streamChat(
      sessionId,
      trimmed,
      context,
      {
        onMeta: (data) => {
          const messageId = data.message_id
          if (typeof messageId === 'string') {
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === assistantMessage.id ? { ...message, id: messageId } : message,
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
      controller.signal,
    )

    if (get().streaming) set({ streaming: false, abortController: null })
    void get().loadSessions()
  },

  stopStreaming: () => {
    get().abortController?.abort()
    set({ streaming: false, abortController: null })
    if (get().streamingText) {
      set((state) => {
        const messages = state.messages.map((message) => {
          if (message.role !== 'assistant') return message
          return message.content ? { ...message, content: `${message.content}\n\n_（已停止生成）_` } : message
        })
        return { messages }
      })
    }
  },

  clearError: () => set({ error: null }),
}))
