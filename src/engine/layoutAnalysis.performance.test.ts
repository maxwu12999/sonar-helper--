import { describe, expect, it } from 'vitest'
import type { BoardConfig } from '../types/game'
import { analyzeFleetLayouts } from './layoutAnalysis'
import type { BoardEvidence, LayoutSearchOptions } from './types'

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>
}

const performanceTest =
  process.env.RUN_LAYOUT_PERFORMANCE === '1' ? it : it.skip
const evidence: BoardEvidence = { misses: [], occupied: [] }
const options: Required<LayoutSearchOptions> = {
  maxVisitedNodes: 200_000,
  maxLayouts: 50_000,
}

const syntheticCases: readonly {
  readonly name: string
  readonly config: BoardConfig
}[] = [
  {
    name: '合成压力测试 6×6',
    config: {
      rows: 6,
      columns: 6,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 1, 4: 0, 5: 0 },
    },
  },
  {
    name: '合成压力测试 8×8',
    config: {
      rows: 8,
      columns: 8,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 2, 4: 1, 5: 0 },
    },
  },
  {
    name: '合成压力测试 10×10',
    config: {
      rows: 10,
      columns: 10,
      adjacencyRule: 'orthogonal-and-diagonal',
      fleetConfig: { 2: 2, 3: 2, 4: 1, 5: 1 },
    },
  },
]

describe('layout analysis synthetic performance', () => {
  performanceTest.each(syntheticCases)(
    '$name',
    ({ name, config }) => {
      const startedAt = performance.now()
      const result = analyzeFleetLayouts(config, evidence, options)
      const durationMs = performance.now() - startedAt
      const layouts =
        result.status === 'limit-reached'
          ? result.partialLayouts
          : result.totalLayouts
      const hitMaxVisitedNodes =
        result.status === 'limit-reached' &&
        result.visitedNodes === options.maxVisitedNodes
      const hitMaxLayouts =
        result.status === 'limit-reached' &&
        result.partialLayouts === options.maxLayouts

      console.info(
        JSON.stringify({
          benchmark: name,
          status: result.status,
          visitedNodes: result.visitedNodes,
          layouts,
          durationMs: Number(durationMs.toFixed(2)),
          hitMaxVisitedNodes,
          hitMaxLayouts,
        }),
      )

      expect(['complete', 'no-layouts', 'limit-reached']).toContain(result.status)
      expect(result.visitedNodes).toBeLessThanOrEqual(options.maxVisitedNodes)
      expect(Number.isFinite(durationMs)).toBe(true)
      expect(Number.isFinite(layouts)).toBe(true)
      if (result.status === 'limit-reached') {
        expect(result.partialLayouts).toBeLessThanOrEqual(options.maxLayouts)
      }
    },
    120_000,
  )
})
