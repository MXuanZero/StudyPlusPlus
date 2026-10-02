import type { ReactNode } from 'react'

interface DetailsBlockProps {
  title: string
  children: ReactNode
}

/** 将 :::details 容器渲染为默认折叠的推导块。 */
export function DetailsBlock({ title, children }: DetailsBlockProps) {
  return (
    <details className="details-block">
      <summary>
        {title}
        <span className="details-hint">数学细节，可展开</span>
      </summary>
      <div className="details-content">{children}</div>
    </details>
  )
}
