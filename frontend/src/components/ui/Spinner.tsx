export function Spinner() {
  return <span className="spinner" role="status" aria-label="加载中" />
}

export function CenteredSpinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="centered-spinner">
      <Spinner />
      <p className="muted small" style={{ marginTop: 10 }}>
        {label}
      </p>
    </div>
  )
}
