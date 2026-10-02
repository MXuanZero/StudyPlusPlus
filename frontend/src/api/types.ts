/**
 * Shared API contract types for StudyPlusPlus.
 * Field names follow docs/02_技术方案与架构.md section 5 (API design).
 */

export type Availability = 'available' | 'planned'
export type InputType = 'step' | 'impulse' | 'initial'
export type ApiSource = 'api' | 'mock'

export interface WidgetConfig {
  id: string
  /** Widget registry key, e.g. second_order_lab */
  type: string
  default_mode?: InputType
  default_compare?: boolean
  show_metrics?: boolean
  show_phase_portrait?: boolean
  presets?: string[]
  [key: string]: unknown
}

export interface TopicSummary {
  id: string
  title: string
  file?: string | null
  /** curriculum 中为 widget id 字符串数组；topic 详情中才是完整 WidgetConfig。 */
  widgets?: string[]
  status: Availability
}

export interface ChapterSummary {
  id: string
  title: string
  status: Availability
  topics: TopicSummary[]
}

export interface BookSummary {
  id: string
  title: string
  chapters: ChapterSummary[]
}

export interface Curriculum {
  books: BookSummary[]
}

export interface TopicNav {
  id: string
  title: string
}

export interface TopicDetail {
  id: string
  chapter_id: string
  title: string
  order: number
  summary: string
  learning_objectives: string[]
  prerequisites: string[]
  body_markdown: string
  widgets: WidgetConfig[]
  prev_topic: TopicNav | null
  next_topic: TopicNav | null
}

export interface Pole {
  real: number
  imag: number
}

export interface Metrics {
  rise_time_10_90: number | null
  rise_time_0_100: number | null
  peak_time: number | null
  peak_value: number | null
  overshoot_pct: number | null
  settling_time_2pct: number | null
  settling_time_5pct: number | null
  steady_state_value: number | null
  [key: string]: number | null | undefined
}

export interface SimulationRequest {
  /** 仅 compare 接口使用，单组 simulate 会忽略。 */
  label?: string
  zeta: number
  omega_n: number
  input_type: InputType
  y0: number
  v0: number
  t_end: number
  n_points: number
  include_metrics: boolean
}

export interface SimulationResponse {
  classification: string
  poles: Pole[]
  t: number[]
  y: number[]
  u: number[]
  metrics: Metrics | null
  analytical_metrics?: Partial<Metrics> | null
  diagnostics: string[]
  /** compare 接口可能回传的展示标签 */
  label?: string | null
  /** compare 接口可能回传的颜色 */
  color?: string | null
}

export interface CompareRequest {
  runs: SimulationRequest[]
}

export interface CompareResponse {
  results: SimulationResponse[]
}

export interface Preset {
  key?: string
  label?: string
  name?: string
  zeta: number
  omega_n: number
  description?: string
  input_type?: InputType
}

export interface ChatContext {
  book?: string
  chapter?: string
  topic?: string
  topic_id?: string
  chapter_id?: string
  route?: string
  learning_objectives?: string[]
  learning_path?: string[]
}

/** 从课程正文选中并引用给 AI 的段落。 */
export interface ChatQuote {
  id?: string
  text: string
  source?: string
  topic_id?: string
  topic_title?: string
}

export interface ChatSession {
  id: string
  title: string
  context?: ChatContext | null
  message_count?: number
  created_at?: string
  updated_at?: string
}

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessageMeta {
  quotes?: ChatQuote[]
  message_id?: string
  mode?: string
  usage?: Record<string, unknown>
  [key: string]: unknown
}

export interface ChatMessage {
  id?: string | number
  session_id?: string
  role: ChatRole
  content: string
  created_at?: string
  meta?: ChatMessageMeta | null
}

export interface ChatStreamEvent {
  event: 'meta' | 'delta' | 'done' | 'error'
  data: Record<string, unknown>
}
