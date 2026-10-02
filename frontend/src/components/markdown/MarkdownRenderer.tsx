import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { WidgetConfig } from '../../api/types'
import { WidgetRenderer } from '../widgets/WidgetRenderer'
import { DetailsBlock } from './DetailsBlock'

type Segment =
  | { type: 'markdown'; content: string }
  | { type: 'details'; title: string; content: string }
  | { type: 'widget'; id: string }

const DETAILS_START = /^:::details(?:\s+(.*))?$/
const DETAILS_END = /^:::\s*$/
const WIDGET_LINE = /^\s*\[\[widget:([^\]]+)\]\]\s*$/

/**
 * 把 Markdown 拆成普通段落、:::details 折叠块和 [[widget:id]] 占位。
 * 这样无需额外插件即可实现自定义容器，并让 widget 由注册表接管。
 */
export function tokenizeMarkdown(markdown: string): Segment[] {
  const lines = markdown.split('\n')
  const segments: Segment[] = []
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content) segments.push({ type: 'markdown', content })
    buffer = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const detailsMatch = DETAILS_START.exec(line.trim())
    if (detailsMatch) {
      flush()
      const title = (detailsMatch[1] || '数学细节').trim()
      const inner: string[] = []
      index += 1
      while (index < lines.length && !DETAILS_END.test(lines[index].trim())) {
        inner.push(lines[index])
        index += 1
      }
      segments.push({ type: 'details', title, content: inner.join('\n') })
      continue
    }
    const widgetMatch = WIDGET_LINE.exec(line)
    if (widgetMatch) {
      flush()
      segments.push({ type: 'widget', id: widgetMatch[1].trim() })
      continue
    }
    buffer.push(line)
  }
  flush()
  return segments
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, ...props }) => (
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
    <div className="markdown-body">
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
        return <WidgetRenderer key={`${index}-${segment.id}`} widget={widget} />
      })}
    </div>
  )
}
