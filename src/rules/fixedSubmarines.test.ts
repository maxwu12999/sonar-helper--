import { describe, expect, it } from 'vitest'
import type { BoardConfig, FixedSubmarine } from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import {
  createFixedSubmarineFromPlacement,
  validateFixedSubmarine,
  validateFixedSubmarineInput,
} from './fixedSubmarines'
import { generatePlacements } from './placements'

function config(
  adjacencyRule: BoardConfig['adjacencyRule'] = 'orthogonal-and-diagonal',
): BoardConfig {
  return {
    rows: 4,
    columns: 5,
    adjacencyRule,
    fleetConfig: { 2: 2, 3: 1, 4: 0, 5: 0 },
  }
}

function fixedAt(boardConfig: BoardConfig, row: number, column: number): FixedSubmarine {
  const placement = generatePlacements(boardConfig, 2, boardConfig.adjacencyRule).find(
    (candidate) =>
      candidate.orientation === 'horizontal' &&
      candidate.start.row === row &&
      candidate.start.column === column,
  )!
  return createFixedSubmarineFromPlacement(placement)
}

describe('fixed submarine validation', () => {
  it('只使用规则 Placement 的稳定 id，并允许候选内部 hit', () => {
    const boardConfig = config()
    const board = updateCellState(createBoard(4, 5), { row: 0, column: 1 }, 'hit')
    const result = validateFixedSubmarineInput(boardConfig, board, [], {
      length: 2,
      orientation: 'horizontal',
      start: { row: 0, column: 0 },
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.submarine.id).toBe(result.placement.id)
      expect(result.submarine.id).toBe('length-2-horizontal-row-0-column-0')
    }
  })

  it('拒绝候选禁止邻接区域中的 hit', () => {
    const boardConfig = config('orthogonal-only')
    const board = updateCellState(createBoard(4, 5), { row: 1, column: 0 }, 'hit')
    const result = validateFixedSubmarineInput(boardConfig, board, [], {
      length: 2,
      orientation: 'horizontal',
      start: { row: 0, column: 0 },
    })
    expect(result).toMatchObject({
      valid: false,
      error: { code: 'fixed-submarine-hit-conflict' },
    })
  })

  it('对角 hit 在 orthogonal-only 合法，在含对角规则下冲突', () => {
    const board = updateCellState(createBoard(4, 5), { row: 1, column: 2 }, 'hit')
    const input = {
      length: 2,
      orientation: 'horizontal',
      start: { row: 0, column: 0 },
    } as const
    expect(validateFixedSubmarineInput(config('orthogonal-only'), board, [], input).valid).toBe(true)
    expect(validateFixedSubmarineInput(config(), board, [], input)).toMatchObject({
      valid: false,
      error: { code: 'fixed-submarine-hit-conflict' },
    })
  })

  it('固定潜艇对角接触仅在 orthogonal-only 下允许', () => {
    const orthogonalConfig = config('orthogonal-only')
    const diagonalConfig = config('orthogonal-and-diagonal')
    const input = {
      length: 2,
      orientation: 'horizontal',
      start: { row: 1, column: 2 },
    } as const
    expect(
      validateFixedSubmarineInput(
        orthogonalConfig,
        createBoard(4, 5),
        [fixedAt(orthogonalConfig, 0, 0)],
        input,
      ).valid,
    ).toBe(true)
    expect(
      validateFixedSubmarineInput(
        diagonalConfig,
        createBoard(4, 5),
        [fixedAt(diagonalConfig, 0, 0)],
        input,
      ),
    ).toMatchObject({
      valid: false,
      error: { code: 'fixed-submarine-adjacency-conflict' },
    })
  })

  it('拒绝越界、miss、重复、数量超限、重叠和非法邻接', () => {
    const boardConfig = config()
    expect(validateFixedSubmarineInput(boardConfig, createBoard(4, 5), [], {
      length: 3,
      orientation: 'horizontal',
      start: { row: 0, column: 4 },
    })).toMatchObject({ valid: false, error: { code: 'fixed-submarine-out-of-bounds' } })

    const missBoard = updateCellState(createBoard(4, 5), { row: 0, column: 1 }, 'miss')
    expect(validateFixedSubmarineInput(boardConfig, missBoard, [], {
      length: 2,
      orientation: 'horizontal',
      start: { row: 0, column: 0 },
    })).toMatchObject({ valid: false, error: { code: 'fixed-submarine-miss-conflict' } })

    const first = fixedAt(boardConfig, 0, 0)
    expect(validateFixedSubmarine(boardConfig, createBoard(4, 5), [first], first)).toMatchObject({
      valid: false,
      error: { code: 'duplicate-fixed-submarine' },
    })
    const other = fixedAt(boardConfig, 3, 0)
    expect(validateFixedSubmarine(boardConfig, createBoard(4, 5), [first, other], fixedAt(boardConfig, 2, 3))).toMatchObject({
      valid: false,
      error: { code: 'fixed-submarine-count-exceeded' },
    })
    expect(validateFixedSubmarineInput(boardConfig, createBoard(4, 5), [first], {
      length: 2,
      orientation: 'vertical',
      start: { row: 0, column: 0 },
    })).toMatchObject({ valid: false, error: { code: 'fixed-submarine-overlap' } })
    expect(validateFixedSubmarineInput(boardConfig, createBoard(4, 5), [first], {
      length: 3,
      orientation: 'horizontal',
      start: { row: 1, column: 0 },
    })).toMatchObject({ valid: false, error: { code: 'fixed-submarine-adjacency-conflict' } })
  })

  it('冻结输入保持可用且不被修改', () => {
    const boardConfig = Object.freeze(config())
    const board = Object.freeze(createBoard(4, 5).map((row) => Object.freeze(row)))
    const input = Object.freeze({
      length: 2 as const,
      orientation: 'horizontal' as const,
      start: Object.freeze({ row: 0, column: 0 }),
    })
    expect(validateFixedSubmarineInput(boardConfig, board, Object.freeze([]), input).valid).toBe(true)
    expect(input.start).toEqual({ row: 0, column: 0 })
  })
})
