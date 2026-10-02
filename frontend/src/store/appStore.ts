import { create } from 'zustand'
import type { ApiSource } from '../api/types'

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface AppState {
  /** 'mock' 表示前端在开发期回退到了本地固定数据，用于顶部提示。 */
  dataSource: ApiSource
  setDataSource: (source: ApiSource) => void
  toasts: ToastItem[]
  pushToast: (message: string, kind?: ToastItem['kind']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useAppStore = create<AppState>((set) => ({
  dataSource: 'api',
  setDataSource: (dataSource) => set({ dataSource }),
  toasts: [],
  pushToast: (message, kind = 'info') => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    }, 4200)
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
