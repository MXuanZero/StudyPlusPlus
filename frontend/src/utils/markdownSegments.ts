/**
 * 把课程 Markdown 拆成普通段落、:::details 折叠块和 [[widget:id]] 占位。
 * 纯函数、无 React 依赖，便于独立测试。
 */
export type MarkdownSegment =
  | { type: 'markdown'; content: string }
  | { type: 'details'; title: string; content: string }
  | { type: 'widget'; id: string }

const DETAILS_START = /^:::details(?:\s+(.*))?$/
const DETAILS_END = /^:::\s*$/
const WIDGET_LINE = /^\s*\[\[widget:([^\]]+)\]\]\s*$/

export function tokenizeMarkdown(markdown: string): MarkdownSegment[] {
  const lines = markdown.split('\n')
  const segments: MarkdownSegment[] = []
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
