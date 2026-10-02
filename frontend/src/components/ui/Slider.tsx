interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
  disabled?: boolean
  hint?: string
}

export function Slider({ label, value, min, max, step, onChange, format, disabled, hint }: SliderProps) {
  return (
    <div className="lab-control">
      <div className="control-head">
        <label className="control-label" htmlFor={`slider-${label}`}>
          {label}
          {hint ? <span className="faint small"> · {hint}</span> : null}
        </label>
        <span className="control-value">{format ? format(value) : value}</span>
      </div>
      <input
        id={`slider-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  )
}
