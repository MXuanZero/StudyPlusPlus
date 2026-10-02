/**
 * DEV-ONLY fallback for /api/v1/chat/*.
 *
 * 生产环境必须连接后端 SSE；这里只在开发期后端 T6 未就绪时兜底，
 * 会话写入 localStorage，便于刷新后继续验证历史功能。
 */
import type { ChatContext, ChatMessage, ChatSession } from '../api/types'

const SESSION_KEY = 'spp.mock.chat.sessions'
const MESSAGE_KEY = 'spp.mock.chat.messages'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage 不可用时静默降级为内存会话 */
  }
}

let memorySessions: ChatSession[] = read<ChatSession[]>(SESSION_KEY, [])
let memoryMessages: Record<string, ChatMessage[]> = read<Record<string, ChatMessage[]>>(MESSAGE_KEY, {})

function persist(): void {
  write(SESSION_KEY, memorySessions)
  write(MESSAGE_KEY, memoryMessages)
}

export function mockListSessions(): ChatSession[] {
  return [...memorySessions].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
}

export function mockCreateSession(context?: ChatContext): ChatSession {
  const now = new Date().toISOString()
  const session: ChatSession = {
    id: `sess_mock_${Date.now().toString(36)}`,
    title: '新会话',
    context: context ?? null,
    message_count: 0,
    created_at: now,
    updated_at: now,
  }
  memorySessions = [session, ...memorySessions]
  memoryMessages[session.id] = []
  persist()
  return session
}

export function mockDeleteSession(sessionId: string): void {
  memorySessions = memorySessions.filter((session) => session.id !== sessionId)
  delete memoryMessages[sessionId]
  persist()
}

export function mockGetMessages(sessionId: string): ChatMessage[] {
  return memoryMessages[sessionId] ?? []
}

export function mockUpdateSessionContext(sessionId: string, context: ChatContext): void {
  const session = memorySessions.find((item) => item.id === sessionId)
  if (!session) return
  session.context = context
  session.updated_at = new Date().toISOString()
  persist()
}

function buildMockReply(content: string, context?: ChatContext | null): string {
  const where = context?.topic ? `《${context.topic}》` : '控制理论'
  if (/超调|振荡|阻尼/.test(content)) {
    return `我们先不写公式，用推购物车来想：阻尼就像摩擦力，摩擦力越大，车冲过头再来回摆动的次数就越少。\n\n在 ${where} 里，$\zeta$（阻尼比）就是描述这股摩擦力大小的量：\n\n- $\zeta$ 很小时，车会来回晃很久；\n- $\zeta=1$ 时，车最快回到目标位置而且不冲过头；\n- $\zeta>1$ 时，车虽然不晃，但回来得更慢。\n\n你可以把滑杆从 0 慢慢拉到 1，同时盯住曲线最高点和极点位置，就能直观看到这个规律。`
  }
  if (/极点|稳定/.test(content)) {
    return `极点可以理解成系统的“性格标签”，它直接告诉你系统接下来会怎么动。\n\n- 极点都在左半平面：扰动会衰减，系统稳定；\n- 只要有极点在右半平面：扰动会被放大，系统发散；\n- 极点离虚轴越远：衰减越快，系统动作越快；\n- 极点有虚部：系统会来回振荡。\n\n当前页面 ${where} 的极点图里，虚轴就是稳定与不稳定的分界线。`
  }
  if (/指标|上升时间|调节时间|峰值/.test(content)) {
    return `性能指标是用四个数字来概括一条曲线：\n\n1. **上升时间 $t_r$**：从稳态值的 10% 升到 90% 需要多久；\n2. **峰值时间 $t_p$**：第一次到达最大值的时间；\n3. **超调量 $M_p$**：冲过稳态值的百分比；\n4. **调节时间 $t_s$**：进入并保持在稳态值 ±2% 或 ±5% 内的时间。\n\n它们本质上都在描述同一件事：系统从“被扰动”到“稳定下来”的过程有多快、有多平稳。指标表里同时给出数值计算值和近似公式值，你可以比较两者的差距。`
  }
  return `我是 StudyPlusPlus 的助教（当前为 Mock 模式，尚未配置大模型 Key）。\n\n你正在学习 ${where}。可以试着这样问我：\n\n- “为什么欠阻尼系统会振荡？”\n- “极点在左半平面代表什么？”\n- “超调量和阻尼比是什么关系？”\n\n配置大模型后，我会结合当前章节给出更具体的讲解。`
}

export interface MockStreamHandlers {
  onMeta?: (data: Record<string, unknown>) => void
  onDelta?: (text: string) => void
  onDone?: (data: Record<string, unknown>) => void
  onError?: (code: string, message: string) => void
}

export async function mockStreamMessage(
  sessionId: string,
  content: string,
  context: ChatContext | null | undefined,
  handlers: MockStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const session = memorySessions.find((item) => item.id === sessionId)
  if (!session) {
    handlers.onError?.('SESSION_NOT_FOUND', '会话不存在')
    return
  }
  const now = new Date().toISOString()
  const userMessage: ChatMessage = { id: `msg_mock_${Date.now()}u`, session_id: sessionId, role: 'user', content, created_at: now }
  memoryMessages[sessionId] = [...(memoryMessages[sessionId] ?? []), userMessage]
  if (session.title === '新会话') session.title = content.slice(0, 18) || '新会话'
  session.updated_at = now
  if (context) session.context = context
  persist()

  const reply = buildMockReply(content, context)
  const messageId = `msg_mock_${Date.now()}a`
  handlers.onMeta?.({ message_id: messageId, mode: 'mock' })

  const chunks = reply.match(/.{1,8}/gs) ?? [reply]
  let full = ''
  for (const chunk of chunks) {
    if (signal?.aborted) break
    await new Promise((resolve) => window.setTimeout(resolve, 28))
    if (signal?.aborted) break
    full += chunk
    handlers.onDelta?.(chunk)
  }

  memoryMessages[sessionId] = [
    ...(memoryMessages[sessionId] ?? []),
    { id: messageId, session_id: sessionId, role: 'assistant', content: full, created_at: new Date().toISOString() },
  ]
  session.message_count = memoryMessages[sessionId].length
  session.updated_at = new Date().toISOString()
  persist()
  handlers.onDone?.({ message_id: messageId, usage: { prompt_tokens: 0, completion_tokens: chunks.length } })
}
