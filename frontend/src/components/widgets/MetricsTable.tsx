import type { InputType, Metrics } from '../../api/types'
import { formatMetric } from '../../utils/format'

interface MetricsTableProps {
  metrics: Metrics | null | undefined
  analytical?: Partial<Metrics> | null
  classification: string
  inputType: InputType
}

interface Row {
  key: keyof Metrics
  label: string
  symbol: string
  formula: string
  digits?: number
}

const ROWS: Row[] = [
  { key: 'rise_time_10_90', label: '上升时间（10%→90%）', symbol: 't_r', formula: '首次穿越 10% / 90% 稳态值' },
  { key: 'rise_time_0_100', label: '上升时间（0→100%）', symbol: 't_r', formula: '首次穿越 0 / 100% 稳态值' },
  { key: 'peak_time', label: '峰值时间', symbol: 't_p', formula: 'π / ω_d' },
  { key: 'peak_value', label: '峰值', symbol: 'y_max', formula: '响应全局最大值' },
  { key: 'overshoot_pct', label: '最大超调量', symbol: 'M_p', formula: 'e^(−πζ/√(1−ζ²)) × 100%' },
  { key: 'settling_time_2pct', label: '调节时间（±2%）', symbol: 't_s(2%)', formula: '≈ 4 / (ζω_n)' },
  { key: 'settling_time_5pct', label: '调节时间（±5%）', symbol: 't_s(5%)', formula: '≈ 3 / (ζω_n)' },
  { key: 'steady_state_value', label: '稳态值', symbol: 'y_ss', formula: '时间末端输出 y(t_end)' },
]

const UNITS: Partial<Record<keyof Metrics, string>> = {
  rise_time_10_90: 's',
  rise_time_0_100: 's',
  peak_time: 's',
  overshoot_pct: '%',
  settling_time_2pct: 's',
  settling_time_5pct: 's',
}

export function MetricsTable({ metrics, analytical, classification, inputType }: MetricsTableProps) {
  if (inputType !== 'step') {
    return (
      <div className="card card-pad intuition-strip">
        性能指标按“单位阶跃响应”定义。当前为{inputType === 'impulse' ? '单位冲激' : '初始状态'}模式，切换回单位阶跃即可查看指标。
      </div>
    )
  }
  if (classification === 'unstable' || !metrics) {
    return (
      <div className="card card-pad">
        <strong style={{ color: 'var(--danger)' }}>性能指标不适用</strong>
        <p className="intuition-strip" style={{ margin: '6px 0 0' }}>
          系统不稳定或响应发散时，超调量、调节时间等指标没有工程意义。请把 ζ 调回 0 以上观察稳定系统。
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="metrics-table">
        <thead>
          <tr>
            <th style={{ width: '30%' }}>指标</th>
            <th style={{ width: '20%' }}>数值计算</th>
            <th style={{ width: '20%' }}>近似公式</th>
            <th>说明 / 公式</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const numerical = metrics[row.key]
            const approx = analytical?.[row.key]
            const same = row.key === 'rise_time_10_90' || row.key === 'rise_time_0_100' || row.key === 'peak_value' || row.key === 'steady_state_value'
            const unit = UNITS[row.key] ?? ''
            return (
              <tr key={row.key}>
                <td>
                  {row.label} <span className="muted mono">{row.symbol}</span>
                </td>
                <td className="num">{formatMetric(numerical, row.digits ?? 3, unit)}</td>
                <td className="num">{same ? <span className="na">—</span> : formatMetric(approx, 3, unit)}</td>
                <td className="formula">{row.formula}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="intuition-strip" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border)' }}>
        近似公式只对欠阻尼稳定系统成立；数值计算由后端 scipy 仿真得到，表格中的差异正是近似带来的误差。
      </p>
    </div>
  )
}
