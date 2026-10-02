/** Topic notes CRUD endpoints (T9). */
import { apiDelete, apiGet, apiPost, apiPut } from './client'

export interface Note {
  id: number
  topic_id: string
  content: string
  created_at: string
  updated_at: string
}

export async function listNotes(topicId: string): Promise<Note[]> {
  const data = await apiGet<{ items: Note[] }>(`/notes?topic_id=${encodeURIComponent(topicId)}`)
  return data.items ?? []
}

export function createNote(topicId: string, content: string): Promise<Note> {
  return apiPost<Note>('/notes', { topic_id: topicId, content })
}

export function updateNote(noteId: number, content: string): Promise<Note> {
  return apiPut<Note>(`/notes/${noteId}`, { content })
}

export function deleteNote(noteId: number): Promise<void> {
  return apiDelete<void>(`/notes/${noteId}`)
}
