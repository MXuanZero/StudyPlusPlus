/** Learning-progress endpoints (T9). */
import { apiGet, apiPut } from './client'

export type ProgressStatus = 'not_started' | 'learning' | 'completed'

export interface ProgressItem {
  topic_id: string
  status: ProgressStatus
  updated_at: string
}

export interface ChapterProgress {
  chapter_id: string
  total: number
  completed: number
  percent: number
}

export async function listProgress(): Promise<ProgressItem[]> {
  const data = await apiGet<{ items: ProgressItem[] }>('/progress')
  return data.items ?? []
}

export function updateProgress(topicId: string, status: ProgressStatus): Promise<ProgressItem> {
  return apiPut<ProgressItem>(`/progress/${encodeURIComponent(topicId)}`, { status })
}

export function getChapterProgress(chapterId: string): Promise<ChapterProgress> {
  return apiGet<ChapterProgress>(`/progress/${encodeURIComponent(chapterId)}`)
}
