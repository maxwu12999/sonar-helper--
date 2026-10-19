import { describe, expect, it } from 'vitest'
import type { BoardConfig } from '../types/game'
import { analyzeFleetLayouts } from './layoutAnalysis'
import type { BoardEvidence } from './types'

const config: BoardConfig = {
  rows: 3,
  columns: 3,
  adjacencyRule: 'orthogonal-and-diagonal',
  fleetConfig: { 2: 0, 3: 1, 4: 0, 5: 0 },
}

describe('exact engine preprocessing refactor regression', () => {
  it('保持无证据小型案例的布局数、概率和搜索节点', () => {
    const result = analyzeFleetLayouts(config, { misses: [], occupied: [] })

    expect(result.status).toBe('complete')
    expect(result.visitedNodes).toBe(7)
    if (result.status === 'complete') {
      expect(result.totalLayouts).toBe(6)
      expect(result.probabilities).toEqual([
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
        [1 / 3, 1 / 3, 1 / 3],
      ])
    }
  })

  it('保持 occupied 证据的布局数、概率和搜索节点', () => {
    const evidence: BoardEvidence = {
      misses: [],
      occupied: [{ row: 1, column: 1 }],
    }
    const result = analyzeFleetLayouts(config, evidence)

    expect(result.status).toBe('complete')
    expect(result.visitedNodes).toBe(7)
    if (result.status === 'complete') {
      expect(result.totalLayouts).toBe(2)
      expect(result.probabilities).toEqual([
        [0, 0.5, 0],
        [0.5, 1, 0.5],
        [0, 0.5, 0],
      ])
    }
  })

  it('保持全部固定潜艇的行为和根节点定义', () => {
    const result = analyzeFleetLayouts(
      { ...config, rows: 5, columns: 5 },
      {
        misses: [],
        occupied: [],
        fixedPlacements: [
          { length: 3, orientation: 'horizontal', start: { row: 2, column: 1 } },
        ],
      },
    )

    expect(result.status).toBe('complete')
    expect(result.visitedNodes).toBe(1)
    if (result.status === 'complete') {
      expect(result.totalLayouts).toBe(1)
      expect(result.probabilities[2]).toEqual([0, 1, 1, 1, 0])
    }
  })
})
