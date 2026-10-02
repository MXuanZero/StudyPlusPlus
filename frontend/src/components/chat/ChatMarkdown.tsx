import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

const COMPONENTS: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
}

interface ChatMarkdownProps {
  content: string
}

/**
 * Lightweight Markdown + KaTeX renderer for AI chat bubbles.
 *
 * It intentionally avoids the page-level WidgetRenderer: chat messages may be
 * partial while streaming, and they should never mount heavy Plotly widgets.
 */
export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
