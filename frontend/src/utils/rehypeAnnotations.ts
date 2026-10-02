import type { Annotation } from './annotations'

/* eslint-disable @typescript-eslint/no-explicit-any */
type HastNode = any
type HastElement = any

const IGNORED_TAGS = new Set(['code', 'pre', 'a'])

function classNames(properties: Record<string, unknown> | undefined): string[] {
  const value = properties?.className
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return [value]
  return []
}

function isIgnored(node: HastNode): boolean {
  if (!node || node.type !== 'element') return false
  if (IGNORED_TAGS.has(node.tagName)) return true
  return classNames(node.properties).some(
    (name) => name === 'katex' || name.startsWith('katex-') || name === 'math',
  )
}

function makeMark(annotationId: string, text: string): HastElement {
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      annotationId,
      className: ['annotation-highlight'],
    },
    children: [{ type: 'text', value: text }],
  }
}

function wrapText(value: string, annotations: Annotation[]): HastNode[] {
  let segments: HastNode[] = [{ type: 'text', value }]

  for (const annotation of annotations) {
    const target = annotation.text.trim()
    if (!target) continue
    const next: HastNode[] = []
    for (const segment of segments) {
      if (segment.type !== 'text') {
        next.push(segment)
        continue
      }
      let rest = segment.value as string
      while (true) {
        const index = rest.indexOf(target)
        if (index < 0) {
          if (rest) next.push({ type: 'text', value: rest })
          break
        }
        if (index > 0) next.push({ type: 'text', value: rest.slice(0, index) })
        next.push(makeMark(annotation.id, target))
        rest = rest.slice(index + target.length)
      }
    }
    segments = next
  }

  return segments
}

function transformChildren(node: HastNode, annotations: Annotation[]): void {
  if (!Array.isArray(node?.children)) return
  const next: HastNode[] = []
  for (const child of node.children) {
    if (child?.type === 'text' && !isIgnored(node)) {
      next.push(...wrapText(String(child.value ?? ''), annotations))
      continue
    }
    if (!isIgnored(child)) transformChildren(child, annotations)
    next.push(child)
  }
  node.children = next
}

/**
 * Rehype plugin: wrap quoted course text in <mark> elements at the AST level.
 *
 * Doing this during rendering avoids mutating React-managed DOM nodes, which
 * previously caused white screens when the MarkdownRenderer unmounted during
 * chapter navigation.
 */
export function rehypeAnnotationHighlights(options: { annotations?: Annotation[] }) {
  return (tree: HastNode) => {
    transformChildren(tree, options.annotations ?? [])
  }
}
