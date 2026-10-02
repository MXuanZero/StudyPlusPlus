import { lazy, Suspense, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { WidgetConfig } from '../../api/types'
import { DetailsBlock } from './DetailsBlock'
import { tokenizeMarkdown } from '../../utils/markdownSegments'

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
}

export function MarkdownRenderer({ markdown, widgets = [], stripLeadingHeading = true }: MarkdownRendererProps) {
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

  return (
    <div className="markdown-body" data-quotable>
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
              <MarkdownRenderer markdown={segment.content} widgets={widgets} stripLeadingHeading={false} />
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
