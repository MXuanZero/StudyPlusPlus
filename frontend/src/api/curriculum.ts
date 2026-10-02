/** Curriculum / topic endpoints. Real API first, dev mock only as fallback. */
import { apiGet, isBackendUnavailable } from './client'
import type { Curriculum, TopicDetail } from './types'
import { useAppStore } from '../store/appStore'

export async function fetchCurriculum(): Promise<Curriculum> {
  try {
    const data = await apiGet<Curriculum>('/curriculum')
    if (!data || !Array.isArray(data.books)) throw new Error('EMPTY_CURRICULUM')
    useAppStore.getState().setDataSource('api')
    return data
  } catch (error) {
    if (import.meta.env.DEV && (isBackendUnavailable(error) || (error as Error).message === 'EMPTY_CURRICULUM')) {
      const { MOCK_CURRICULUM } = await import('../mocks/curriculum')
      useAppStore.getState().setDataSource('mock')
      return MOCK_CURRICULUM
    }
    throw error
  }
}

export async function fetchTopic(topicId: string): Promise<TopicDetail> {
  try {
    const data = await apiGet<TopicDetail>(`/topics/${encodeURIComponent(topicId)}`)
    if (!data || typeof data.body_markdown !== 'string') throw new Error('EMPTY_TOPIC')
    useAppStore.getState().setDataSource('api')
    return data
  } catch (error) {
    if (import.meta.env.DEV && (isBackendUnavailable(error) || (error as Error).message === 'EMPTY_TOPIC')) {
      const { getMockTopic } = await import('../mocks/curriculum')
      const topic = getMockTopic(topicId)
      if (topic) {
        useAppStore.getState().setDataSource('mock')
        return topic
      }
    }
    throw error
  }
}
