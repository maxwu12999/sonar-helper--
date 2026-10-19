import { useState, type FormEvent, type ReactNode } from 'react'
import { CUSTOM_PRESET_ID, SEA_PRESETS } from '../config/seaPresets'
import type { BoardConfig } from '../types/game'
import {
  validateSetup,
  type SetupErrors,
  type SetupValues,
} from '../utils/validation'

interface SetupFormProps {
  readonly onCreate: (config: BoardConfig) => void
}

const initialValues: SetupValues = {
  rows: '10',
  columns: '10',
  adjacencyRule: 'orthogonal-and-diagonal',
  length2Count: '2',
  length3Count: '2',
  length4Count: '1',
  length5Count: '1',
}

const FLEET_FIELDS = [
  { length: 2, field: 'length2Count' },
  { length: 3, field: 'length3Count' },
  { length: 4, field: 'length4Count' },
  { length: 5, field: 'length5Count' },
] as const

export function SetupForm({ onCreate }: SetupFormProps) {
  const [selectedPreset, setSelectedPreset] = useState(CUSTOM_PRESET_ID)
  const [values, setValues] = useState<SetupValues>(initialValues)
  const [errors, setErrors] = useState<SetupErrors>({})

  function updateValue(field: keyof SetupValues, value: string) {
    setSelectedPreset(CUSTOM_PRESET_ID)
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, fleet: undefined }))
  }

  function handlePresetChange(presetId: string) {
    setSelectedPreset(presetId)
    const preset = SEA_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return

    setValues({
      rows: String(preset.config.rows),
      columns: String(preset.config.columns),
      adjacencyRule: preset.config.adjacencyRule,
      length2Count: String(preset.config.fleetConfig[2]),
      length3Count: String(preset.config.fleetConfig[3]),
      length4Count: String(preset.config.fleetConfig[4]),
      length5Count: String(preset.config.fleetConfig[5]),
    })
    setErrors({})
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateSetup(values)
    setErrors(result.errors)
    if (result.config) onCreate(result.config)
  }

  return (
    <form className="setup-form" onSubmit={handleSubmit} noValidate>
      <div className="setup-heading">
        <div>
          <p className="eyebrow">地图配置</p>
          <h2>创建分析地图</h2>
        </div>
        <p className="setup-hint">自定义配置，请根据实际游戏规则填写；地图最大 10×10</p>
      </div>

      <div className="setup-fields">
        <div className="field-grid map-fields">
          <SelectField
            id="sea-preset"
            label="海域配置"
            value={selectedPreset}
            onChange={handlePresetChange}
          >
            <option value={CUSTOM_PRESET_ID}>自定义配置</option>
            {SEA_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </SelectField>
          <NumberField
            id="rows"
            label="行数"
            value={values.rows}
            error={errors.rows}
            minimum={1}
            maximum={10}
            onChange={(value) => updateValue('rows', value)}
          />
          <NumberField
            id="columns"
            label="列数"
            value={values.columns}
            error={errors.columns}
            minimum={1}
            maximum={10}
            onChange={(value) => updateValue('columns', value)}
          />
          <SelectField
            id="adjacency-rule"
            label="潜艇间隔规则"
            value={values.adjacencyRule}
            error={errors.adjacencyRule}
            onChange={(value) => updateValue('adjacencyRule', value)}
          >
            <option value="orthogonal-and-diagonal">含对角间隔</option>
            <option value="orthogonal-only">仅上下左右间隔</option>
          </SelectField>
        </div>

        <fieldset className="fleet-fields" aria-describedby={errors.fleet ? 'fleet-error' : undefined}>
          <legend>舰队配置</legend>
          <div className="field-grid">
            {FLEET_FIELDS.map(({ length, field }) => {
              return (
                <NumberField
                  key={length}
                  id={`length-${length}-count`}
                  label={`长度 ${length}`}
                  value={values[field]}
                  error={errors[field]}
                  minimum={0}
                  onChange={(value) => updateValue(field, value)}
                />
              )
            })}
          </div>
          {errors.fleet ? (
            <span className="field-error" id="fleet-error" role="alert">
              {errors.fleet}
            </span>
          ) : null}
        </fieldset>
      </div>

      <button className="primary-button create-button" type="submit">
        创建地图
      </button>
    </form>
  )
}

interface NumberFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: string
  readonly minimum: number
  readonly maximum?: number
  readonly onChange: (value: string) => void
}

function NumberField({
  id,
  label,
  value,
  error,
  minimum,
  maximum,
  onChange,
}: NumberFieldProps) {
  const errorId = `${id}-error`
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        step="1"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

interface SelectFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: string
  readonly onChange: (value: string) => void
  readonly children: ReactNode
}

function SelectField({
  id,
  label,
  value,
  error,
  onChange,
  children,
}: SelectFieldProps) {
  const errorId = `${id}-error`
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  )
}
