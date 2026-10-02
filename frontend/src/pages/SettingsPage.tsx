import { Link } from 'react-router-dom'

export function SettingsPage() {
  return (
    <div className="settings-page">
      <h1>设置</h1>
      <p className="muted">这里将提供模型供应商、Base URL、模型名、API Key 等配置（T8）。</p>

      <div className="card settings-card">
        <h2>大模型配置</h2>
        <div className="placeholder-note">
          设置页由 T8 实现。当前全局 AI 助手在未配置 Key 时会自动进入 Mock 模式，
          课程阅读与二阶实验室不受影响。
        </div>
      </div>

      <div className="card settings-card">
        <h2>关于本页</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          设置接口契约已按 docs/02 与后端 T6/T8 对齐：GET/PUT
          <span className="mono"> /api/v1/settings/llm</span>、测试连接与恢复默认。T8 完成后本页会替换为完整表单。
        </p>
      </div>

      <Link className="btn" to="/">
        返回首页
      </Link>
    </div>
  )
}
