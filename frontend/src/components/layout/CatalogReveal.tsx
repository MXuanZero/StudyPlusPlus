import { useEffect, useRef, useState } from 'react'

interface CatalogRevealProps {
  onOpen: () => void
}

/**
 * 目录折叠后的左侧竖向滑条。
 *
 * 默认隐藏；鼠标移到视口最左侧时滑出。滑条占满全屏高度，
 * “打开目录”四个字竖排，点击后展开完整目录。
 */
export function CatalogReveal({ onOpen }: CatalogRevealProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const show = () => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setVisible(true), 80)
  }

  const hide = () => {
    clearTimer()
    // 留一点缓冲时间，方便鼠标从感应区移动到滑条上。
    timerRef.current = window.setTimeout(() => setVisible(false), 140)
  }

  return (
    <>
      <div
        className="catalog-reveal-zone"
        onMouseEnter={show}
        onMouseLeave={hide}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`catalog-reveal-bar ${visible ? 'visible' : ''}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={onOpen}
        aria-label="打开课程目录"
        title="打开课程目录"
        tabIndex={visible ? 0 : -1}
      >
        <span className="catalog-reveal-text">打开目录</span>
      </button>
    </>
  )
}
