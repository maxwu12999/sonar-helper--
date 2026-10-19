import { describe, expect, it } from 'vitest'
import type { BoardConfig, FleetConfig, Position } from '../types/game'
import { getFleetOccupiedCellCount } from '../utils/fleet'
import { analyzeFleetLayouts } from './layoutAnalysis'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type CompleteLayoutAnalysis,
  type LayoutAnalysis,
  type LayoutAnalysisErrorCode,
} from './types'

const noEvidence: BoardEvidence = { misses: [], occupied: [] }

function createConfig(
  rows: number,
  columns: number,
  fleetConfig: FleetConfig,
  adjacencyRule: BoardConfig['adjacencyRule'] = 'orthogonal-and-diagonal',
): BoardConfig {
  return { rows, columns, fleetConfig, adjacencyRule }
}

function oneLengthThreeConfig(): BoardConfig {
  return createConfig(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })
}

function expectComplete(result: LayoutAnalysis): CompleteLayoutAnalysis {
  expect(result.status).toBe('complete')
  if (result.status !== 'complete') {
    throw new Error(`预期 complete，实际为 ${result.status}`)
  }
  return result
}

function flatten(matrix: readonly (readonly number[])[]): readonly number[] {
  return matrix.flatMap((row) => [...row])
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

function expectProbabilityInvariants(
  result: CompleteLayoutAnalysis,
  config: BoardConfig,
  evidence: BoardEvidence,
): void {
  const probabilities = flatten(result.probabilities)
  const counts = flatten(result.occupancyCounts)

  for (const probability of probabilities) {
    expect(probability).toBeGreaterThanOrEqual(0)
    expect(probability).toBeLessThanOrEqual(1)
    expect(Number.isFinite(probability)).toBe(true)
  }
  for (const count of counts) {
    expect(count).toBeGreaterThanOrEqual(0)
    expect(count).toBeLessThanOrEqual(result.totalLayouts)
    expect(Number.isFinite(count)).toBe(true)
  }
  for (const miss of evidence.misses) {
    expect(result.probabilities[miss.row][miss.column]).toBe(0)
  }
  for (const occupied of evidence.occupied) {
    expect(result.probabilities[occupied.row][occupied.column]).toBe(1)
  }

  const probabilitySum = probabilities.reduce((sum, value) => sum + value, 0)
  expect(probabilitySum).toBeCloseTo(
    getFleetOccupiedCellCount(config.fleetConfig),
    10,
  )
}

describe('exact layout probabilities', () => {
  it('3×3 一艘长度 3：6 个布局且每格概率为 1/3', () => {
    const config = oneLengthThreeConfig()
    const result = expectComplete(analyzeFleetLayouts(config, noEvidence))

    expect(result.totalLayouts).toBe(6)
    for (const probability of flatten(result.probabilities)) {
      expect(probability).toBeCloseTo(1 / 3, 10)
    }
    expectProbabilityInvariants(result, config, noEvidence)
  })

  it('中心格 occupied：2 个布局、中心概率 1、十字臂概率 1/2', () => {
    const config = oneLengthThreeConfig()
    const evidence: BoardEvidence = {
      misses: [],
      occupied: [{ row: 1, column: 1 }],
    }
    const result = expectComplete(analyzeFleetLayouts(config, evidence))

    expect(result.totalLayouts).toBe(2)
    expect(result.probabilities).toEqual([
      [0, 0.5, 0],
      [0.5, 1, 0.5],
      [0, 0.5, 0],
    ])
    expectProbabilityInvariants(result, config, evidence)
  })

  it('中心格 miss：4 个布局且中心概率为 0', () => {
    const config = oneLengthThreeConfig()
    const evidence: BoardEvidence = {
      misses: [{ row: 1, column: 1 }],
      occupied: [],
    }
    const result = expectComplete(analyzeFleetLayouts(config, evidence))

    expect(result.totalLayouts).toBe(4)
    expect(result.probabilities[1][1]).toBe(0)
    expectProbabilityInvariants(result, config, evidence)
  })

  it('1×5 两艘长度 2 只统计一个物理布局', () => {
    const config = createConfig(
      1,
      5,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = expectComplete(analyzeFleetLayouts(config, noEvidence))

    expect(result.totalLayouts).toBe(1)
    expect(result.occupancyCounts).toEqual([[1, 1, 0, 1, 1]])
    expect(result.probabilities).toEqual([[1, 1, 0, 1, 1]])
    expectProbabilityInvariants(result, config, noEvidence)
  })

  it('1×4 两艘长度 2 无法保持间隔', () => {
    const config = createConfig(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = analyzeFleetLayouts(config, noEvidence)

    expect(result.status).toBe('no-layouts')
    expect(result.probabilities).toBeNull()
    if (result.status === 'no-layouts') {
      expect(flatten(result.occupancyCounts).every(Number.isFinite)).toBe(true)
    }
  })

  it('重叠和非法邻接候选不会进入完整布局', () => {
    const config = createConfig(
      2,
      2,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    expect(analyzeFleetLayouts(config, noEvidence).status).toBe('no-layouts')
  })

  it('对角接触仅在 orthogonal-only 下允许', () => {
    const occupied: readonly Position[] = [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 2 },
      { row: 1, column: 3 },
    ]
    const evidence: BoardEvidence = { misses: [], occupied }
    const fleet = { 2: 2, 3: 0, 4: 0, 5: 0 } as const
    const orthogonalResult = analyzeFleetLayouts(
      createConfig(2, 4, fleet, 'orthogonal-only'),
      evidence,
    )
    const diagonalResult = analyzeFleetLayouts(
      createConfig(2, 4, fleet, 'orthogonal-and-diagonal'),
      evidence,
    )

    expect(expectComplete(orthogonalResult).totalLayouts).toBe(1)
    expect(diagonalResult.status).toBe('no-layouts')
  })

  it('无法被任何完整布局覆盖的 occupied 返回 no-layouts', () => {
    const evidence: BoardEvidence = {
      misses: [],
      occupied: [
        { row: 0, column: 0 },
        { row: 1, column: 1 },
      ],
    }
    const result = analyzeFleetLayouts(oneLengthThreeConfig(), evidence)

    expect(result.status).toBe('no-layouts')
    expect(result.probabilities).toBeNull()
  })
})

describe('search limits and determinism', () => {
  it('maxVisitedNodes 不会被超过，且根节点计为第一个节点', () => {
    const result = analyzeFleetLayouts(oneLengthThreeConfig(), noEvidence, {
      maxVisitedNodes: 1,
    })

    expect(result).toMatchObject({
      status: 'limit-reached',
      exactLimitReason: 'max-visited-nodes',
      visitedNodes: 1,
      partialLayouts: 0,
      probabilities: null,
    })
  })

  it('恰好达到 maxLayouts 可 complete，发现下一布局才 limit-reached', () => {
    const exact = analyzeFleetLayouts(oneLengthThreeConfig(), noEvidence, {
      maxLayouts: 6,
    })
    const limited = analyzeFleetLayouts(oneLengthThreeConfig(), noEvidence, {
      maxLayouts: 5,
    })

    expect(exact.status).toBe('complete')
    expect(limited).toMatchObject({
      status: 'limit-reached',
      exactLimitReason: 'max-layouts',
      partialLayouts: 5,
      probabilities: null,
    })
    expect('occupancyCounts' in limited).toBe(false)
    if (limited.status === 'limit-reached') {
      expect(Number.isFinite(limited.partialLayouts)).toBe(true)
      expect(Number.isFinite(limited.visitedNodes)).toBe(true)
    }
  })

  it('相同输入重复运行产生完全确定的统计和节点数', () => {
    const evidence: BoardEvidence = {
      misses: [{ row: 0, column: 0 }],
      occupied: [{ row: 1, column: 1 }],
    }
    const first = analyzeFleetLayouts(oneLengthThreeConfig(), evidence)
    const second = analyzeFleetLayouts(oneLengthThreeConfig(), evidence)

    expect(first).toEqual(second)
  })
})

describe('domain validation and immutability', () => {
  it('重复证据稳定去重，同格冲突则抛出领域错误', () => {
    const duplicateEvidence: BoardEvidence = {
      misses: [
        { row: 0, column: 0 },
        { row: 0, column: 0 },
      ],
      occupied: [],
    }
    expect(analyzeFleetLayouts(oneLengthThreeConfig(), duplicateEvidence)).toEqual(
      analyzeFleetLayouts(oneLengthThreeConfig(), {
        misses: [{ row: 0, column: 0 }],
        occupied: [],
      }),
    )

    expectDomainError(() => {
      analyzeFleetLayouts(oneLengthThreeConfig(), {
        misses: [{ row: 1, column: 1 }],
        occupied: [{ row: 1, column: 1 }],
      })
    }, 'evidence-conflict')
  })

  it('验证越界证据、BoardConfig、FleetConfig 和搜索选项', () => {
    expectDomainError(() =>
      analyzeFleetLayouts(oneLengthThreeConfig(), {
        misses: [{ row: 3, column: 0 }],
        occupied: [],
      }),
    'evidence-out-of-bounds')

    expectDomainError(() =>
      analyzeFleetLayouts(
        { ...oneLengthThreeConfig(), rows: 11 },
        noEvidence,
      ),
    'invalid-board-dimensions')

    expectDomainError(() =>
      analyzeFleetLayouts(
        createConfig(3, 3, { 2: -1, 3: 1, 4: 0, 5: 0 }),
        noEvidence,
      ),
    'invalid-fleet-count')

    expectDomainError(() =>
      analyzeFleetLayouts(
        createConfig(3, 3, { 2: 0, 3: 0, 4: 0, 5: 0 }),
        noEvidence,
      ),
    'empty-fleet')

    expectDomainError(() =>
      analyzeFleetLayouts(
        createConfig(2, 2, { 2: 0, 3: 2, 4: 0, 5: 0 }),
        noEvidence,
      ),
    'fleet-exceeds-board')

    expectDomainError(() =>
      analyzeFleetLayouts(
        createConfig(2, 2, { 2: 0, 3: 1, 4: 0, 5: 0 }),
        noEvidence,
      ),
    'submarine-does-not-fit')

    expectDomainError(() =>
      analyzeFleetLayouts(oneLengthThreeConfig(), noEvidence, {
        maxVisitedNodes: 0,
      }),
    'invalid-search-option')

    expectDomainError(() =>
      analyzeFleetLayouts(oneLengthThreeConfig(), noEvidence, {
        maxLayouts: 1.5,
      }),
    'invalid-search-option')
  })

  it('冻结全部输入后仍正常运行且不修改输入', () => {
    const fleetConfig = Object.freeze<FleetConfig>({ 2: 0, 3: 1, 4: 0, 5: 0 })
    const config = Object.freeze<BoardConfig>({
      rows: 3,
      columns: 3,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig,
    })
    const miss = Object.freeze({ row: 0, column: 0 })
    const occupied = Object.freeze({ row: 1, column: 1 })
    const evidence = Object.freeze<BoardEvidence>({
      misses: Object.freeze([miss]),
      occupied: Object.freeze([occupied]),
    })

    const result = analyzeFleetLayouts(config, evidence)

    expect(result.status).toBe('complete')
    expect(config).toEqual({
      rows: 3,
      columns: 3,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 0, 3: 1, 4: 0, 5: 0 },
    })
    expect(evidence).toEqual({
      misses: [{ row: 0, column: 0 }],
      occupied: [{ row: 1, column: 1 }],
    })
  })
})
