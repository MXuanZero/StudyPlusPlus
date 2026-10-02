import { useEffect, useMemo, useState } from 'react'
import { simulateSecondOrder } from '../../api/compute'
import type { SimulationResponse } from '../../api/types'
import { Slider } from '../ui/Slider'
import { PoleZeroMap } from './PoleZeroMap'
import { Spinner } from '../ui/Spinner'
import { useDebouncedValue } from '../../utils/useDebounced'
import { formatNumber } from '../../utils/format'

const CLASSIFICATION_LABEL: Record<string, string> = {
  undamped: '无阻尼',
  underdamped: '欠阻尼',
  critically_damped: '临界阻尼',
  overdamped: '过阻尼',
  unstable: '不稳定',
}

/** 简化版：只展示标准式系数与极点随 ζ、ωn 的变化。 */
export function SecondOrderStandardForm() {
  const [zeta, setZeta] = useState(0.5)
  const [omegaN, setOmegaN] = useState(2)
  const [data, setData] = useState<SimulationResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payload = useMemo(
    () => ({ zeta, omega_n: omegaN, input_type: 'step' as const, y0: 0, v0: 0, t_end: 20, n_points: 501, include_metrics: false }),
    [zeta, omegaN],
  )
  const debounced = useDebouncedValue(payload, 150)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    simulateSecondOrder(debounced, controller.signal)
      .then((result) => setData(result))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '计算失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [debounced])

  const poleSeries = useMemo(
    () => (data ? [{ id: 'main', name: '极点', color: '#4f46e5', poles: data.poles }] : []),
    [data],
  )

  return (
    <div className="lab">
      <div className="lab-head">
        <h3>标准二阶系统</h3>
        <span className="lab-sub">拖动参数，观察极点如何移动</span>
        <span className="spacer" />
        {data ? <span className="badge badge-accent">{CLASSIFICATION_LABEL[data.classification] ?? data.classification}</span> : null}
      </div>
      <div className="lab-body" style={{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
        <div className="lab-controls">
          <Slider label="阻尼比 ζ" value={zeta} min={-0.5} max={3} step={0.01} onChange={setZeta} format={(v) => v.toFixed(2)} />
          <Slider label="自然频率 ωn" value={omegaN} min={0.2} max={10} step={0.1} onChange={setOmegaN} format={(v) => v.toFixed(1)} hint="rad/s" />
          <div className="card card-pad" style={{ padding: '12px 14px', background: 'var(--panel-soft)' }}>
            <div className="small faint" style={{ marginBottom: 4 }}>标准形式</div>
            <div className="mono" style={{ fontSize: 13.5, lineHeight: 1.8 }}>
              G(s) = ωn² / (s² + 2ζωn·s + ωn²)
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              2ζωn = {formatNumber(2 * zeta * omegaN, 3)} · ωn² = {formatNumber(omegaN * omegaN, 3)}
            </div>
          </div>
        </div>
        <div className="lab-main">
          <div className="lab-chart-card">
            <div className="chart-title">
              极点图
              <span className="hint">× 表示极点位置</span>
            </div>
            <PoleZeroMap series={poleSeries} height={300} />
            {loading ? (
              <div className="loading-mask">
                <Spinner />
              </div>
            ) : null}
          </div>
          {error ? <div className="diagnostic-item error">计算失败：{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
