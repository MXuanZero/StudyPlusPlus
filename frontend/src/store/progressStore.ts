import { create } from 'zustand'
import {
  getChapterProgress,
  listProgress,
  updateProgress,
  type ChapterProgress,
  type ProgressItem,
  type ProgressStatus,
} from '../api/progress'
import { useAppStore } from './appStore'

interface ProgressState {
  items: Record<string, ProgressItem>
  chapterProgress: Record<string, ChapterProgress>
  loading: boolean
  loaded: boolean
  error: string | null
  loadProgress: (force?: boolean) => Promise<void>
  loadChapterProgress: (chapterId: string, force?: boolean) => Promise<void>
  getStatus: (topicId: string) => ProgressStatus
  setStatus: (topicId: string, status: ProgressStatus) => Promise<void>
}

export const useProgressStore = create<ProgressState>((set, get) => ({
  items: {},
  chapterProgress: {},
  loading: false,
  loaded: false,
  error: null,

  loadProgress: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true, error: null })
    try {
      const items = await listProgress()
      const mapped: Record<string, ProgressItem> = {}
      for (const item of items) mapped[item.topic_id] = item
      set({ items: mapped, loading: false, loaded: true })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '学习进度加载失败',
      })
    }
  },

  loadChapterProgress: async (chapterId, force = false) => {
    if (!force && get().chapterProgress[chapterId]) return
    try {
      const progress = await getChapterProgress(chapterId)
      set((state) => ({ chapterProgress: { ...state.chapterProgress, [chapterId]: progress } }))
    } catch (error) {
      // 章节进度失败不阻塞正文；错误会由调用方按需提示。
      set({ error: error instanceof Error ? error.message : '章节进度加载失败' })
    }
  },

  getStatus: (topicId) => get().items[topicId]?.status ?? 'not_started',

  setStatus: async (topicId, status) => {
    const previous = get().items
    const optimistic: ProgressItem = {
      topic_id: topicId,
      status,
      updated_at: new Date().toISOString(),
    }
    set({ items: { ...previous, [topicId]: optimistic } })
    try {
      const saved = await updateProgress(topicId, status)
      set((state) => ({ items: { ...state.items, [topicId]: saved } }))
    } catch (error) {
      set({ items: previous })
      useAppStore.getState().pushToast(error instanceof Error ? error.message : '进度保存失败', 'error')
      throw error
    }
  },
}))
