import { useMemo } from 'react'
import { Plot } from './Plot'
import type { InputType, Metrics } from '../../api/types'
import { formatMetric } from '../../utils/format'

export interface ResponseSeries {
  id: string
  name: string
  color: string
  t: number[]
  y: number[]
  u?: number[]
}

interface TimeResponsePlotProps {
  series: ResponseSeries[]
  inputType: InputType
  metrics?: Metrics | null
  showMetricAnnotations?: boolean
  height?: number
  steadyState?: number | null
}

export function TimeResponsePlot({
  series,
  inputType,
  metrics,
  showMetricAnnotations = false,
  height = 340,
  steadyState,
}: TimeResponsePlotProps) {
  const data = useMemo(() => {
    const traces: Record<string, unknown>[] = []
    const first = series[0]
    if (inputType === 'step' && first?.u?.length) {
      traces.push({
        x: first.t,
        y: first.u,
        type: 'scatter',
        mode: 'lines',
        name: '输入 u(t)',
        line: { color: '#9ca3af', width: 1.5, dash: 'dot' },
        hovertemplate: 't=%{x:.3f}s<br>u=%{y:.3f}<extra>输入</extra>',
      })
    }
    for (const item of series) {
      traces.push({
        x: item.t,
        y: item.y,
        type: 'scatter',
        mode: 'lines',
        name: item.name,
        line: { color: item.color, width: 2.4 },
        hovertemplate: 't=%{x:.3f}s<br>y=%{y:.4f}<extra>' + item.name + '</extra>',
      })
    }
    return traces
  }, [series, inputType])

  const layout = useMemo(() => {
    const shapes: Record<string, unknown>[] = []
    const annotations: Record<string, unknown>[] = []
    const steady = steadyState ?? metrics?.steady_state_value ?? null
    if (steady !== null && steady !== undefined && inputType === 'step') {
      shapes.push({
        type: 'line',
        xref: 'paper',
        x0: 0,
        x1: 1,
        y0: steady,
        y1: steady,
        line: { color: '#a5b4fc', width: 1.2, dash: 'dash' },
        layer: 'below',
      })
      annotations.push({
        xref: 'paper',
        x: 1,
        xanchor: 'right',
        y: steady,
        yanchor: 'bottom',
        text: `稳态 ${formatMetric(steady, 3)}`,
        showarrow: false,
        font: { size: 11, color: '#6366f1' },
      })
    }
    if (showMetricAnnotations && metrics && inputType === 'step') {
      const marks: { time: number | null | undefined; label: string; color: string }[] = [
        { time: metrics.peak_time, label: `tp=${formatMetric(metrics.peak_time, 3)}s`, color: '#f59e0b' },
        { time: metrics.settling_time_2pct, label: `ts(2%)=${formatMetric(metrics.settling_time_2pct, 3)}s`, color: '#10b981' },
      ]
      for (const mark of marks) {
        if (mark.time === null || mark.time === undefined || !Number.isFinite(mark.time)) continue
        shapes.push({
          type: 'line',
          x0: mark.time,
          x1: mark.time,
          yref: 'paper',
          y0: 0,
          y1: 1,
          line: { color: mark.color, width: 1.2, dash: 'dot' },
          layer: 'below',
        })
        annotations.push({
          x: mark.time,
          yref: 'paper',
          y: 1,
          yanchor: 'bottom',
          text: mark.label,
          showarrow: false,
          font: { size: 11, color: mark.color },
        })
      }
    }
    return {
      xaxis: { title: { text: '时间 t (s)', font: { size: 12.5 } } },
      yaxis: { title: { text: '输出 y(t)', font: { size: 12.5 } } },
      shapes,
      annotations,
      legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 12 } },
      margin: { l: 58, r: 20, t: 34, b: 44 },
    }
  }, [metrics, showMetricAnnotations, inputType, steadyState])

  return <Plot data={data} layout={layout} height={height} ariaLabel="时域响应曲线" />
}
