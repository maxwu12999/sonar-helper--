import { describe, expect, it } from 'vitest'
import type { BoardConfig, FleetConfig } from '../types/game'
import { analyzeFleetLayouts } from './layoutAnalysis'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type CompleteLayoutAnalysis,
  type FixedPlacementEvidence,
  type LayoutAnalysis,
  type LayoutAnalysisErrorCode,
} from './types'

function createConfig(
  rows: number,
  columns: number,
  fleetConfig: FleetConfig,
  adjacencyRule: BoardConfig['adjacencyRule'] = 'orthogonal-and-diagonal',
): BoardConfig {
  return { rows, columns, fleetConfig, adjacencyRule }
}

function expectComplete(result: LayoutAnalysis): CompleteLayoutAnalysis {
  expect(result.status).toBe('complete')
  if (result.status !== 'complete') {
    throw new Error(`预期 complete，实际为 ${result.status}`)
  }
  return result
}

function expectDomainError(
  action: () => void,
  expectedCode: LayoutAnalysisErrorCode,
): void {
  try {
    action()
    throw new Error(`预期领域错误：${expectedCode}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LayoutAnalysisError)
    if (error instanceof LayoutAnalysisError) {
      expect(error.code).toBe(expectedCode)
    }
  }
}

describe('fixed placement evidence', () => {
  it('5×5 一艘长度 3 固定后只有一个完整布局', () => {
    const config = createConfig(5, 5, { 2: 0, 3: 1, 4: 0, 5: 0 })
    const evidence: BoardEvidence = {
      misses: [],
      occupied: [],
      fixedPlacements: [
        { length: 3, orientation: 'horizontal', start: { row: 2, column: 1 } },
      ],
    }
    const result = expectComplete(analyzeFleetLayouts(config, evidence))

    expect(result.totalLayouts).toBe(1)
    expect(result.visitedNodes).toBe(1)
    expect(result.probabilities).toEqual([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    expect(result.occupancyCounts).toEqual(result.probabilities)
  })

  it('固定长度 2 加待搜索长度 2，只搜索剩余潜艇且概率总和为 4', () => {
    const config = createConfig(
      1,
      5,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const evidence: BoardEvidence = {
      misses: [],
      occupied: [],
      fixedPlacements: [
        { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      ],
    }
    const result = expectComplete(analyzeFleetLayouts(config, evidence))

    expect(result.totalLayouts).toBe(1)
    expect(result.probabilities).toEqual([[1, 1, 0, 1, 1]])
    expect(result.probabilities[0].reduce((sum, value) => sum + value, 0)).toBe(4)
  })

  it('固定数量超过 fleetConfig 时返回稳定领域错误', () => {
    const config = createConfig(
      1,
      5,
      { 2: 1, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    expectDomainError(() =>
      analyzeFleetLayouts(config, {
        misses: [],
        occupied: [],
        fixedPlacements: [
          { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
          { length: 2, orientation: 'horizontal', start: { row: 0, column: 3 } },
        ],
      }),
    'fixed-placement-count-exceeded')
  })

  it('固定潜艇重叠时返回稳定领域错误', () => {
    const config = createConfig(3, 3, { 2: 2, 3: 0, 4: 0, 5: 0 })
    expectDomainError(() =>
      analyzeFleetLayouts(config, {
        misses: [],
        occupied: [],
        fixedPlacements: [
          { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
          { length: 2, orientation: 'vertical', start: { row: 0, column: 0 } },
        ],
      }),
    'fixed-placement-conflict')
  })

  it('固定潜艇非法邻接由 adjacencyRule 决定', () => {
    const fleet = { 2: 2, 3: 0, 4: 0, 5: 0 } as const
    const fixedPlacements: readonly FixedPlacementEvidence[] = [
      { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      { length: 2, orientation: 'horizontal', start: { row: 1, column: 2 } },
    ]
    const evidence: BoardEvidence = { misses: [], occupied: [], fixedPlacements }

    const allowed = expectComplete(
      analyzeFleetLayouts(
        createConfig(2, 4, fleet, 'orthogonal-only'),
        evidence,
      ),
    )
    expect(allowed.totalLayouts).toBe(1)

    expectDomainError(() =>
      analyzeFleetLayouts(
        createConfig(2, 4, fleet, 'orthogonal-and-diagonal'),
        evidence,
      ),
    'fixed-placement-conflict')
  })

  it('miss 与固定潜艇占用格冲突时返回稳定领域错误', () => {
    const config = createConfig(3, 3, { 2: 1, 3: 0, 4: 0, 5: 0 })
    expectDomainError(() =>
      analyzeFleetLayouts(config, {
        misses: [{ row: 1, column: 1 }],
        occupied: [],
        fixedPlacements: [
          { length: 2, orientation: 'horizontal', start: { row: 1, column: 0 } },
        ],
      }),
    'fixed-placement-miss-conflict')
  })

  it('普通 occupied 落在固定潜艇内时被视为已满足', () => {
    const config = createConfig(3, 3, { 2: 1, 3: 0, 4: 0, 5: 0 })
    const result = expectComplete(
      analyzeFleetLayouts(config, {
        misses: [],
        occupied: [{ row: 1, column: 1 }],
        fixedPlacements: [
          { length: 2, orientation: 'horizontal', start: { row: 1, column: 0 } },
        ],
      }),
    )

    expect(result.totalLayouts).toBe(1)
    expect(result.probabilities[1][0]).toBe(1)
    expect(result.probabilities[1][1]).toBe(1)
  })

  it('普通 occupied 落在固定禁止区域时返回 no-layouts', () => {
    const config = createConfig(
      1,
      4,
      { 2: 1, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = analyzeFleetLayouts(config, {
      misses: [],
      occupied: [{ row: 0, column: 2 }],
      fixedPlacements: [
        { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      ],
    })

    expect(result.status).toBe('no-layouts')
    expect(result.probabilities).toBeNull()
  })

  it('重复固定潜艇稳定去重，不重复扣减舰队', () => {
    const config = createConfig(3, 3, { 2: 1, 3: 0, 4: 0, 5: 0 })
    const fixed = {
      length: 2,
      orientation: 'horizontal',
      start: { row: 0, column: 0 },
    } as const
    const result = expectComplete(
      analyzeFleetLayouts(config, {
        misses: [],
        occupied: [],
        fixedPlacements: [fixed, fixed],
      }),
    )

    expect(result.totalLayouts).toBe(1)
  })

  it('冻结 fixedPlacements、start 和其他输入后仍正常且不修改输入', () => {
    const fleetConfig = Object.freeze<FleetConfig>({ 2: 1, 3: 0, 4: 0, 5: 0 })
    const config = Object.freeze<BoardConfig>({
      rows: 3,
      columns: 3,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig,
    })
    const start = Object.freeze({ row: 1, column: 0 })
    const fixed = Object.freeze<FixedPlacementEvidence>({
      length: 2,
      orientation: 'horizontal',
      start,
    })
    const fixedPlacements = Object.freeze([fixed])
    const evidence = Object.freeze<BoardEvidence>({
      misses: Object.freeze([]),
      occupied: Object.freeze([{ row: 1, column: 1 }]),
      fixedPlacements,
    })

    const result = analyzeFleetLayouts(config, evidence)

    expect(result.status).toBe('complete')
    expect(evidence.fixedPlacements).toEqual([
      { length: 2, orientation: 'horizontal', start: { row: 1, column: 0 } },
    ])
    expect(start).toEqual({ row: 1, column: 0 })
  })
})
