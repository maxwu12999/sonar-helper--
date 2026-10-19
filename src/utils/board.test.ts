import { describe, expect, it } from 'vitest'
import type { BoardConfig } from '../types/game'
import { countCellsByState, createBoard, formatPosition, updateCellState } from './board'
import {
  getFleetOccupiedCellCount,
  getFleetSubmarineCount,
  getRemainingFleetConfig,
  getRemainingSubmarineCount,
} from './fleet'
import { validateSetup, type SetupValues } from './validation'

const validValues: SetupValues = {
  rows: '10',
  columns: '10',
  adjacencyRule: 'orthogonal-and-diagonal',
  length2Count: '2',
  length3Count: '2',
  length4Count: '1',
  length5Count: '1',
}

describe('board utilities', () => {
  it('创建、更新和统计 observation 且不修改原地图', () => {
    const board = createBoard(2, 3)
    const updated = updateCellState(board, { row: 1, column: 0 }, 'hit')
    expect(countCellsByState(board, 'unknown')).toBe(6)
    expect(updated[1][0].state).toBe('hit')
    expect(board[1][0].state).toBe('unknown')
  })

  it('使用统一中文坐标格式', () => {
    expect(formatPosition({ row: 1, column: 2 })).toBe('第 2 行，第 3 列')
  })
})

describe('fleet utilities', () => {
  it('分别计算总数、占用格和按长度扣减的剩余舰队', () => {
    const fleet = { 2: 2, 3: 2, 4: 1, 5: 1 } as const
    const fixed = [
      { id: 'a', length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      { id: 'b', length: 3, orientation: 'vertical', start: { row: 0, column: 3 } },
    ] as const
    expect(getFleetSubmarineCount(fleet)).toBe(6)
    expect(getFleetOccupiedCellCount(fleet)).toBe(19)
    expect(getRemainingFleetConfig(fleet, fixed)).toEqual({ 2: 1, 3: 1, 4: 1, 5: 1 })
    expect(getRemainingSubmarineCount(fleet, fixed)).toBe(4)
  })
})

describe('setup validation', () => {
  const invalidCases: Array<[Partial<SetupValues>, keyof SetupValues | 'fleet']> = [
    [{ rows: '' }, 'rows'],
    [{ rows: '1.5' }, 'rows'],
    [{ rows: '-1' }, 'rows'],
    [{ rows: '11' }, 'rows'],
    [{ columns: '' }, 'columns'],
    [{ columns: '2.5' }, 'columns'],
    [{ length2Count: '' }, 'length2Count'],
    [{ length3Count: '1.5' }, 'length3Count'],
    [{ length4Count: '-1' }, 'length4Count'],
    [{ adjacencyRule: 'unknown-rule' }, 'adjacencyRule'],
    [{ length2Count: '0', length3Count: '0', length4Count: '0', length5Count: '0' }, 'fleet'],
    [{ rows: '2', columns: '2', length2Count: '3', length3Count: '0', length4Count: '0', length5Count: '0' }, 'fleet'],
    [{ rows: '2', columns: '2', length2Count: '0', length3Count: '1', length4Count: '0', length5Count: '0' }, 'fleet'],
  ]

  it.each(invalidCases)('拒绝无效输入 %#', (overrides, errorField) => {
    const result = validateSetup({ ...validValues, ...overrides })
    expect(result.config).toBeNull()
    expect(result.errors[errorField]).toBeTruthy()
  })

  it('接受 10×10 自定义舰队和默认邻接规则', () => {
    const result = validateSetup(validValues)
    expect(result.config).toEqual({
      rows: 10,
      columns: 10,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 2, 4: 1, 5: 1 },
    } satisfies BoardConfig)
  })
})
