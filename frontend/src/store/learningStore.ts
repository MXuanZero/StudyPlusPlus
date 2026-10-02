import { create } from 'zustand'
import { fetchCurriculum } from '../api/curriculum'
import type { BookSummary, ChapterSummary, Curriculum, TopicSummary } from '../api/types'

interface LearningState {
  curriculum: Curriculum | null
  loading: boolean
  error: string | null
  loaded: boolean
  loadCurriculum: (force?: boolean) => Promise<void>
  findChapter: (chapterId: string) => { book: BookSummary; chapter: ChapterSummary } | null
  findTopic: (topicId: string) => { book: BookSummary; chapter: ChapterSummary; topic: TopicSummary } | null
  chapterTopics: (chapterId: string) => TopicSummary[]
}

export const useLearningStore = create<LearningState>((set, get) => ({
  curriculum: null,
  loading: false,
  error: null,
  loaded: false,
  loadCurriculum: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true, error: null })
    try {
      const curriculum = await fetchCurriculum()
      set({ curriculum, loading: false, loaded: true })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '课程目录加载失败',
      })
    }
  },
  findChapter: (chapterId) => {
    for (const book of get().curriculum?.books ?? []) {
      const chapter = book.chapters.find((item) => item.id === chapterId)
      if (chapter) return { book, chapter }
    }
    return null
  },
  findTopic: (topicId) => {
    for (const book of get().curriculum?.books ?? []) {
      for (const chapter of book.chapters) {
        const topic = chapter.topics.find((item) => item.id === topicId)
        if (topic) return { book, chapter, topic }
      }
    }
    return null
  },
  chapterTopics: (chapterId) => get().findChapter(chapterId)?.chapter.topics ?? [],
}))
