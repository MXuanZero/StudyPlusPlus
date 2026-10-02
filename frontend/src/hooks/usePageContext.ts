import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import type { ChatContext } from '../api/types'
import { useLearningStore } from '../store/learningStore'

/** 根据当前路由与目录树，组装随聊天请求发送的页面上下文。 */
export function usePageContext(): ChatContext {
  const location = useLocation()
  const params = useParams()
  const curriculum = useLearningStore((state) => state.curriculum)

  return useMemo(() => {
    const chapterId = params.chapterId
    const topicId = params.topicId
    const context: ChatContext = { route: location.pathname }
    if (!chapterId) return context
    for (const book of curriculum?.books ?? []) {
      const chapter = book.chapters.find((item) => item.id === chapterId)
      if (!chapter) continue
      context.book = book.title
      context.chapter = chapter.title
      context.chapter_id = chapter.id
      context.learning_path = [`${book.title}`, chapter.title]
      const topic = topicId ? chapter.topics.find((item) => item.id === topicId) : undefined
      if (topic) {
        context.topic = topic.title
        context.topic_id = topic.id
        context.learning_path.push(topic.title)
      }
      break
    }
    return context
  }, [curriculum, location.pathname, params.chapterId, params.topicId])
}
