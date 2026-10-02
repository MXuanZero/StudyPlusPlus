/**
 * DEV-ONLY fallback for POST /api/v1/compute/second-order/*.
 *
 * 重要：正式运行时所有仿真必须由后端 scipy/numpy 计算。
 * 这个文件只在开发期后端 T3 尚未就绪（404/网络错误）时兜底，
 * 且仅通过 import.meta.env.DEV 分支动态加载，不会进入生产构建主逻辑。
 */
import type {
  Metrics,
  Pole,
  Preset,
  SimulationRequest,
  SimulationResponse,
} from '../api/types'

const EPS = 1e-9

function linspace(start: number, end: number, count: number): number[] {
  if (count <= 1) return [start]
  const step = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, index) => start + step * index)
}

function classify(zeta: number): string {
  if (zeta < -EPS) return 'unstable'
  if (Math.abs(zeta) <= EPS) return 'undamped'
  if (zeta < 1 - EPS) return 'underdamped'
  if (Math.abs(zeta - 1) <= EPS) return 'critically_damped'
  return 'overdamped'
}

function polesFor(zeta: number, omegaN: number): Pole[] {
  const discriminant = zeta * zeta - 1
  if (Math.abs(discriminant) <= EPS) return [{ real: -zeta * omegaN, imag: 0 }]
  if (discriminant < 0) {
    const imag = omegaN * Math.sqrt(-discriminant)
    return [
      { real: -zeta * omegaN, imag },
      { real: -zeta * omegaN, imag: -imag },
    ]
  }
  const root = omegaN * Math.sqrt(discriminant)
  return [
    { real: -zeta * omegaN + root, imag: 0 },
    { real: -zeta * omegaN - root, imag: 0 },
  ]
}

function stepResponse(t: number[], zeta: number, omegaN: number): number[] {
  const type = classify(zeta)
  const wn = omegaN
  if (type === 'undamped') return t.map((time) => 1 - Math.cos(wn * time))
  if (type === 'critically_damped') {
    return t.map((time) => 1 - (1 + wn * time) * Math.exp(-wn * time))
  }
  if (type === 'overdamped') {
    const lambda = wn * Math.sqrt(zeta * zeta - 1)
    return t.map(
      (time) =>
        1 -
        Math.exp(-zeta * wn * time) *
          (Math.cosh(lambda * time) + (zeta / Math.sqrt(zeta * zeta - 1)) * Math.sinh(lambda * time)),
    )
  }
  // underdamped 公式对 ζ<0 同样成立，可表现不稳定发散
  const wd = wn * Math.sqrt(1 - zeta * zeta)
  const phi = Math.acos(zeta)
  return t.map(
    (time) =>
      1 -
      (Math.exp(-zeta * wn * time) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * time + phi),
  )
}

function impulseResponse(t: number[], zeta: number, omegaN: number): number[] {
  const type = classify(zeta)
  const wn = omegaN
  if (type === 'critically_damped') {
    return t.map((time) => wn * wn * time * Math.exp(-wn * time))
  }
  if (type === 'overdamped') {
    const root = wn * Math.sqrt(zeta * zeta - 1)
    const s1 = -zeta * wn + root
    const s2 = -zeta * wn - root
    return t.map((time) => (wn * wn * (Math.exp(s1 * time) - Math.exp(s2 * time))) / (s1 - s2))
  }
  const wd = wn * Math.sqrt(Math.max(1 - zeta * zeta, 0))
  if (wd < EPS) return t.map(() => 0)
  return t.map((time) => (wn / wd) * Math.exp(-zeta * wn * time) * Math.sin(wd * time))
}

function initialResponse(t: number[], zeta: number, omegaN: number, y0: number, v0: number): number[] {
  const type = classify(zeta)
  const wn = omegaN
  if (type === 'critically_damped') {
    return t.map((time) => Math.exp(-wn * time) * (y0 + (v0 + wn * y0) * time))
  }
  if (type === 'overdamped') {
    const root = wn * Math.sqrt(zeta * zeta - 1)
    const s1 = -zeta * wn + root
    const s2 = -zeta * wn - root
    const c1 = (v0 - s2 * y0) / (s1 - s2)
    const c2 = y0 - c1
    return t.map((time) => c1 * Math.exp(s1 * time) + c2 * Math.exp(s2 * time))
  }
  const wd = wn * Math.sqrt(Math.max(1 - zeta * zeta, 0))
  if (wd < EPS) return t.map(() => y0)
  return t.map(
    (time) =>
      Math.exp(-zeta * wn * time) *
      (y0 * Math.cos(wd * time) + ((v0 + zeta * wn * y0) / wd) * Math.sin(wd * time)),
  )
}

function interpolateCrossing(t: number[], y: number[], threshold: number): number | null {
  for (let i = 1; i < y.length; i += 1) {
    const a = y[i - 1]
    const b = y[i]
    if ((a - threshold) * (b - threshold) <= 0 && a !== b) {
      const ratio = (threshold - a) / (b - a)
      return t[i - 1] + ratio * (t[i] - t[i - 1])
    }
  }
  return null
}

