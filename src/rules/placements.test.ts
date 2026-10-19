import { describe, expect, it } from 'vitest'
import type {
  FleetConfig,
  Placement,
  Position,
  SubmarineLength,
} from '../types/game'
import {
  buildPlacementCatalog,
  doPlacementsConflict,
  generatePlacements,
  getForbiddenCells,
  getOccupiedCells,
  isPlacementInBounds,
  isPositionInBounds,
} from './placements'

const dimensions = { rows: 3, columns: 3 }

function findPlacement(
  rows: number,
  columns: number,
  length: SubmarineLength,
  id: string,
): Placement {
  const placement = generatePlacements(
    { rows, columns },
    length,
    'orthogonal-and-diagonal',
  ).find((candidate) => candidate.id === id)

  if (!placement) throw new Error(`测试候选不存在：${id}`)
  return placement
}

describe('placement generation', () => {
  it('在 3×3 中为长度 3 潜艇生成 3 个水平和 3 个垂直候选', () => {
    const placements = generatePlacements(
      dimensions,
      3,
      'orthogonal-and-diagonal',
    )

    expect(placements).toHaveLength(6)
    expect(placements.filter(({ orientation }) => orientation === 'horizontal')).toHaveLength(3)
    expect(placements.filter(({ orientation }) => orientation === 'vertical')).toHaveLength(3)
  })

  it('生成正确的水平和垂直占用格', () => {
    expect(getOccupiedCells({ row: 1, column: 0 }, 'horizontal', 3)).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ])
    expect(getOccupiedCells({ row: 0, column: 2 }, 'vertical', 3)).toEqual([
      { row: 0, column: 2 },
      { row: 1, column: 2 },
      { row: 2, column: 2 },
    ])
  })

  it('正确检查坐标和完整候选边界', () => {
    expect(isPositionInBounds(dimensions, { row: 0, column: 0 })).toBe(true)
    expect(isPositionInBounds(dimensions, { row: 2, column: 2 })).toBe(true)
    expect(isPositionInBounds(dimensions, { row: -1, column: 0 })).toBe(false)
    expect(isPositionInBounds(dimensions, { row: 3, column: 0 })).toBe(false)
    expect(isPlacementInBounds(dimensions, { row: 0, column: 0 }, 'horizontal', 3)).toBe(true)
    expect(isPlacementInBounds(dimensions, { row: 0, column: 1 }, 'horizontal', 3)).toBe(false)
    expect(isPlacementInBounds(dimensions, { row: 1, column: 0 }, 'vertical', 3)).toBe(false)
  })

  it('长度同时大于地图行列时返回空数组', () => {
    expect(
      generatePlacements(
        { rows: 3, columns: 3 },
        4,
        'orthogonal-and-diagonal',
      ),
    ).toEqual([])
  })

  it('候选 ID 唯一、稳定且结果顺序可复现', () => {
    const first = generatePlacements(dimensions, 3, 'orthogonal-only')
    const second = generatePlacements(dimensions, 3, 'orthogonal-only')
    const ids = first.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('length-3-horizontal-row-0-column-0')
    expect(first).toEqual(second)
  })

  it('为相同长度的多艘潜艇只保留一组可复用候选', () => {
    const fleetConfig: FleetConfig = { 2: 0, 3: 2, 4: 0, 5: 0 }
    const catalog = buildPlacementCatalog(
      dimensions,
      fleetConfig,
      'orthogonal-only',
    )

    expect(Object.keys(catalog)).toEqual(['3'])
    expect(catalog[3]).toHaveLength(6)
  })
})

describe('forbidden cells', () => {
  const occupied = getOccupiedCells({ row: 1, column: 1 }, 'horizontal', 2)

  it('orthogonal-only 只包含上下左右相邻格', () => {
    expect(
      getForbiddenCells(
        { rows: 4, columns: 4 },
        occupied,
        'orthogonal-only',
      ),
    ).toEqual([
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 1, column: 3 },
      { row: 2, column: 1 },
      { row: 2, column: 2 },
    ])
  })

  it('orthogonal-and-diagonal 同时包含对角相邻格', () => {
    expect(
      getForbiddenCells(
        { rows: 4, columns: 4 },
        occupied,
        'orthogonal-and-diagonal',
      ),
    ).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 0, column: 3 },
      { row: 1, column: 0 },
      { row: 1, column: 3 },
      { row: 2, column: 0 },
      { row: 2, column: 1 },
      { row: 2, column: 2 },
      { row: 2, column: 3 },
    ])
  })

  it('边角位置会裁剪越界格并排除自身占用格', () => {
    const cornerOccupied = getOccupiedCells({ row: 0, column: 0 }, 'horizontal', 2)
    expect(
      getForbiddenCells(
        dimensions,
        cornerOccupied,
        'orthogonal-and-diagonal',
      ),
    ).toEqual([
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ])
  })
})

describe('placement conflicts', () => {
  const first = findPlacement(5, 5, 2, 'length-2-horizontal-row-0-column-0')
  const overlapping = findPlacement(5, 5, 2, 'length-2-vertical-row-0-column-0')
  const orthogonal = findPlacement(5, 5, 2, 'length-2-horizontal-row-1-column-0')
  const diagonal = findPlacement(5, 5, 2, 'length-2-horizontal-row-1-column-2')
  const separated = findPlacement(5, 5, 2, 'length-2-horizontal-row-2-column-0')

  it('重叠候选在两种规则下都冲突', () => {
    expect(doPlacementsConflict(first, overlapping, 'orthogonal-only')).toBe(true)
    expect(doPlacementsConflict(first, overlapping, 'orthogonal-and-diagonal')).toBe(true)
  })

  it('上下左右相邻在两种规则下都冲突', () => {
    expect(doPlacementsConflict(first, orthogonal, 'orthogonal-only')).toBe(true)
    expect(doPlacementsConflict(first, orthogonal, 'orthogonal-and-diagonal')).toBe(true)
  })

  it('对角相邻只在含对角规则下冲突', () => {
    expect(doPlacementsConflict(first, diagonal, 'orthogonal-only')).toBe(false)
    expect(doPlacementsConflict(first, diagonal, 'orthogonal-and-diagonal')).toBe(true)
  })

  it('间隔至少一格时不冲突', () => {
    expect(doPlacementsConflict(first, separated, 'orthogonal-only')).toBe(false)
    expect(doPlacementsConflict(first, separated, 'orthogonal-and-diagonal')).toBe(false)
  })
})

describe('input immutability', () => {
  it('所有纯函数都不修改输入对象和数组', () => {
    const frozenDimensions = Object.freeze({ rows: 4, columns: 4 })
    const frozenStart = Object.freeze({ row: 1, column: 1 })
    const frozenOccupied: readonly Position[] = Object.freeze([
      Object.freeze({ row: 1, column: 1 }),
      Object.freeze({ row: 1, column: 2 }),
    ])
    const frozenFleet = Object.freeze<FleetConfig>({ 2: 2, 3: 0, 4: 0, 5: 0 })

    getOccupiedCells(frozenStart, 'horizontal', 2)
    getForbiddenCells(frozenDimensions, frozenOccupied, 'orthogonal-only')
    generatePlacements(frozenDimensions, 2, 'orthogonal-only')
    buildPlacementCatalog(frozenDimensions, frozenFleet, 'orthogonal-only')

    expect(frozenDimensions).toEqual({ rows: 4, columns: 4 })
    expect(frozenStart).toEqual({ row: 1, column: 1 })
    expect(frozenOccupied).toEqual([
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ])
    expect(frozenFleet).toEqual({ 2: 2, 3: 0, 4: 0, 5: 0 })
  })
})
