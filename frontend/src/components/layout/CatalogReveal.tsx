import { useEffect, useRef, useState } from 'react'

interface CatalogRevealProps {
  onOpen: () => void
}

/**
 * 目录折叠后完全隐藏。只在视口最左侧 12px 悬停约 100ms 后，
 * 才显示“打开目录”按钮，避免留下难看的窄条。
 */
export function CatalogReveal({ onOpen }: CatalogRevealProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const show = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(true), 100)
  }

  const hide = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  return (
    <div className="catalog-reveal-zone" onMouseEnter={show} onMouseLeave={hide}>
      {visible ? (
        <button
          type="button"
          className="catalog-reveal-btn"
          onMouseEnter={show}
          onClick={() => {
            hide()
            onOpen()
          }}
          aria-label="打开课程目录"
        >
          <span aria-hidden>»</span>
          打开目录
        </button>
      ) : null}
    </div>
  )
}
