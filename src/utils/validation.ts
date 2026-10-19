import {
  SUBMARINE_LENGTHS,
  type AdjacencyRule,
  type BoardConfig,
  type FleetConfig,
} from '../types/game'
import {
  getFleetOccupiedCellCount,
  getFleetSubmarineCount,
} from './fleet'

export interface SetupValues {
  readonly rows: string
  readonly columns: string
  readonly adjacencyRule: string
  readonly length2Count: string
  readonly length3Count: string
  readonly length4Count: string
  readonly length5Count: string
}

export type SetupErrors = Partial<
  Record<keyof SetupValues | 'fleet', string>
>

export interface ValidationResult {
  readonly config: BoardConfig | null
  readonly errors: SetupErrors
}

const COUNT_FIELDS = {
  2: 'length2Count',
  3: 'length3Count',
  4: 'length4Count',
  5: 'length5Count',
} as const satisfies Record<keyof FleetConfig, keyof SetupValues>

function validatePositiveInteger(
  value: string,
  label: string,
  maximum: number,
): { readonly value?: number; readonly error?: string } {
  if (value.trim() === '') return { error: `请输入${label}` }
  if (!/^\d+$/.test(value.trim())) return { error: `${label}必须是整数` }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return { error: `${label}必须在 1～${maximum} 之间` }
  }
  return { value: parsed }
}

function validateCount(
  value: string,
  length: number,
): { readonly value?: number; readonly error?: string } {
  const label = `长度 ${length} 潜艇数量`
  if (value.trim() === '') return { error: `请输入${label}` }
  if (!/^\d+$/.test(value.trim())) return { error: `${label}必须是非负整数` }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    return { error: `${label}必须是非负整数` }
  }
  return { value: parsed }
}

function isAdjacencyRule(value: string): value is AdjacencyRule {
  return value === 'orthogonal-only' || value === 'orthogonal-and-diagonal'
}

export function validateSetup(values: SetupValues): ValidationResult {
  const errors: SetupErrors = {}
  const rows = validatePositiveInteger(values.rows, '行数', 10)
  const columns = validatePositiveInteger(values.columns, '列数', 10)

  if (rows.error) errors.rows = rows.error
  if (columns.error) errors.columns = columns.error
  if (!isAdjacencyRule(values.adjacencyRule)) {
    errors.adjacencyRule = '请选择有效的潜艇邻接规则'
  }

  const fleetValues: Partial<Record<keyof FleetConfig, number>> = {}
  for (const length of SUBMARINE_LENGTHS) {
    const field = COUNT_FIELDS[length]
    const result = validateCount(values[field], length)
    if (result.error) errors[field] = result.error
    if (result.value !== undefined) fleetValues[length] = result.value
  }

  if (
    rows.value === undefined ||
    columns.value === undefined ||
    !isAdjacencyRule(values.adjacencyRule) ||
    SUBMARINE_LENGTHS.some((length) => fleetValues[length] === undefined)
  ) {
    return { config: null, errors }
  }

  const fleetConfig: FleetConfig = {
    2: fleetValues[2] ?? 0,
    3: fleetValues[3] ?? 0,
    4: fleetValues[4] ?? 0,
    5: fleetValues[5] ?? 0,
  }

  if (getFleetSubmarineCount(fleetConfig) === 0) {
    errors.fleet = '舰队至少需要一艘潜艇'
  } else if (
    getFleetOccupiedCellCount(fleetConfig) > rows.value * columns.value
  ) {
    errors.fleet = '舰队占用格数不能超过地图格数'
  } else {
    const longestSide = Math.max(rows.value, columns.value)
    const oversizedLength = SUBMARINE_LENGTHS.find(
      (length) => fleetConfig[length] > 0 && length > longestSide,
    )
    if (oversizedLength !== undefined) {
      errors.fleet = `长度 ${oversizedLength} 的潜艇无法放入当前地图`
    }
  }

  if (errors.fleet) return { config: null, errors }

  return {
    config: {
      rows: rows.value,
      columns: columns.value,
      adjacencyRule: values.adjacencyRule,
      fleetConfig,
    },
    errors,
  }
}
