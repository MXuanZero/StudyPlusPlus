import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareSecondOrder, fetchPresets, simulateSecondOrder } from '../../api/compute'
import type { InputType, Preset, SimulationRequest, SimulationResponse } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { makeId } from '../../utils/format'
import { useDebouncedValue } from '../../utils/useDebounced'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Slider } from '../ui/Slider'
import { Spinner } from '../ui/Spinner'
import { MetricsTable } from './MetricsTable'
import { PhasePortraitPlot } from './PhasePortraitPlot'
import { PoleZeroMap, type PoleSeries } from './PoleZeroMap'
import { TimeResponsePlot, type ResponseSeries } from './TimeResponsePlot'

const PALETTE = ['#4f46e5', '#0ea5e9', '#f59e0b', '#10b981']

const CLASSIFICATION_LABEL: Record<string, string> = {
  undamped: '无阻尼',
  underdamped: '欠阻尼',
  critically_damped: '临界阻尼',
  overdamped: '过阻尼',
  unstable: '不稳定',
}

const CLASSIFICATION_HINT: Record<string, string> = {
  undamped: '极点落在虚轴上，能量不耗散，系统等幅振荡。',
  underdamped: '共轭极点位于左半平面，响应衰减振荡并可能超调。',
  critically_damped: '重实根，刚好不振荡，是“无超调前提下最快”的边界。',
  overdamped: '两个负实根，响应单调但更慢。',
  unstable: '极点实部为正，扰动被不断放大，响应发散。',
}

const FALLBACK_PRESETS: Preset[] = [
  { key: 'undamped', name: '无阻尼', zeta: 0, omega_n: 2, description: '等幅振荡' },
  { key: 'underdamped', name: '欠阻尼', zeta: 0.3, omega_n: 2, description: '明显超调' },
  { key: 'critical', name: '临界阻尼', zeta: 1, omega_n: 2, description: '无超调' },
  { key: 'overdamped', name: '过阻尼', zeta: 1.8, omega_n: 2, description: '缓慢无超调' },
  { key: 'unstable', name: '不稳定', zeta: -0.15, omega_n: 2, description: '发散' },
]

export interface CompareRun {
  id: string
  zeta: number
  omega_n: number
  color: string
}

interface SecondOrderLabProps {
  defaultMode?: InputType
  defaultCompare?: boolean
  showMetrics?: boolean
  showPhasePortrait?: boolean
  /** 来自 topic widget 配置的默认参数。 */
  defaultZeta?: number
  defaultOmegaN?: number
  /** 只展示配置中列出的预设 key。 */
  presetKeys?: string[]
}

function presetLabel(preset: Preset): string {
  return preset.label ?? preset.name ?? preset.key ?? '预设'
}

function runLabel(run: CompareRun, index: number): string {
  return `组${index + 1}：ζ=${run.zeta}, ωn=${run.omega_n}`
}

