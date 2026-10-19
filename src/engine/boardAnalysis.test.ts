import { describe, expect, it } from 'vitest'
import type { BoardConfig, FleetConfig } from '../types/game'
import {
  analyzeBoard,
  DEFAULT_ANALYSIS_MODE,
  DEFAULT_AUTO_MAX_LAYOUTS,
  DEFAULT_AUTO_MAX_VISITED_NODES,
} from './boardAnalysis'
import {
  analyzeFleetLayouts,
  DEFAULT_MAX_LAYOUTS,
  DEFAULT_MAX_VISITED_NODES,
} from './layoutAnalysis'
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_SAMPLING_SEED,
  DEFAULT_TARGET_ACCEPTED_SAMPLES,
  estimateFleetLayouts,
} from './layoutSampling'
import {
  LayoutAnalysisError,
  type BoardAnalysisOptions,
  type BoardEvidence,
  type LayoutAnalysisErrorCode,
  type LayoutSamplingOptions,
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

function lengthThreeConfig(): BoardConfig {
  return createConfig(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })
}

function expectDomainError(
  action: () => void,
  code: LayoutAnalysisErrorCode,
): void {
  try {
    action()
    throw new Error(`Expected domain error: ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LayoutAnalysisError)
    if (error instanceof LayoutAnalysisError) expect(error.code).toBe(code)
  }
}

function expectSamplingFieldsEqual(
  board: ReturnType<typeof analyzeBoard>,
  sampling: ReturnType<typeof estimateFleetLayouts>,
): void {
  expect(board.status).toBe(sampling.status === 'estimated' ? 'estimated' : 'unavailable')
  if (board.status !== 'estimated' && board.status !== 'unavailable') return
  expect(board.seed).toBe(sampling.seed)
  expect(board.attemptedSamples).toBe(sampling.attemptedSamples)
  expect(board.acceptedSamples).toBe(sampling.acceptedSamples)
  expect(board.failedAttempts).toBe(sampling.failedAttempts)
  expect(board.targetReached).toBe(sampling.targetReached)
  expect(board.effectiveSampleSize).toBe(sampling.effectiveSampleSize)
  expect(board.maxWeightFraction).toBe(sampling.maxWeightFraction)
  expect(board.probabilities).toEqual(sampling.probabilities)
}

describe('board analysis mode orchestration', () => {
  it('exact 模式与直接精确引擎结果完全一致', () => {
    const config = lengthThreeConfig()
    const evidence = { misses: [{ row: 0, column: 0 }], occupied: [] } as const
    const options = { maxVisitedNodes: 500, maxLayouts: 20 } as const
    const direct = analyzeFleetLayouts(config, evidence, options)
    const board = analyzeBoard(config, evidence, { mode: 'exact', exact: options })

    expect(direct.status).toBe('complete')
    expect(board.status).toBe('exact')
    if (direct.status === 'complete' && board.status === 'exact') {
      expect(board.probabilities).toEqual(direct.probabilities)
      expect(board.occupancyCounts).toEqual(direct.occupancyCounts)
      expect(board.totalLayouts).toBe(direct.totalLayouts)
      expect(board.visitedNodes).toBe(direct.visitedNodes)
    }
  })

  it('estimated 模式与直接采样引擎结果完全一致且无精确字段', () => {
    const config = lengthThreeConfig()
    const samplingOptions = {
      seed: 42,
      targetAcceptedSamples: 100,
      maxAttempts: 200,
    } as const
    const direct = estimateFleetLayouts(config, noEvidence, samplingOptions)
    const board = analyzeBoard(config, noEvidence, {
      mode: 'estimated',
      sampling: samplingOptions,
    })

    expectSamplingFieldsEqual(board, direct)
    expect(board).toMatchObject({ status: 'estimated', origin: 'direct' })
    expect('exactVisitedNodes' in board).toBe(false)
    expect('exactPartialLayouts' in board).toBe(false)
    expect('totalLayouts' in board).toBe(false)
  })

  it('auto 小案例精确完成，字段与相同限制的直接精确结果一致', () => {
    const config = lengthThreeConfig()
    const exactOptions = { maxVisitedNodes: 500, maxLayouts: 20 } as const
    const direct = analyzeFleetLayouts(config, noEvidence, exactOptions)
    const board = analyzeBoard(config, noEvidence, {
      mode: 'auto',
      exact: exactOptions,
      sampling: { seed: 3, targetAcceptedSamples: 10, maxAttempts: 10 },
    })

    expect(direct.status).toBe('complete')
    expect(board.status).toBe('exact')
    if (direct.status === 'complete' && board.status === 'exact') {
      expect(board).toEqual({
        status: 'exact',
        probabilities: direct.probabilities,
        occupancyCounts: direct.occupancyCounts,
        totalLayouts: direct.totalLayouts,
        visitedNodes: direct.visitedNodes,
      })
    }
  })

  it('auto 对严格无解案例只返回 proven-no-layouts', () => {
    const config = createConfig(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = analyzeBoard(config, noEvidence, { mode: 'auto' })

    expect(result).toMatchObject({
      status: 'proven-no-layouts',
      probabilities: null,
    })
  })

  it('auto 达到布局限制后回退，采样值等于直接采样并保留限制诊断', () => {
    const config = lengthThreeConfig()
    const exactOptions = { maxLayouts: 1 } as const
    const samplingOptions = {
      seed: 2026,
      targetAcceptedSamples: 100,
      maxAttempts: 100,
    } as const
    const exact = analyzeFleetLayouts(config, noEvidence, exactOptions)
    const sampling = estimateFleetLayouts(config, noEvidence, samplingOptions)
    const board = analyzeBoard(config, noEvidence, {
      mode: 'auto',
      exact: exactOptions,
      sampling: samplingOptions,
    })

    expect(exact.status).toBe('limit-reached')
    expectSamplingFieldsEqual(board, sampling)
    expect(board).toMatchObject({
      status: 'estimated',
      origin: 'exact-limit-fallback',
      fallbackReason: 'exact-limit-reached',
      exactLimitReason: 'max-layouts',
    })
    if (
      exact.status === 'limit-reached' &&
      (board.status === 'estimated' || board.status === 'unavailable') &&
      board.origin === 'exact-limit-fallback'
    ) {
      expect(board.exactVisitedNodes).toBe(exact.visitedNodes)
      expect(board.exactPartialLayouts).toBe(exact.partialLayouts)
    }
  })

  it('确定性失败采样在 auto 回退后返回 unavailable 而不是无解证明', () => {
    const config = createConfig(
      1,
      6,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const samplingOptions = {
      seed: 1,
      targetAcceptedSamples: 1,
      maxAttempts: 1,
    } as const
    const direct = estimateFleetLayouts(config, noEvidence, samplingOptions)
    expect(direct.status).toBe('no-samples')

    const result = analyzeBoard(config, noEvidence, {
      mode: 'auto',
      exact: { maxLayouts: 1 },
      sampling: samplingOptions,
    })
    expectSamplingFieldsEqual(result, direct)
    expect(result).toMatchObject({
      status: 'unavailable',
      origin: 'exact-limit-fallback',
      probabilities: null,
      exactLimitReason: 'max-layouts',
    })
    expect(result.status).not.toBe('proven-no-layouts')
  })

  it('exact 达到节点限制时返回原因且不执行采样', () => {
    const result = analyzeBoard(lengthThreeConfig(), noEvidence, {
      mode: 'exact',
      exact: { maxVisitedNodes: 1 },
      sampling: { seed: -1 },
    })

    expect(result).toEqual({
      status: 'exact-limit-reached',
      probabilities: null,
      exactLimitReason: 'max-visited-nodes',
      visitedNodes: 1,
      partialLayouts: 0,
    })
  })

  it('estimated 的 no-samples 返回 unavailable，不能声称严格无解', () => {
    const config = createConfig(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = analyzeBoard(config, noEvidence, {
      mode: 'estimated',
      sampling: { seed: 7, targetAcceptedSamples: 1, maxAttempts: 1 },
    })

    expect(result).toMatchObject({
      status: 'unavailable',
      origin: 'direct',
      reason: 'sampling-no-samples',
      probabilities: null,
    })
  })
})

describe('board analysis validation, evidence and defaults', () => {
  it('只验证当前执行模式使用的子选项', () => {
    expect(() =>
      analyzeBoard(lengthThreeConfig(), noEvidence, {
        mode: 'exact',
        sampling: { seed: -1 },
      }),
    ).not.toThrow()
    expect(() =>
      analyzeBoard(lengthThreeConfig(), noEvidence, {
        mode: 'estimated',
        exact: { maxLayouts: 0 },
        sampling: { seed: 1, targetAcceptedSamples: 1, maxAttempts: 1 },
      }),
    ).not.toThrow()
  })

  it('auto 在计算前验证两个子选项并保留底层稳定错误码', () => {
    expectDomainError(() =>
      analyzeBoard(lengthThreeConfig(), noEvidence, {
        mode: 'auto',
        exact: { maxLayouts: 0 },
      }),
    'invalid-search-option')
    expectDomainError(() =>
      analyzeBoard(lengthThreeConfig(), noEvidence, {
        mode: 'auto',
        sampling: { seed: -1 },
      }),
    'invalid-sampling-option')

    const invalidConfig = { ...lengthThreeConfig(), rows: 11 }
    expectDomainError(() =>
      analyzeBoard(invalidConfig, noEvidence, {
        mode: 'auto',
        sampling: { maxAttempts: 0 },
      }),
    'invalid-sampling-option')
  })

  it('无效 mode 使用统一编排领域错误', () => {
    const options = { mode: 'other' } as unknown as BoardAnalysisOptions
    expectDomainError(
      () => analyzeBoard(lengthThreeConfig(), noEvidence, options),
      'invalid-board-analysis-option',
    )
  })

  it('固定潜艇和 miss 在三种模式中维持概率不变量', () => {
    const config = createConfig(
      1,
      5,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const evidence: BoardEvidence = {
      misses: [{ row: 0, column: 2 }],
      occupied: [],
      fixedPlacements: [
        { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      ],
    }
    const exact = analyzeBoard(config, evidence, { mode: 'exact' })
    const estimated = analyzeBoard(config, evidence, {
      mode: 'estimated',
      sampling: { seed: 9, targetAcceptedSamples: 10, maxAttempts: 10 },
    })
    const auto = analyzeBoard(config, evidence, { mode: 'auto' })

    for (const result of [exact, estimated, auto]) {
      expect(result.status === 'exact' || result.status === 'estimated').toBe(true)
      if (result.status === 'exact' || result.status === 'estimated') {
        expect(result.probabilities[0][0]).toBe(1)
        expect(result.probabilities[0][1]).toBe(1)
        expect(result.probabilities[0][2]).toBe(0)
        expect(result.probabilities[0].reduce((sum, value) => sum + value, 0)).toBeCloseTo(4)
      }
    }
  })

  it('相同 auto 输入与 seed 完全可复现，且不修改冻结输入', () => {
    const fleet = Object.freeze<FleetConfig>({ 2: 0, 3: 1, 4: 0, 5: 0 })
    const config = Object.freeze<BoardConfig>({
      rows: 3,
      columns: 3,
      fleetConfig: fleet,
      adjacencyRule: 'orthogonal-and-diagonal',
    })
    const evidence = Object.freeze<BoardEvidence>({
      misses: Object.freeze([Object.freeze({ row: 0, column: 0 })]),
      occupied: Object.freeze([]),
    })
    const sampling = Object.freeze<LayoutSamplingOptions>({
      seed: 99,
      targetAcceptedSamples: 20,
      maxAttempts: 20,
    })
    const options = Object.freeze<BoardAnalysisOptions>({
      mode: 'auto',
      exact: Object.freeze({ maxLayouts: 1 }),
      sampling,
    })

    expect(analyzeBoard(config, evidence, options)).toEqual(
      analyzeBoard(config, evidence, options),
    )
    expect(options.exact).toEqual({ maxLayouts: 1 })
    expect(evidence.misses).toEqual([{ row: 0, column: 0 }])
  })

  it('公开并保持计划中的默认值', () => {
    expect(DEFAULT_ANALYSIS_MODE).toBe('auto')
    expect(DEFAULT_MAX_VISITED_NODES).toBe(1_000_000)
    expect(DEFAULT_MAX_LAYOUTS).toBe(100_000)
    expect(DEFAULT_SAMPLING_SEED).toBe(0x5eed1234)
    expect(DEFAULT_TARGET_ACCEPTED_SAMPLES).toBe(10_000)
    expect(DEFAULT_MAX_ATTEMPTS).toBe(100_000)
    expect(DEFAULT_AUTO_MAX_VISITED_NODES).toBe(100_000)
    expect(DEFAULT_AUTO_MAX_LAYOUTS).toBe(25_000)
    expect(analyzeBoard(lengthThreeConfig(), noEvidence).status).toBe('exact')
  })
})
