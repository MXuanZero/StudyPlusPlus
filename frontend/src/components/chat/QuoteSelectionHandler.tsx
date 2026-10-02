import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePageContext } from '../../hooks/usePageContext'
import { useAppStore } from '../../store/appStore'
import { useChatStore } from '../../store/chatStore'
import { makeId } from '../../utils/format'
import { addAnnotation } from '../../utils/annotations'
import { getRangeOffsets } from '../../utils/annotationHighlight'

const MAX_QUOTE_LENGTH = 5000

interface ButtonPosition {
  top: number
  left: number
}

/**
 * 全局监听正文选区：当鼠标在 `[data-quotable]`（课程 Markdown 正文）内选中文字时，
 * 在选区旁显示“引用到 AI”浮动按钮。
 */
export function QuoteSelectionHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const pageContext = usePageContext()
  const addQuote = useChatStore((state) => state.addQuote)
  const openPanel = useChatStore((state) => state.openPanel)
  const pushToast = useAppStore((state) => state.pushToast)

  const [position, setPosition] = useState<ButtonPosition | null>(null)
  const [selectedText, setSelectedText] = useState('')

  const hide = useCallback(() => setPosition(null), [])

  useEffect(() => {
    const evaluateSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide()
        return
      }
      const anchor = selection.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      if (!element || !element.closest('[data-quotable]')) {
        hide()
        return
      }
      const text = selection.toString().trim()
      if (!text) {
        hide()
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        hide()
        return
      }
      const buttonWidth = 116
      const buttonHeight = 34
      let left = rect.left + rect.width / 2 - buttonWidth / 2
      left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - buttonWidth - 8))
      let top = rect.top - buttonHeight - 8
      if (top < 60) top = Math.min(window.innerHeight - buttonHeight - 8, rect.bottom + 8)
      setSelectedText(text)
      setPosition({ top, left })
    }

    const onPointerUp = () => window.setTimeout(evaluateSelection, 0)
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.shiftKey) window.setTimeout(evaluateSelection, 0)
    }
    const onScrollOrResize = () => hide()

    document.addEventListener('mouseup', onPointerUp)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mouseup', onPointerUp)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [hide])

  const handleClick = () => {
    const text = selectedText.trim()
    if (!text) {
      pushToast('请先选中要引用的正文内容', 'info')
      hide()
      return
    }
    if (text.length > MAX_QUOTE_LENGTH) {
      pushToast(`选中内容超过 ${MAX_QUOTE_LENGTH} 字符，请缩短后再引用`, 'error')
      return
    }

    // 记录选区在正文中的字符范围，用于后续给原文加划线。
    let start = -1
    let end = -1
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const anchor = selection.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      const container = element?.closest('[data-quotable]') as HTMLElement | null
      const offsets = container ? getRangeOffsets(container, range) : null
      if (offsets) {
        start = offsets.start
        end = offsets.end
      }
    }

    const source = [pageContext.book, pageContext.chapter, pageContext.topic]
      .filter(Boolean)
      .join(' / ')
    const quoteId = makeId('quote')
    const annotationId = makeId('anno')
    const result = addQuote({
      id: quoteId,
      text,
      source: source || undefined,
      topic_id: pageContext.topic_id,
      topic_title: pageContext.topic,
      annotation_id: annotationId,
    })

    if (result === 'added') {
      addAnnotation({
        id: annotationId,
        topic_id: pageContext.topic_id ?? pageContext.chapter_id ?? 'unknown',
        chapter_id: pageContext.chapter_id ?? '',
        text,
        start,
        end,
      })
      pushToast('已加入待发送引用，正文已划线', 'success')
    } else if (result === 'duplicate') {
      pushToast('这条引用已在待发送列表中', 'info')
    } else {
      pushToast('待发送引用最多 5 条，请先删除或发送', 'error')
    }

    // 知识点页面：点击引用后立即进入 AI 分屏页面，引用卡片会直接出现在输入框上方。
    const normalizedPath = location.pathname.replace(/\/+$/, '')
    const segments = normalizedPath.split('/').filter(Boolean)
    const isLearnTopicPage =
      segments[0] === 'learn' && segments.length >= 3 && !normalizedPath.endsWith('/assistant')

    if (isLearnTopicPage) {
      navigate(`${normalizedPath}/assistant`)
    } else {
      openPanel()
    }

    window.getSelection()?.removeAllRanges()
    hide()
  }

  if (!position) return null

  return (
    <button
      type="button"
      className="quote-fab"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleClick}
      aria-label="引用到 AI"
    >
      ❝ 引用到 AI
    </button>
  )
}
