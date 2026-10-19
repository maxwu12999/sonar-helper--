import { describe, expect, it } from 'vitest'
import type { Position } from '../types/game'
import {
  cellIndexToMask,
  cellIndexToPosition,
  countMaskBits,
  positionToCellIndex,
  positionToMask,
  positionsToMask,
} from './bitboard'

describe('bitboard coordinates', () => {
  it('在 10×10 地图中稳定转换首尾坐标和位索引', () => {
    const dimensions = { rows: 10, columns: 10 }

    expect(positionToCellIndex(dimensions, { row: 0, column: 0 })).toBe(0)
    expect(positionToCellIndex(dimensions, { row: 9, column: 9 })).toBe(99)
    expect(cellIndexToPosition(dimensions, 0)).toEqual({ row: 0, column: 0 })
    expect(cellIndexToPosition(dimensions, 99)).toEqual({ row: 9, column: 9 })
    expect(positionToMask(dimensions, { row: 9, column: 9 })).toBe(1n << 99n)
  })

  it('合并坐标位并正确统计去重后的位数', () => {
    const positions: readonly Position[] = [
      { row: 0, column: 0 },
      { row: 0, column: 2 },
      { row: 0, column: 0 },
    ]
    const mask = positionsToMask({ rows: 1, columns: 3 }, positions)

    expect(mask).toBe(cellIndexToMask(0) | cellIndexToMask(2))
    expect(countMaskBits(mask)).toBe(2)
  })

  it('不修改冻结的尺寸和坐标输入', () => {
    const dimensions = Object.freeze({ rows: 3, columns: 3 })
    const position = Object.freeze({ row: 2, column: 1 })
    const positions = Object.freeze([position])

    positionsToMask(dimensions, positions)

    expect(dimensions).toEqual({ rows: 3, columns: 3 })
    expect(position).toEqual({ row: 2, column: 1 })
    expect(positions).toEqual([{ row: 2, column: 1 }])
  })
})
