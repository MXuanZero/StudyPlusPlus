interface CatalogRevealProps {
  onOpen: () => void
}

/**
 * 目录折叠后的竖向窄条。
 *
 * 固定贴在视口左侧、灰色半透明，文字“打开目录”竖排；
 * 点击后展开完整目录。相比浮动按钮，位置更稳定、点击区域更清晰。
 */
export function CatalogReveal({ onOpen }: CatalogRevealProps) {
  return (
    <button
      type="button"
      className="catalog-reveal-bar"
      onClick={onOpen}
      aria-label="打开课程目录"
      title="打开课程目录"
    >
      <span className="catalog-reveal-text">打开目录</span>
    </button>
  )
}
