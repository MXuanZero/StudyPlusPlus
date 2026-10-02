import type { Annotation } from './annotations'

const IGNORED_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  '.widget-slot',
  '.plotly',
  '.katex',
  '.katex-display',
  '.quote-fab',
].join(',')

function isIgnored(textNode: Text): boolean {
  const parent = textNode.parentElement
  if (!parent) return true
  return Boolean(parent.closest(IGNORED_SELECTOR))
}

export function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text
      if (!text.nodeValue || isIgnored(text)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function nodeOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
  preferEnd: boolean,
): number | null {
  const nodes = collectTextNodes(root)
  const positionOf = (target: Text): number => {
    let total = 0
    for (const item of nodes) {
      if (item === target) return total
      total += item.nodeValue?.length ?? 0
    }
    return -1
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const position = positionOf(node as Text)
    return position < 0 ? null : position + offset
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const descendants = collectTextNodes(node as HTMLElement)
    if (!descendants.length) return null
    const target = preferEnd ? descendants[descendants.length - 1] : descendants[0]
    const position = positionOf(target)
    return position < 0 ? null : position
  }

  return null
}

/** Convert a DOM Range into character offsets relative to a quotable root. */
export function getRangeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  const start = nodeOffset(root, range.startContainer, range.startOffset, false)
  const end = nodeOffset(root, range.endContainer, range.endOffset, true)
  if (start === null || end === null || end <= start) return null
  return { start, end }
}

function clearHighlights(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.annotation-highlight'))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
  }
  root.normalize()
}

function wrapTextNode(
  node: Text,
  start: number,
  end: number,
  annotationId: string,
): void {
  const text = node.nodeValue ?? ''
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  if (safeStart >= safeEnd) return
  const before = text.slice(0, safeStart)
  const middle = text.slice(safeStart, safeEnd)
  const after = text.slice(safeEnd)

  const mark = document.createElement('mark')
  mark.className = 'annotation-highlight'
  mark.dataset.annotationId = annotationId
  mark.title = '点击查看相关 AI 提问'
  mark.textContent = middle

  const fragment = document.createDocumentFragment()
  if (before) fragment.appendChild(document.createTextNode(before))
  fragment.appendChild(mark)
  if (after) fragment.appendChild(document.createTextNode(after))
  node.parentNode?.replaceChild(fragment, node)
}

interface OffsetRange {
  startNode: Text
  startOffset: number
  endNode: Text
  endOffset: number
}

function findOffsetRange(
  root: HTMLElement,
  start: number,
  end: number,
): OffsetRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    return null
  }
  const nodes = collectTextNodes(root)
  let total = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0
    if (!startNode && start < total + length) {
      startNode = node
      startOffset = start - total
    }
    if (startNode && end <= total + length) {
      endNode = node
      endOffset = end - total
      break
    }
    total += length
  }

  if (!startNode || !endNode) return null
  return { startNode, startOffset, endNode, endOffset }
}

function highlightByOffsets(root: HTMLElement, annotation: Annotation): boolean {
  const range = findOffsetRange(root, annotation.start, annotation.end)
  if (!range) return false
  const nodes = collectTextNodes(root)
  const startIndex = nodes.indexOf(range.startNode)
  const endIndex = nodes.indexOf(range.endNode)
  if (startIndex < 0 || endIndex < 0) return false

  const targets = nodes.slice(startIndex, endIndex + 1).map((node, index) => {
    const length = node.nodeValue?.length ?? 0
    return {
      node,
      start: index === 0 ? range.startOffset : 0,
      end: index === endIndex - startIndex ? range.endOffset : length,
    }
  })

  for (const target of targets.reverse()) {
    if (target.node.parentElement?.closest('mark.annotation-highlight')) continue
    wrapTextNode(target.node, target.start, target.end, annotation.id)
  }
  return true
}

function highlightByText(root: HTMLElement, annotation: Annotation): boolean {
  const text = annotation.text.trim()
  if (!text) return false
  const nodes = collectTextNodes(root)

  for (const node of nodes) {
    const content = node.nodeValue ?? ''
    const index = content.indexOf(text)
    if (index >= 0) {
      wrapTextNode(node, index, index + text.length, annotation.id)
      return true
    }
  }

  // 跨节点或含公式的选区：退化为高亮开头一小段，仍提供可点击入口。
  const probe = text.slice(0, Math.min(6, text.length))
  for (const node of nodes) {
    const content = node.nodeValue ?? ''
    const index = content.indexOf(probe)
    if (index >= 0) {
      wrapTextNode(node, index, index + probe.length, annotation.id)
      return true
    }
  }
  return false
}

export function applyAnnotationHighlights(root: HTMLElement, annotations: Annotation[]): void {
  clearHighlights(root)
  const sorted = [...annotations].sort((a, b) => a.start - b.start)
  for (const annotation of sorted) {
    if (!annotation.text) continue
    if (!highlightByOffsets(root, annotation)) highlightByText(root, annotation)
  }
}

export function getAnnotationIdFromEvent(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target : null
  const mark = element?.closest<HTMLElement>('mark.annotation-highlight')
  return mark?.dataset.annotationId ?? null
}
