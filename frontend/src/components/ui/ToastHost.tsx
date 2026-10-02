import { useAppStore } from '../../store/appStore'

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts)
  const dismissToast = useAppStore((state) => state.dismissToast)
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role="status">
          <span className="toast-msg">{toast.message}</span>
          <button type="button" className="icon-btn" aria-label="关闭提示" onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
