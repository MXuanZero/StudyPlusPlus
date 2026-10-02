import type { ComponentType } from 'react'
import type { InputType, WidgetConfig } from '../../api/types'
import { SecondOrderLab } from './SecondOrderLab'
import { SecondOrderStandardForm } from './SecondOrderStandardForm'

interface WidgetComponentProps {
  config: WidgetConfig
}

function LabFromConfig({ config }: WidgetComponentProps) {
  return (
    <SecondOrderLab
      defaultMode={(config.default_mode as InputType | undefined) ?? 'step'}
      defaultCompare={Boolean(config.default_compare)}
      showMetrics={config.show_metrics !== false}
      showPhasePortrait={config.show_phase_portrait !== false}
    />
  )
}

function MetricsLabFromConfig({ config }: WidgetComponentProps) {
  return (
    <SecondOrderLab
      defaultMode={(config.default_mode as InputType | undefined) ?? 'step'}
      defaultCompare={Boolean(config.default_compare)}
      showMetrics
      showPhasePortrait={config.show_phase_portrait !== false}
    />
  )
}

function ComparisonLabFromConfig({ config }: WidgetComponentProps) {
  return (
    <SecondOrderLab
      defaultMode={(config.default_mode as InputType | undefined) ?? 'step'}
      defaultCompare
      showMetrics={config.show_metrics !== false}
      showPhasePortrait={config.show_phase_portrait !== false}
    />
  )
}

const REGISTRY: Record<string, ComponentType<WidgetComponentProps>> = {
  second_order_standard_form: SecondOrderStandardForm,
  second_order_lab: LabFromConfig,
  second_order_metrics_lab: MetricsLabFromConfig,
  second_order_comparison_lab: ComparisonLabFromConfig,
}

export function WidgetRenderer({ widget }: { widget: WidgetConfig }) {
  const Component = REGISTRY[widget.type]
  return (
    <div className="widget-slot" data-widget-id={widget.id} data-widget-type={widget.type}>
      {Component ? (
        <Component config={widget} />
      ) : (
        <div className="widget-unknown">
          暂不支持的交互组件：<span className="mono">{widget.type}</span>（id: {widget.id}）
        </div>
      )}
    </div>
  )
}
