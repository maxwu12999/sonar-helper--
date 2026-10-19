import { describe, expect, it } from 'vitest'
import type { BoardConfig } from '../types/game'
import { estimateFleetLayouts } from './layoutSampling'
import type { BoardEvidence, LayoutSamplingOptions } from './types'

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>
}

const performanceTest =
  process.env.RUN_LAYOUT_SAMPLING_PERFORMANCE === '1' ? it : it.skip
const evidence: BoardEvidence = { misses: [], occupied: [] }
const options = {
  seed: 20_260_716,
  targetAcceptedSamples: 5_000,
  maxAttempts: 50_000,
} as const satisfies Required<LayoutSamplingOptions>

const syntheticCases: readonly {
  readonly name: string
  readonly config: BoardConfig
}[] = [
  {
    name: '采样合成压力测试 6×6',
    config: {
      rows: 6,
      columns: 6,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 1, 4: 0, 5: 0 },
    },
  },
  {
    name: '采样合成压力测试 8×8',
    config: {
      rows: 8,
      columns: 8,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 2, 4: 1, 5: 0 },
    },
  },
  {
    name: '采样合成压力测试 10×10',
    config: {
      rows: 10,
      columns: 10,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 2, 4: 1, 5: 1 },
    },
  },
]

describe('layout sampling synthetic performance', () => {
  performanceTest.each(syntheticCases)(
    '$name',
    ({ name, config }) => {
      const startedAt = performance.now()
      const result = estimateFleetLayouts(config, evidence, options)
      const durationMs = performance.now() - startedAt
      const acceptanceRate =
        result.attemptedSamples === 0
          ? 0
          : result.acceptedSamples / result.attemptedSamples

      console.info(
        JSON.stringify({
          benchmark: name,
          seed: result.seed,
          attemptedSamples: result.attemptedSamples,
          acceptedSamples: result.acceptedSamples,
          failedAttempts: result.failedAttempts,
          acceptanceRate: Number(acceptanceRate.toFixed(6)),
          targetReached: result.targetReached,
          effectiveSampleSize: Number(result.effectiveSampleSize.toFixed(2)),
          maxWeightFraction:
            result.maxWeightFraction === null
              ? null
              : Number(result.maxWeightFraction.toFixed(8)),
          durationMs: Number(durationMs.toFixed(2)),
        }),
      )

      expect(result.attemptedSamples).toBeLessThanOrEqual(options.maxAttempts)
      expect(result.acceptedSamples).toBeLessThanOrEqual(result.attemptedSamples)
      expect(result.failedAttempts).toBe(
        result.attemptedSamples - result.acceptedSamples,
      )
      expect(result.targetReached).toBe(
        result.acceptedSamples >= options.targetAcceptedSamples,
      )
      expect(Number.isFinite(durationMs)).toBe(true)
      expect(Number.isFinite(result.effectiveSampleSize)).toBe(true)
    },
    120_000,
  )
})
