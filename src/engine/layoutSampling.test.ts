import { describe, expect, it } from 'vitest'
import type { BoardConfig, FleetConfig } from '../types/game'
import { analyzeFleetLayouts } from './layoutAnalysis'
import { estimateFleetLayouts } from './layoutSampling'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type LayoutSamplingAnalysis,
  type ProbabilityMatrix,
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

function expectSamplingInvariants(result: LayoutSamplingAnalysis, maxAttempts: number): void {
  expect(result.attemptedSamples).toBeLessThanOrEqual(maxAttempts)
  expect(result.acceptedSamples).toBeLessThanOrEqual(result.attemptedSamples)
  expect(result.failedAttempts).toBe(
    result.attemptedSamples - result.acceptedSamples,
  )
}

function expectMatricesClose(
  estimated: ProbabilityMatrix,
  exact: ProbabilityMatrix,
  tolerance: number,
): void {
  for (let row = 0; row < exact.length; row += 1) {
    for (let column = 0; column < exact[row].length; column += 1) {
      expect(Math.abs(estimated[row][column] - exact[row][column])).toBeLessThan(
        tolerance,
      )
    }
  }
}

describe('layout sampling', () => {
  it('相同输入和 seed 产生完全确定的结果', () => {
    const config = createConfig(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })
    const options = {
      seed: 42,
      targetAcceptedSamples: 2_000,
      maxAttempts: 2_000,
    } as const

    expect(estimateFleetLayouts(config, noEvidence, options)).toEqual(
      estimateFleetLayouts(config, noEvidence, options),
    )
  })

  it('满足采样计数和 targetReached 不变量', () => {
    const config = createConfig(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })
    const reached = estimateFleetLayouts(config, noEvidence, {
      seed: 1,
      targetAcceptedSamples: 100,
      maxAttempts: 200,
    })
    const notReached = estimateFleetLayouts(config, noEvidence, {
      seed: 1,
      targetAcceptedSamples: 100,
      maxAttempts: 40,
    })

    expectSamplingInvariants(reached, 200)
    expect(reached.targetReached).toBe(reached.acceptedSamples >= 100)
    expect(reached.targetReached).toBe(true)
    expectSamplingInvariants(notReached, 40)
    expect(notReached.targetReached).toBe(notReached.acceptedSamples >= 100)
    expect(notReached.targetReached).toBe(false)
  })

  it('不均匀 proposal 的多艇案例经重要性加权后接近精确概率', () => {
    const config = createConfig(
      1,
      7,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const exact = analyzeFleetLayouts(config, noEvidence)
    const estimated = estimateFleetLayouts(config, noEvidence, {
      seed: 2026,
      targetAcceptedSamples: 20_000,
      maxAttempts: 40_000,
    })

    expect(exact.status).toBe('complete')
    expect(estimated.status).toBe('estimated')
    if (exact.status === 'complete' && estimated.status === 'estimated') {
      expect(exact.totalLayouts).toBe(6)
      expectMatricesClose(estimated.probabilities, exact.probabilities, 0.02)
      // 未加权的局部均匀 proposal 在该案例上会产生远大于此阈值的偏差。
      expect(estimated.effectiveSampleSize).toBeLessThan(estimated.acceptedSamples)
      expect(estimated.maxWeightFraction).toBeGreaterThan(0)
    }
  })

  it('无成功样本时返回严格 no-samples 联合成员', () => {
    const config = createConfig(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    const result = estimateFleetLayouts(config, noEvidence, {
      seed: 7,
      targetAcceptedSamples: 10,
      maxAttempts: 25,
    })

    expect(result).toEqual({
      status: 'no-samples',
      seed: 7,
      attemptedSamples: 25,
      acceptedSamples: 0,
      failedAttempts: 25,
      targetReached: false,
      effectiveSampleSize: 0,
      maxWeightFraction: null,
      probabilities: null,
    })
  })

  it('固定证据和冻结输入保持可用且不被修改', () => {
    const fleet = Object.freeze<FleetConfig>({ 2: 2, 3: 0, 4: 0, 5: 0 })
    const config = Object.freeze<BoardConfig>({
      rows: 1,
      columns: 5,
      adjacencyRule: 'orthogonal-only',
      fleetConfig: fleet,
    })
    const start = Object.freeze({ row: 0, column: 0 })
    const evidence = Object.freeze<BoardEvidence>({
      misses: Object.freeze([]),
      occupied: Object.freeze([]),
      fixedPlacements: Object.freeze([
        Object.freeze({ length: 2, orientation: 'horizontal', start }),
      ]),
    })
    const result = estimateFleetLayouts(config, evidence, {
      seed: 9,
      targetAcceptedSamples: 50,
      maxAttempts: 100,
    })

    expect(result.status).toBe('estimated')
    expect(evidence.fixedPlacements?.[0].start).toEqual({ row: 0, column: 0 })
  })

  it('引擎验证所有采样选项，同时允许目标大于尝试上限', () => {
    const config = createConfig(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })
    for (const options of [
      { seed: -1 },
      { seed: 0x1_0000_0000 },
      { seed: 1.5 },
      { targetAcceptedSamples: 0 },
      { targetAcceptedSamples: 1.5 },
      { maxAttempts: 0 },
      { maxAttempts: 1.5 },
    ]) {
      expect(() => estimateFleetLayouts(config, noEvidence, options)).toThrow(
        LayoutAnalysisError,
      )
    }

    const allowed = estimateFleetLayouts(config, noEvidence, {
      seed: 0,
      targetAcceptedSamples: 10,
      maxAttempts: 2,
    })
    expect(allowed.attemptedSamples).toBe(2)
    expect(allowed.targetReached).toBe(false)
  })
})
