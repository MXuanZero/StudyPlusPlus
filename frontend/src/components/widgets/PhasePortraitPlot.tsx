import { useMemo } from 'react'
import { Plot } from './Plot'
import type { ResponseSeries } from './TimeResponsePlot'

interface PhasePortraitPlotProps {
  series: ResponseSeries[]
  height?: number
}

/** 相轨迹的纵轴由 y(t) 的中心差分近似，仅用于可视化，不参与任何求解。 */
function derivative(t: number[], y: number[]): number[] {
  return y.map((_, index) => {
    if (index === 0) return (y[1] - y[0]) / Math.max(t[1] - t[0], 1e-9)
    if (index === y.length - 1) return (y[index] - y[index - 1]) / Math.max(t[index] - t[index - 1], 1e-9)
    return (y[index + 1] - y[index - 1]) / Math.max(t[index + 1] - t[index - 1], 1e-9)
  })
}

export function PhasePortraitPlot({ series, height = 300 }: PhasePortraitPlotProps) {
  const data = useMemo(() => {
    const traces: Record<string, unknown>[] = []
    for (const item of series) {
      if (item.y.length < 3) continue
      const velocity = derivative(item.t, item.y)
      traces.push({
        x: item.y,
        y: velocity,
        type: 'scatter',
        mode: 'lines',
        name: item.name,
        line: { color: item.color, width: 2.2 },
        hovertemplate: 'y=%{x:.4f}<br>ẏ=%{y:.4f}<extra>' + item.name + '</extra>',
      })
      traces.push({
        x: [item.y[0]],
        y: [velocity[0]],
        type: 'scatter',
        mode: 'markers',
        name: `${item.name} 起点`,
        marker: { color: item.color, size: 11, symbol: 'circle', line: { color: '#fff', width: 1.5 } },
        showlegend: false,
        hovertemplate: '起点<br>y=%{x:.4f}<br>ẏ=%{y:.4f}<extra></extra>',
      })
      traces.push({
        x: [item.y[item.y.length - 1]],
        y: [velocity[velocity.length - 1]],
        type: 'scatter',
        mode: 'markers',
        name: `${item.name} 终点`,
        marker: { color: item.color, size: 9, symbol: 'square', opacity: 0.7 },
        showlegend: false,
        hovertemplate: '终点<br>y=%{x:.4f}<br>ẏ=%{y:.4f}<extra></extra>',
      })
    }
    return traces
  }, [series])

  const layout = useMemo(
    () => ({
      xaxis: { title: { text: '位置 y', font: { size: 12.5 } }, zeroline: true, zerolinecolor: '#9ca3af' },
      yaxis: { title: { text: '速度 ẏ', font: { size: 12.5 } }, zeroline: true, zerolinecolor: '#9ca3af' },
      margin: { l: 56, r: 18, t: 26, b: 44 },
      legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 12 } },
    }),
    [],
  )

  return <Plot data={data} layout={layout} height={height} ariaLabel="相轨迹图" />
}
