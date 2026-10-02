import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'

interface PlotProps {
  data: unknown[]
  layout?: Record<string, unknown>
  height?: number
  className?: string
  ariaLabel?: string
}

const BASE_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor: '#ffffff',
  font: {
    family:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    size: 12,
    color: '#374151',
  },
  margin: { l: 56, r: 18, t: 22, b: 44 },
  hovermode: 'x unified',
  showlegend: true,
  legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 12 } },
  xaxis: {
    gridcolor: '#eef2f7',
    zerolinecolor: '#d1d5db',
    linecolor: '#d1d5db',
    ticks: 'outside',
    tickcolor: '#d1d5db',
  },
  yaxis: {
    gridcolor: '#eef2f7',
    zerolinecolor: '#d1d5db',
    linecolor: '#d1d5db',
    ticks: 'outside',
    tickcolor: '#d1d5db',
  },
}

const BASE_CONFIG: Record<string, unknown> = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displayModeBar: true,
}

/** Thin Plotly wrapper: white background, no logo, responsive re-render. */
export function Plot({ data, layout, height = 320, className = '', ariaLabel }: PlotProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const merged = {
      ...BASE_LAYOUT,
      ...layout,
      xaxis: { ...(BASE_LAYOUT.xaxis as object), ...((layout?.xaxis as object) ?? {}) },
      yaxis: { ...(BASE_LAYOUT.yaxis as object), ...((layout?.yaxis as object) ?? {}) },
      margin: { ...(BASE_LAYOUT.margin as object), ...((layout?.margin as object) ?? {}) },
    }
    void Plotly.react(host, data, merged, BASE_CONFIG)
  }, [data, layout])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 分屏拖拽、目录折叠不会改变窗口尺寸，直接观察图表容器。
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.clientWidth && host.clientHeight) void Plotly.Plots.resize(host)
      })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      Plotly.purge(host)
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={`plot-host ${className}`}
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? '交互式图表'}
    />
  )
}
