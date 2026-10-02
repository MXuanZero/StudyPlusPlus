/** LLM settings endpoints (T8). Real backend only; never persists the API key client-side. */
import { apiGet, apiPost, apiPut } from './client'

export type LLMProvider = 'deepseek' | 'openai' | 'ollama' | 'custom'
export type KeySource = 'database' | 'environment' | 'none'
export type LLMMode = 'live' | 'mock'

export interface LLMSettings {
  provider: string
  base_url: string
  model: string
  temperature: number
  max_tokens: number
  has_api_key: boolean
  /** 后端实际字段名；同时兼容任务描述里的 masked_api_key。 */
  api_key_masked: string
  masked_api_key?: string
  key_source: KeySource
  mode: LLMMode
  effective_base_url: string
}

export interface LLMSettingsUpdate {
  provider?: string
  base_url?: string
  model?: string
  /** 留空或省略表示不修改已保存的 Key。 */
  api_key?: string
  temperature?: number
  max_tokens?: number
}

export interface LLMTestResult {
  ok: boolean
  mode: LLMMode
  message: string
  provider: string
  model: string
  latency_ms: number | null
  code: string | null
}

export function getLLMSettings(): Promise<LLMSettings> {
  return apiGet<LLMSettings>('/settings/llm')
}

export function updateLLMSettings(payload: LLMSettingsUpdate): Promise<LLMSettings> {
  return apiPut<LLMSettings>('/settings/llm', payload)
}

export function testLLMSettings(): Promise<LLMTestResult> {
  return apiPost<LLMTestResult>('/settings/llm/test')
}

export function resetLLMSettings(): Promise<LLMSettings> {
  return apiPost<LLMSettings>('/settings/llm/reset')
}
