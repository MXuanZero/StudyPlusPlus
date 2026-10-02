/** Second-order compute endpoints (backend scipy/numpy is the single source of truth). */
import { apiGet, apiPost, isBackendUnavailable } from './client'
import type {
  CompareResponse,
  Preset,
  SimulationRequest,
  SimulationResponse,
} from './types'
import { useAppStore } from '../store/appStore'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

async function withCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T
  const value = await loader()
  cache.set(key, { at: Date.now(), value })
  return value
}

function mockEnabled(): boolean {
  return import.meta.env.DEV
}

export async function simulateSecondOrder(
  request: SimulationRequest,
  signal?: AbortSignal,
): Promise<SimulationResponse> {
  const key = `sim:${JSON.stringify(request)}`
  return withCache(key, async () => {
    try {
      const data = await apiPost<SimulationResponse>('/compute/second-order/simulate', request, signal)
      useAppStore.getState().setDataSource('api')
      return data
    } catch (error) {
      if (mockEnabled() && isBackendUnavailable(error)) {
        const { generateMockSimulation } = await import('../mocks/secondOrder')
        useAppStore.getState().setDataSource('mock')
        return generateMockSimulation(request)
      }
      throw error
    }
  })
}

export async function compareSecondOrder(
  runs: SimulationRequest[],
  signal?: AbortSignal,
): Promise<SimulationResponse[]> {
  const key = `cmp:${JSON.stringify(runs)}`
  return withCache(key, async () => {
    try {
      const data = await apiPost<CompareResponse>('/compute/second-order/compare', { runs }, signal)
      useAppStore.getState().setDataSource('api')
      return data.results ?? []
    } catch (error) {
      if (mockEnabled() && isBackendUnavailable(error)) {
        const { generateMockSimulation } = await import('../mocks/secondOrder')
        useAppStore.getState().setDataSource('mock')
        return runs.map((run) => generateMockSimulation(run))
      }
      throw error
    }
  })
}

export async function fetchPresets(signal?: AbortSignal): Promise<Preset[]> {
  try {
    const data = await apiGet<Preset[] | { presets: Preset[] }>('/compute/second-order/presets', signal)
    useAppStore.getState().setDataSource('api')
    return Array.isArray(data) ? data : data.presets ?? []
  } catch (error) {
    if (mockEnabled() && isBackendUnavailable(error)) {
      const { getMockPresets } = await import('../mocks/secondOrder')
      useAppStore.getState().setDataSource('mock')
      return getMockPresets()
    }
    throw error
  }
}
