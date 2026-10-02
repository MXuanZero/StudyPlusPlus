/**
 * Thin typed fetch wrapper around the versioned REST API.
 * All production traffic must go through `API_BASE` (/api/v1).
 */
import type { ApiSource } from './types'

export const API_BASE = '/api/v1'

export interface ApiErrorDetail {
  code: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 404/405/网络错误说明后端路由还未就绪，开发期可回退到本地 mock。 */
export function isBackendUnavailable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 404 || error.status === 405 || error.status === 501
  }
  return error instanceof TypeError
}

function parseError(status: number, payload: unknown): ApiError {
  const detail = (payload as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return new ApiError(status, 'HTTP_ERROR', detail)
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>
    return new ApiError(
      status,
      String(record.code ?? 'HTTP_ERROR'),
      String(record.message ?? '请求失败'),
    )
  }
  return new ApiError(status, 'HTTP_ERROR', `请求失败（HTTP ${status}）`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw parseError(response.status, payload)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal })
}

export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
