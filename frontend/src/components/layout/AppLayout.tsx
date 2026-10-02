import { NavLink, Outlet } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'

export function AppLayout() {
  const dataSource = useAppStore((state) => state.dataSource)
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark">S+</span>
            StudyPlusPlus
          </NavLink>
          <nav className="topnav">
            <NavLink to="/" end>
              首页
            </NavLink>
            <NavLink to="/learn/ch05">二阶系统</NavLink>
            <NavLink to="/settings">设置</NavLink>
            {dataSource === 'mock' ? <span className="source-badge">开发 Mock 数据</span> : null}
          </nav>
        </div>
      </header>
      <main className="page-main">
        <Outlet />
      </main>
    </div>
  )
}
