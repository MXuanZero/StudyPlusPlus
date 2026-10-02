/** Formatting helpers shared by plots and tables. */

export function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.?0+$/, '')
}

export function formatMetric(value: number | null | undefined, digits = 3, unit = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  const text = abs !== 0 && (abs >= 1e5 || abs < 1e-3)
    ? value.toExponential(2)
    : value.toFixed(digits).replace(/\.?0+$/, '')
  return unit ? `${text} ${unit}` : text
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Stable id without external dependency. */
export function makeId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
