import { describe, expect, it } from 'vitest'
import { getAnalysisWorkerRequestError, getProtocolDataError } from '../workers/analysisWorkerProtocol'
import { createFixedSubmarineFromPlacement, FixedSubmarineDomainError } from '../rules/fixedSubmarines'
import { generatePlacements } from '../rules/placements'
import type { BoardConfig, FixedSubmarine } from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import { buildBoardEvidence } from './boardEvidence'

const config: BoardConfig = {
  rows: 2,
  columns: 5,
  adjacencyRule: 'orthogonal-only',
  fleetConfig: { 2: 2, 3: 0, 4: 0, 5: 0 },
}

function fixed(): FixedSubmarine {
  const placement = generatePlacements(config, 2, config.adjacencyRule).find(
    (candidate) =>
      candidate.orientation === 'horizontal' &&
      candidate.start.row === 0 &&
      candidate.start.column === 0,
  )!
  return createFixedSubmarineFromPlacement(placement)
}

describe('buildBoardEvidence', () => {
  it('转换 miss/hit/unknown 和 fixedPlacements，并过滤固定范围内 hit', () => {
    let board = createBoard(2, 5)
    board = updateCellState(board, { row: 0, column: 0 }, 'hit')
    board = updateCellState(board, { row: 0, column: 3 }, 'hit')
    board = updateCellState(board, { row: 1, column: 4 }, 'miss')
    const evidence = buildBoardEvidence(config, board, [fixed()])

    expect(evidence).toEqual({
      misses: [{ row: 1, column: 4 }],
      occupied: [{ row: 0, column: 3 }],
      fixedPlacements: [
        { length: 2, orientation: 'horizontal', start: { row: 0, column: 0 } },
      ],
    })
    expect(getProtocolDataError(evidence)).toBeNull()
    expect(getAnalysisWorkerRequestError({
      type: 'analyze',
      requestId: 'evidence-v08-1',
      config,
      evidence,
      options: { mode: 'exact' },
    })).toBeNull()
  })

  it('通过 config 和规则目录校验 id，无法映射时抛稳定领域错误', () => {
    const invalid = { ...fixed(), id: 'caller-forged-id' }
    expect(() => buildBoardEvidence(config, createBoard(2, 5), [invalid])).toThrow(
      FixedSubmarineDomainError,
    )
    try {
      buildBoardEvidence(config, createBoard(2, 5), [invalid])
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: 'fixed-submarine-placement-not-found',
      })
    }
  })

  it('删除固定潜艇后原 hit 自动重新进入 occupied', () => {
    const board = updateCellState(createBoard(2, 5), { row: 0, column: 0 }, 'hit')
    expect(buildBoardEvidence(config, board, [fixed()]).occupied).toEqual([])
    expect(buildBoardEvidence(config, board, []).occupied).toEqual([
      { row: 0, column: 0 },
    ])
  })

  it('冻结输入正常运行、输出稳定且不修改输入', () => {
    const board = Object.freeze(createBoard(2, 5).map((row) => Object.freeze(row)))
    const submarine = Object.freeze({
      ...fixed(),
      start: Object.freeze(fixed().start),
    })
    const first = buildBoardEvidence(config, board, Object.freeze([submarine]))
    const second = buildBoardEvidence(config, board, Object.freeze([submarine]))
    expect(first).toEqual(second)
    expect(submarine.id).toBe('length-2-horizontal-row-0-column-0')
  })
})