export function SecondOrderLab({
  defaultMode = 'step',
  defaultCompare = false,
  showMetrics = true,
  showPhasePortrait = true,
  defaultZeta = 0.5,
  defaultOmegaN = 2,
  presetKeys,
}: SecondOrderLabProps) {
  const pushToast = useAppStore((state) => state.pushToast)

  const [mode, setMode] = useState<InputType>(defaultMode)
  const [zeta, setZeta] = useState(defaultZeta)
  const [omegaN, setOmegaN] = useState(defaultOmegaN)
  const [y0, setY0] = useState(1)
  const [v0, setV0] = useState(0)
  const [tEnd, setTEnd] = useState(20)

  const [compareEnabled, setCompareEnabled] = useState(defaultCompare)
  const [runs, setRuns] = useState<CompareRun[]>([
    { id: makeId('run'), zeta: defaultZeta, omega_n: defaultOmegaN, color: PALETTE[0] },
    { id: makeId('run'), zeta: 1, omega_n: defaultOmegaN, color: PALETTE[1] },
  ])

  const [presets, setPresets] = useState<Preset[]>(FALLBACK_PRESETS)
  const [single, setSingle] = useState<SimulationResponse | null>(null)
  const [compareResults, setCompareResults] = useState<SimulationResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [metricsIndex, setMetricsIndex] = useState(0)

  // 配置中的预设排在最前，但保留后端全部预设（含“不稳定”），方便验证 TC-U02。
  const availablePresets = useMemo(() => {
    if (!presetKeys?.length) return presets
    const configured = presetKeys
      .map((key) => presets.find((preset) => preset.key === key))
      .filter((preset): preset is Preset => Boolean(preset))
    const rest = presets.filter((preset) => !preset.key || !presetKeys.includes(preset.key))
    return [...configured, ...rest]
  }, [presetKeys, presets])

  useEffect(() => {
    const controller = new AbortController()
    fetchPresets(controller.signal)
      .then((list) => {
        if (list.length) setPresets(list)
      })
      .catch(() => {
        /* 预设不是关键路径，失败时保留本地默认值 */
      })
    return () => controller.abort()
  }, [])

  const requestBase = useMemo<SimulationRequest>(
    () => ({
      zeta,
      omega_n: omegaN,
      input_type: mode,
      y0,
      v0,
      t_end: tEnd,
      n_points: 1001,
      include_metrics: true,
    }),
    [mode, omegaN, tEnd, v0, y0, zeta],
  )

  const compareRequests = useMemo<SimulationRequest[]>(
    () =>
      runs.map((run, index) => ({
        ...requestBase,
        zeta: run.zeta,
        omega_n: run.omega_n,
        label: `组${index + 1}`,
      })),
    [requestBase, runs],
  )

  const payload = useMemo(
    () =>
      compareEnabled
        ? ({ kind: 'compare' as const, runs: compareRequests })
        : ({ kind: 'single' as const, run: requestBase }),
    [compareEnabled, compareRequests, requestBase],
  )
  const debouncedPayload = useDebouncedValue(payload, 150)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    const task = async () => {
      try {
        if (debouncedPayload.kind === 'compare') {
          const results = await compareSecondOrder(debouncedPayload.runs, controller.signal)
          if (active) setCompareResults(results)
        } else {
          const result = await simulateSecondOrder(debouncedPayload.run, controller.signal)
          if (active) setSingle(result)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : '未知错误'
        if (active) {
          setError(message)
          pushToast(`仿真失败：${message}`, 'error')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void task()
    return () => {
      active = false
      controller.abort()
    }
  }, [debouncedPayload, pushToast])

  const displaySeries = useMemo<ResponseSeries[]>(() => {
    const list: ResponseSeries[] = []
    if (compareEnabled) {
      runs.forEach((run, index) => {
        const result = compareResults[index]
        if (!result) return
        list.push({
          id: run.id,
          name: runLabel(run, index),
          color: run.color,
          t: result.t,
          y: result.y,
          u: result.u,
        })
      })
      return list
    }
    if (!single) return list
    list.push({
      id: 'main',
      name: `ζ=${zeta}, ωn=${omegaN}`,
      color: PALETTE[0],
      t: single.t,
      y: single.y,
      u: single.u,
    })
    return list
  }, [compareEnabled, compareResults, omegaN, runs, single, zeta])

  const poleSeries = useMemo<PoleSeries[]>(() => {
    const list: PoleSeries[] = []
    if (compareEnabled) {
      runs.forEach((run, index) => {
        const result = compareResults[index]
        if (!result) return
        list.push({ id: run.id, name: runLabel(run, index), color: run.color, poles: result.poles })
      })
      return list
    }
    if (!single) return list
    list.push({ id: 'main', name: '极点', color: PALETTE[0], poles: single.poles })
    return list
  }, [compareEnabled, compareResults, runs, single])

  const activeResult = compareEnabled ? compareResults[metricsIndex] ?? null : single
  const classification = activeResult?.classification ?? '—'
  const diagnostics = useMemo(() => {
    const source = compareEnabled ? compareResults : single ? [single] : []
    return Array.from(new Set(source.flatMap((item) => item.diagnostics ?? [])))
  }, [compareEnabled, compareResults, single])

  const applyPreset = useCallback(
    (preset: Preset) => {
      const nextZeta = preset.zeta
      const nextOmega = preset.omega_n
      if (compareEnabled) {
        setRuns((previous) =>
          previous.map((run, index) =>
            index === 0 ? { ...run, zeta: nextZeta, omega_n: nextOmega } : run,
          ),
        )
        setMetricsIndex(0)
      } else {
        setZeta(nextZeta)
        setOmegaN(nextOmega)
      }
    },
    [compareEnabled],
  )

  const addRun = useCallback(() => {
    setRuns((previous) => {
      if (previous.length >= 4) return previous
      const index = previous.length
      const defaults = [0.2, 0.5, 0.707, 1]
      return [
        ...previous,
        {
          id: makeId('run'),
          zeta: defaults[index] ?? 0.5,
          omega_n: 2,
          color: PALETTE[index % PALETTE.length],
        },
      ]
    })
  }, [])

  const updateRun = useCallback((id: string, patch: Partial<CompareRun>) => {
    setRuns((previous) => previous.map((run) => (run.id === id ? { ...run, ...patch } : run)))
  }, [])

  const removeRun = useCallback((id: string) => {
    setRuns((previous) => (previous.length <= 1 ? previous : previous.filter((run) => run.id !== id)))
    setMetricsIndex(0)
  }, [])

  const exportCsv = useCallback(() => {
    if (!displaySeries.length) return
    let header: string
    let lines: string[]
    if (compareEnabled) {
      header = ['t', ...displaySeries.map((item) => `"${item.name}"`)].join(',')
      lines = displaySeries[0].t.map((time, index) =>
        [time.toFixed(6), ...displaySeries.map((item) => (item.y[index] ?? 0).toFixed(6))].join(','),
      )
    } else {
      const item = displaySeries[0]
      header = 't,y,u'
      lines = item.t.map((time, index) =>
        [time.toFixed(6), (item.y[index] ?? 0).toFixed(6), (item.u?.[index] ?? 0).toString()].join(','),
      )
    }
    const csv = `\uFEFF${[header, ...lines].join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = compareEnabled
      ? `second_order_compare_${displaySeries.length}runs.csv`
      : `second_order_${mode}_zeta${zeta}_wn${omegaN}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    pushToast('CSV 已导出', 'success')
  }, [compareEnabled, displaySeries, mode, omegaN, pushToast, zeta])

  const metricsForTable = activeResult?.metrics ?? null
  const analyticalForTable = activeResult?.analytical_metrics ?? null

  return (
    <div className="lab">
      <div className="lab-head">
        <h3>二阶系统实验室</h3>
        <span className="lab-sub">拖动参数，图表会实时联动</span>
        <span className="spacer" />
        <span className={`badge ${classification === 'unstable' ? 'badge-warning' : 'badge-accent'}`}>
          {CLASSIFICATION_LABEL[classification] ?? classification}
        </span>
        <Button size="sm" onClick={exportCsv} disabled={!displaySeries.length}>
          导出 CSV
        </Button>
      </div>

      <div className="lab-body">
        <div className="lab-controls">
          <div className="lab-control-group">
            <div className="group-title">输入类型</div>
            <SegmentedControl<InputType>
              ariaLabel="输入类型"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'step', label: '单位阶跃' },
                { value: 'impulse', label: '单位冲激' },
                { value: 'initial', label: '初始状态' },
              ]}
            />
          </div>

          {!compareEnabled ? (
            <div className="lab-control-group">
              <div className="group-title">系统参数</div>
              <Slider label="阻尼比 ζ" value={zeta} min={-0.5} max={3} step={0.01} onChange={setZeta} format={(v) => v.toFixed(2)} />
              <Slider label="自然频率 ωn" value={omegaN} min={0.2} max={10} step={0.1} onChange={setOmegaN} format={(v) => v.toFixed(1)} hint="rad/s" />
            </div>
          ) : null}

          {mode === 'initial' ? (
            <div className="lab-control-group">
              <div className="group-title">初始状态</div>
              <Slider label="初始位移 y(0)" value={y0} min={-2} max={2} step={0.1} onChange={setY0} format={(v) => v.toFixed(1)} />
              <Slider label="初始速度 y′(0)" value={v0} min={-2} max={2} step={0.1} onChange={setV0} format={(v) => v.toFixed(1)} />
            </div>
          ) : null}

          <div className="lab-control-group">
            <div className="group-title">时间范围</div>
            <Slider label="结束时间 t_end" value={tEnd} min={2} max={60} step={1} onChange={setTEnd} format={(v) => `${v.toFixed(0)} s`} />
          </div>

          <div className="lab-control-group">
            <div className="group-title">预设案例</div>
            <div className="preset-grid">
              {availablePresets.map((preset) => (
                <Button key={preset.key ?? presetLabel(preset)} size="sm" onClick={() => applyPreset(preset)} title={preset.description}>
                  {presetLabel(preset)}
                </Button>
              ))}
            </div>
          </div>

          <div className="lab-control-group">
            <div className="group-title">对比模式</div>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={compareEnabled}
                onChange={(event) => setCompareEnabled(event.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              开启参数对比（最多 4 组）
            </label>
            {compareEnabled ? (
              <div className="compare-list">
                {runs.map((run, index) => (
                  <div className="compare-row" key={run.id}>
                    <div className="compare-row-head">
                      <span className="swatch" style={{ background: run.color }} />
                      <span className="grow">组 {index + 1}</span>
                      <input
                        type="color"
                        value={run.color}
                        aria-label={`第 ${index + 1} 组颜色`}
                        onChange={(event) => updateRun(run.id, { color: event.target.value })}
                        style={{ width: 22, height: 22, border: 'none', background: 'none', padding: 0 }}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`删除第 ${index + 1} 组`}
                        disabled={runs.length <= 1}
                        onClick={() => removeRun(run.id)}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <label className="mini-number">
                        ζ
                        <input
                          type="number"
                          min={-0.5}
                          max={3}
                          step={0.01}
                          value={run.zeta}
                          onChange={(event) => updateRun(run.id, { zeta: Number(event.target.value) })}
                        />
                      </label>
                      <label className="mini-number">
                        ωn
                        <input
                          type="number"
                          min={0.2}
                          max={10}
                          step={0.1}
                          value={run.omega_n}
                          onChange={(event) => updateRun(run.id, { omega_n: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                <Button size="sm" onClick={addRun} disabled={runs.length >= 4}>
                  + 添加一组
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="lab-main">
          {error ? <div className="diagnostic-item error">仿真失败：{error}（保留上一次有效曲线）</div> : null}
          {diagnostics.map((item) => (
            <div className="diagnostic-item" key={item}>
              {item}
            </div>
          ))}

          <div className="lab-chart-card">
            <div className="chart-title">
              时域响应
              <span className="hint">
                {inputLabel(mode)}
                {loading ? ' · 计算中…' : ''}
              </span>
              {mode === 'step' ? (
                <label className="small muted" style={{ marginLeft: 12, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={showAnnotations}
                    onChange={(event) => setShowAnnotations(event.target.checked)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  标注指标
                </label>
              ) : null}
            </div>
            <TimeResponsePlot
              series={displaySeries}
              inputType={mode}
              metrics={activeResult?.metrics}
              showMetricAnnotations={showAnnotations}
              height={340}
            />
            {loading ? (
              <div className="loading-mask">
                <Spinner />
              </div>
            ) : null}
          </div>

          <div className="lab-grid-2">
            <div className="lab-chart-card">
              <div className="chart-title">
                极点图
                <span className="hint">左半平面稳定</span>
              </div>
              <PoleZeroMap series={poleSeries} height={300} />
              {loading ? (
                <div className="loading-mask">
                  <Spinner />
                </div>
              ) : null}
            </div>

            {mode === 'initial' && showPhasePortrait ? (
              <div className="lab-chart-card">
                <div className="chart-title">
                  相轨迹
                  <span className="hint">起点为实心圆，终点为方块</span>
                </div>
                <PhasePortraitPlot series={displaySeries} height={300} />
                {loading ? (
                  <div className="loading-mask">
                    <Spinner />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="lab-chart-card">
                <div className="chart-title">阻尼状态说明</div>
                <div style={{ padding: '16px 18px' }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{CLASSIFICATION_LABEL[classification] ?? classification}</p>
                  <p className="muted small" style={{ margin: 0 }}>
                    {CLASSIFICATION_HINT[classification] ?? '拖动滑杆或选择预设，观察极点与响应的对应关系。'}
                  </p>
                  <p className="faint small" style={{ margin: '10px 0 0' }}>
                    相轨迹图在“初始状态”模式下显示。
                  </p>
                </div>
              </div>
            )}
          </div>

          {showMetrics ? (
            <div>
              <div className="chart-title" style={{ padding: '4px 2px 10px', fontWeight: 600 }}>
                性能指标
                {compareEnabled && compareResults.length > 1 ? (
                  <span className="segmented" style={{ marginLeft: 12 }}>
                    {compareResults.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        className={metricsIndex === index ? 'active' : ''}
                        onClick={() => setMetricsIndex(index)}
                      >
                        组 {index + 1}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              <MetricsTable
                metrics={metricsForTable}
                analytical={analyticalForTable}
                classification={classification}
                inputType={mode}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function inputLabel(mode: InputType): string {
  if (mode === 'impulse') return '单位冲激输入'
  if (mode === 'initial') return '零输入响应'
  return '单位阶跃输入'
}
