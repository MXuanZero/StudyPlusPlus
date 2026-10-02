import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="state-block">
      <h2>页面不存在</h2>
      <p>你访问的地址没有对应内容。</p>
      <div className="state-actions">
        <Link className="btn btn-primary" to="/">
          返回首页
        </Link>
      </div>
    </div>
  )
}