function stepMetrics(t: number[], y: number[], zeta: number, omegaN: number): Metrics {
  const steady = y[y.length - 1]
  const y10 = 0.1 * steady
  const y90 = 0.9 * steady
  const t10 = interpolateCrossing(t, y, y10)
  const t90 = interpolateCrossing(t, y, y90)
  const t0 = interpolateCrossing(t, y, 0)

  let peakIndex = 0
  for (let i = 1; i < y.length; i += 1) if (y[i] > y[peakIndex]) peakIndex = i
  const peakValue = y[peakIndex]
  const peakTime = t[peakIndex]
  const overshoot = Math.abs(steady) > 1e-9 ? ((peakValue - steady) / Math.abs(steady)) * 100 : null

  const settleWithin = (tolerance: number): number | null => {
    const scale = Math.max(Math.abs(steady), 1e-9)
    const limit = steady === 0 ? tolerance : tolerance * scale
    for (let i = y.length - 1; i >= 0; i -= 1) {
      if (Math.abs(y[i] - steady) > limit) return i + 1 < t.length ? t[i + 1] : null
    }
    return t[0]
  }

  return {
    rise_time_10_90: t10 !== null && t90 !== null ? t90 - t10 : null,
    rise_time_0_100: t0 !== null && t90 !== null ? t90 - t0 : null,
    peak_time: overshoot !== null && overshoot > 1e-6 ? peakTime : null,
    peak_value: peakValue,
    overshoot_pct: overshoot,
    settling_time_2pct: settleWithin(0.02),
    settling_time_5pct: settleWithin(0.05),
    steady_state_value: steady,
  }
}

function analyticalMetrics(zeta: number, omegaN: number): Partial<Metrics> | null {
  if (!(zeta > 0 && zeta < 1)) return null
  const wd = omegaN * Math.sqrt(1 - zeta * zeta)
  return {
    peak_time: Math.PI / wd,
    overshoot_pct: Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100,
    settling_time_2pct: 4 / (zeta * omegaN),
    settling_time_5pct: 3 / (zeta * omegaN),
  }
}

export function generateMockSimulation(request: SimulationRequest): SimulationResponse {
  const zeta = request.zeta
  const omegaN = request.omega_n
  const nPoints = Math.min(5000, Math.max(200, Math.round(request.n_points || 1001)))
  const t = linspace(0, request.t_end, nPoints)
  const classification = classify(zeta)

  let y: number[]
  if (request.input_type === 'impulse') y = impulseResponse(t, zeta, omegaN)
  else if (request.input_type === 'initial') y = initialResponse(t, zeta, omegaN, request.y0, request.v0)
  else y = stepResponse(t, zeta, omegaN)
  const u = t.map(() => (request.input_type === 'step' ? 1 : 0))

  const diagnostics: string[] = []
  let metrics: Metrics | null = null
  let analytical: Partial<Metrics> | null = null

  if (classification === 'unstable') {
    diagnostics.push('系统不稳定，响应将发散；性能指标不适用')
  }
  if (request.input_type === 'step' && classification !== 'unstable' && request.include_metrics) {
    metrics = stepMetrics(t, y, zeta, omegaN)
    analytical = analyticalMetrics(zeta, omegaN)
    if (metrics.steady_state_value !== null && Math.abs(metrics.steady_state_value - 1) > 0.02) {
      diagnostics.push('当前时间范围可能不足以观察到稳态，建议增大 t_end')
    }
    if (metrics.peak_time !== null && metrics.peak_time > t[t.length - 1] * 0.95) {
      diagnostics.push('峰值可能被截断，请增大时间范围')
    }
  }
  if (classification === 'undamped') {
    diagnostics.push('系统无阻尼，响应不会收敛到稳态')
  }

  return {
    classification,
    poles: polesFor(zeta, omegaN),
    t: t.map((value) => Number(value.toFixed(6))),
    y: y.map((value) => Number(value.toFixed(6))),
    u,
    metrics,
    analytical_metrics: analytical,
    diagnostics,
  }
}

export function getMockPresets(): Preset[] {
  return [
    { key: 'undamped', name: '无阻尼', label: '无阻尼', zeta: 0, omega_n: 2, description: '等幅振荡' },
    { key: 'underdamped', name: '欠阻尼', label: '欠阻尼', zeta: 0.3, omega_n: 2, description: '明显超调' },
    { key: 'critical', name: '临界阻尼', label: '临界阻尼', zeta: 1, omega_n: 2, description: '无超调' },
    { key: 'overdamped', name: '过阻尼', label: '过阻尼', zeta: 1.8, omega_n: 2, description: '缓慢无超调' },
    { key: 'unstable', name: '不稳定', label: '不稳定', zeta: -0.15, omega_n: 2, description: '发散' },
  ]
}
