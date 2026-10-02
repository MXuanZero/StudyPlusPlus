import { useMemo } from 'react'
import { Plot } from './Plot'
import type { Pole } from '../../api/types'

export interface PoleSeries {
  id: string
  name: string
  color: string
  poles: Pole[]
}

interface PoleZeroMapProps {
  series: PoleSeries[]
  height?: number
}

function poleLabel(pole: Pole): string {
  const sign = pole.imag >= 0 ? '+' : '−'
  return `s = ${pole.real.toFixed(3)} ${sign} j${Math.abs(pole.imag).toFixed(3)}`
}

export function PoleZeroMap({ series, height = 300 }: PoleZeroMapProps) {
  const data = useMemo(() => {
    const traces: Record<string, unknown>[] = []
    for (const item of series) {
      traces.push({
        x: item.poles.map((pole) => pole.real),
        y: item.poles.map((pole) => pole.imag),
        type: 'scatter',
        mode: 'markers',
        name: item.name,
        marker: { color: item.color, size: 11, symbol: 'x', line: { width: 2 } },
        text: item.poles.map(poleLabel),
        hovertemplate: '%{text}<extra>' + item.name + '</extra>',
        showlegend: series.length > 1,
      })
      if (item.poles.length === 2 && Math.abs(item.poles[0].imag) > 1e-9) {
        traces.push({
          x: [item.poles[0].real, item.poles[1].real],
          y: [item.poles[0].imag, item.poles[1].imag],
          type: 'scatter',
          mode: 'lines',
          line: { color: item.color, width: 1, dash: 'dot' },
          opacity: 0.5,
          showlegend: false,
          hoverinfo: 'skip',
        })
      }
    }
    return traces
  }, [series])

  const layout = useMemo(() => {
    const allPoles = series.flatMap((item) => item.poles)
    const maxReal = Math.max(1, ...allPoles.map((pole) => Math.abs(pole.real))) * 1.45
    const maxImag = Math.max(1, ...allPoles.map((pole) => Math.abs(pole.imag))) * 1.45
    return {
      xaxis: {
        title: { text: '实轴 Real (1/s)', font: { size: 12.5 } },
        range: [-maxReal, maxReal],
        zeroline: true,
        zerolinewidth: 1.4,
        zerolinecolor: '#6b7280',
      },
      yaxis: {
        title: { text: '虚轴 Imag (1/s)', font: { size: 12.5 } },
        range: [-maxImag, maxImag],
        zeroline: true,
        zerolinewidth: 1.4,
        zerolinecolor: '#6b7280',
      },
      shapes: [
        {
          type: 'rect',
          x0: -maxReal,
          x1: 0,
          y0: -maxImag,
          y1: maxImag,
          fillcolor: '#ecfdf5',
          opacity: 0.65,
          line: { width: 0 },
          layer: 'below',
        },
        {
          type: 'rect',
          x0: 0,
          x1: maxReal,
          y0: -maxImag,
          y1: maxImag,
          fillcolor: '#fef2f2',
          opacity: 0.7,
          line: { width: 0 },
          layer: 'below',
        },
      ],
      annotations: [
        {
          x: -maxReal * 0.5,
          y: maxImag * 0.82,
          text: '左半平面：稳定',
          showarrow: false,
          font: { size: 11, color: '#047857' },
        },
        {
          x: maxReal * 0.5,
          y: maxImag * 0.82,
          text: '右半平面：不稳定',
          showarrow: false,
          font: { size: 11, color: '#b91c1c' },
        },
      ],
      margin: { l: 52, r: 18, t: 26, b: 44 },
      legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 12 } },
    }
  }, [series])

  return <Plot data={data} layout={layout} height={height} ariaLabel="极点零极点图" />
}
