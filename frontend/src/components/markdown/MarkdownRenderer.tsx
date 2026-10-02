import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { WidgetConfig } from '../../api/types'
import { DetailsBlock } from './DetailsBlock'
import { tokenizeMarkdown } from '../../utils/markdownSegments'
import type { Annotation } from '../../utils/annotations'
import { applyAnnotationHighlights, getAnnotationIdFromEvent } from '../../utils/annotationHighlight'

/** Plotly 体积较大，仅在正文真正出现交互组件时动态加载。 */
const LazyWidgetRenderer = lazy(async () => {
  const module = await import('../widgets/WidgetRenderer')
  return { default: module.WidgetRenderer }
})

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
}

interface MarkdownRendererProps {
  markdown: string
  widgets?: WidgetConfig[]
  /** 章节页已经渲染了标题，默认去掉 Markdown 开头的重复 H1。 */
  stripLeadingHeading?: boolean
  /** 用户引用提问后保存在正文里的划线标注。 */
  annotations?: Annotation[]
  onAnnotationClick?: (annotation: Annotation) => void
  /** 只有最外层正文容器负责添加 data-quotable，避免详情块偏移基准不一致。 */
  quotable?: boolean
}

export function MarkdownRenderer({
  markdown,
  widgets = [],
  stripLeadingHeading = true,
  annotations = [],
  onAnnotationClick,
  quotable = true,
}: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const source = useMemo(
    () => (stripLeadingHeading ? markdown.replace(/^\s*#\s+.*(?:\r?\n)?/, '') : markdown),
    [markdown, stripLeadingHeading],
  )
  const segments = useMemo(() => tokenizeMarkdown(source), [source])
  const widgetMap = useMemo(() => {
    const map = new Map<string, WidgetConfig>()
    for (const widget of widgets) map.set(widget.id, widget)
    return map
  }, [widgets])

  useEffect(() => {
    if (!quotable) return
    const root = rootRef.current
    if (!root) return
    applyAnnotationHighlights(root, annotations)
    const handleClick = (event: MouseEvent) => {
      const annotationId = getAnnotationIdFromEvent(event.target)
      if (!annotationId) return
      const annotation = annotations.find((item) => item.id === annotationId)
      if (annotation) onAnnotationClick?.(annotation)
    }
    root.addEventListener('click', handleClick)
    return () => root.removeEventListener('click', handleClick)
  }, [annotations, markdown, onAnnotationClick, quotable])

  return (
    <div className="markdown-body" data-quotable={quotable || undefined} ref={rootRef}>
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={MARKDOWN_COMPONENTS}
            >
              {segment.content}
            </ReactMarkdown>
          )
        }
        if (segment.type === 'details') {
          return (
            <DetailsBlock key={index} title={segment.title}>
              <MarkdownRenderer
                markdown={segment.content}
                widgets={widgets}
                stripLeadingHeading={false}
                quotable={false}
              />
            </DetailsBlock>
          )
        }
        const widget = widgetMap.get(segment.id) ?? { id: segment.id, type: segment.id }
        return (
          <Suspense
            key={`${index}-${segment.id}`}
            fallback={
              <div className="widget-slot">
                <div className="widget-unknown">交互组件加载中…</div>
              </div>
            }
          >
            <LazyWidgetRenderer widget={widget} />
          </Suspense>
        )
      })}
    </div>
  )
}
