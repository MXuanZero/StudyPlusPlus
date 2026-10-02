import { Link, Route, Routes } from 'react-router-dom'

function HomePlaceholder() {
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '48px 32px' }}>
      <h1 style={{ marginBottom: 8 }}>StudyPlusPlus</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        控制理论可视化学习平台 · 工程骨架已就绪
      </p>
      <p>
        <Link to="/settings">前往设置</Link>
      </p>
    </main>
  )
}

function SettingsPlaceholder() {
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '48px 32px' }}>
      <h1>设置</h1>
      <p style={{ color: '#6b7280' }}>LLM 设置将在 T8 实现。</p>
      <Link to="/">返回首页</Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePlaceholder />} />
      <Route path="/settings" element={<SettingsPlaceholder />} />
    </Routes>
  )
}
