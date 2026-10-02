import { makeId } from './format'

export interface Annotation {
  id: string
  topic_id: string
  chapter_id: string
  text: string
  start: number
  end: number
  session_id?: string | null
  created_at: number
  updated_at: number
}

const STORAGE_KEY = 'spp.annotations.v1'

type AnnotationStore = Record<string, Annotation[]>

function readStore(): AnnotationStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as AnnotationStore) : {}
  } catch {
    return {}
  }
}

function writeStore(store: AnnotationStore): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
  window.dispatchEvent(new CustomEvent('spp:annotations-changed'))
}

function topicKey(annotation: Pick<Annotation, 'topic_id' | 'chapter_id'>): string {
  return annotation.topic_id || annotation.chapter_id || 'unknown'
}

export function listAnnotations(topicId: string): Annotation[] {
  if (!topicId) return []
  const items = readStore()[topicId] ?? []
  return [...items].sort((a, b) => a.start - b.start || a.created_at - b.created_at)
}

export function addAnnotation(
  input: Omit<Annotation, 'id' | 'created_at' | 'updated_at' | 'session_id'> & {
    id?: string
    session_id?: string | null
  },
): Annotation {
  const now = Date.now()
  const annotation: Annotation = {
    ...input,
    id: input.id || makeId('anno'),
    session_id: input.session_id ?? null,
    created_at: now,
    updated_at: now,
  }
  const store = readStore()
  const key = topicKey(annotation)
  store[key] = [...(store[key] ?? []), annotation]
  writeStore(store)
  return annotation
}

export function attachSessionToAnnotations(annotationIds: string[], sessionId: string): void {
  if (!annotationIds.length || !sessionId) return
  const wanted = new Set(annotationIds)
  const store = readStore()
  let changed = false
  for (const key of Object.keys(store)) {
    store[key] = store[key].map((annotation) => {
      if (!wanted.has(annotation.id) || annotation.session_id === sessionId) return annotation
      changed = true
      return { ...annotation, session_id: sessionId, updated_at: Date.now() }
    })
  }
  if (changed) writeStore(store)
}

export function removeAnnotation(annotationId: string): void {
  if (!annotationId) return
  const store = readStore()
  let changed = false
  for (const key of Object.keys(store)) {
    const next = store[key].filter((annotation) => annotation.id !== annotationId)
    if (next.length !== store[key].length) {
      changed = true
      if (next.length) store[key] = next
      else delete store[key]
    }
  }
  if (changed) writeStore(store)
}

export function removeAnnotationsBySession(sessionId: string): void {
  if (!sessionId) return
  const store = readStore()
  let changed = false
  for (const key of Object.keys(store)) {
    const next = store[key].filter((annotation) => annotation.session_id !== sessionId)
    if (next.length !== store[key].length) {
      changed = true
      if (next.length) store[key] = next
      else delete store[key]
    }
  }
  if (changed) writeStore(store)
}
