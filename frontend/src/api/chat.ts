/** Chat endpoints + SSE stream parsing. Real API first, dev mock only as fallback. */
import { API_BASE, apiDelete, apiGet, apiPost, isBackendUnavailable } from './client'
import type { ChatContext, ChatMessage, ChatSession } from './types'
import { useAppStore } from '../store/appStore'

export interface StreamHandlers {
  onMeta?: (data: Record<string, unknown>) => void
  onDelta?: (text: string) => void
  onDone?: (data: Record<string, unknown>) => void
  onError?: (code: string, message: string) => void
}

function mockEnabled(): boolean {
  return import.meta.env.DEV
}

export async function listChatSessions(signal?: AbortSignal): Promise<ChatSession[]> {
  try {
    const data = await apiGet<{ sessions: ChatSession[] }>('/chat/sessions', signal)
    useAppStore.getState().setDataSource('api')
    return data.sessions ?? []
  } catch (error) {
    if (mockEnabled() && isBackendUnavailable(error)) {
      const { mockListSessions } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      return mockListSessions()
    }
    throw error
  }
}

export async function createChatSession(context?: ChatContext): Promise<ChatSession> {
  try {
    const data = await apiPost<ChatSession>('/chat/sessions', context ? { context } : {})
    useAppStore.getState().setDataSource('api')
    return data
  } catch (error) {
    if (mockEnabled() && isBackendUnavailable(error)) {
      const { mockCreateSession } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      return mockCreateSession(context)
    }
    throw error
  }
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  try {
    await apiDelete(`/chat/sessions/${encodeURIComponent(sessionId)}`)
    useAppStore.getState().setDataSource('api')
  } catch (error) {
    if (mockEnabled() && isBackendUnavailable(error)) {
      const { mockDeleteSession } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      mockDeleteSession(sessionId)
      return
    }
    throw error
  }
}

export async function getChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  try {
    const data = await apiGet<{ messages: ChatMessage[] }>(
      `/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
      signal,
    )
    useAppStore.getState().setDataSource('api')
    return data.messages ?? []
  } catch (error) {
    if (mockEnabled() && isBackendUnavailable(error)) {
      const { mockGetMessages } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      return mockGetMessages(sessionId)
    }
    throw error
  }
}

/** Parse one `event:`/`data:` SSE block. Returns true when handled. */
function dispatchSseBlock(block: string, handlers: StreamHandlers): void {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length) return
  const raw = dataLines.join('\n')
  if (raw === '[DONE]') {
    handlers.onDone?.({})
    return
  }
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    payload = { content: raw }
  }
  if (event === 'meta') handlers.onMeta?.(payload)
  else if (event === 'delta') handlers.onDelta?.(String(payload.content ?? ''))
  else if (event === 'done') handlers.onDone?.(payload)
  else if (event === 'error') {
    handlers.onError?.(String(payload.code ?? 'LLM_ERROR'), String(payload.message ?? '生成失败'))
  } else if (typeof payload.content === 'string') {
    handlers.onDelta?.(payload.content)
  }
}

async function readSseBody(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (block.trim()) dispatchSseBlock(block, handlers)
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) dispatchSseBlock(buffer, handlers)
  } finally {
    reader.releaseLock()
  }
}

/**
 * POST /chat/sessions/{id}/stream with SSE response.
 * Resolves when the stream ends or the user aborts. Stream-level errors go to onError.
 */
export async function streamChat(
  sessionId: string,
  content: string,
  context: ChatContext | null | undefined,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = { content }
  if (context) body.context = context
  let response: Response
  try {
    response = await fetch(`${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) return
    if (mockEnabled()) {
      const { mockStreamMessage } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      await mockStreamMessage(sessionId, content, context, handlers, signal)
      return
    }
    handlers.onError?.('LLM_CONNECTION_ERROR', error instanceof Error ? error.message : '无法连接后端')
    return
  }

  if (!response.ok) {
    let detail: { code?: string; message?: string } | null = null
    try {
      const payload = (await response.json()) as { detail?: { code?: string; message?: string } }
      detail = payload.detail ?? null
    } catch {
      detail = null
    }
    if (mockEnabled() && (response.status === 404 || response.status === 405)) {
      const { mockStreamMessage } = await import('../mocks/chat')
      useAppStore.getState().setDataSource('mock')
      await mockStreamMessage(sessionId, content, context, handlers, signal)
      return
    }
    handlers.onError?.(
      detail?.code ?? 'LLM_HTTP_ERROR',
      detail?.message ?? `请求失败（HTTP ${response.status}）`,
    )
    return
  }

  useAppStore.getState().setDataSource('api')
  if (!response.body) {
    handlers.onError?.('LLM_BAD_RESPONSE', '响应体为空')
    return
  }
  await readSseBody(response.body, handlers, signal)
}
