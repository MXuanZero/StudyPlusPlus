import { Outlet } from 'react-router-dom'
import { QuoteSelectionHandler } from '../chat/QuoteSelectionHandler'

/** 无顶栏布局：页面内容 + 全局引用选择器。 */
export function AppLayout() {
  return (
    <div className="app-shell">
      <main className="page-main">
        <Outlet />
      </main>
      <QuoteSelectionHandler />
    </div>
  )
}
