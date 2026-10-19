import { describe, expect, it, vi } from 'vitest'
import type { ProbabilityMatrix } from '../engine/types'
import { createFixedSubmarineFromPlacement } from '../rules/fixedSubmarines'
import { buildPlacementCatalog } from '../rules/placements'
import type { BoardConfig, CellObservation, FixedSubmarine } from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import {
  getProbabilityRecommendation,
  PROBABILITY_TIE_EPSILON,
  ProbabilityRecommendationError,
} from './recommendation'

const config: BoardConfig = {
  rows: 2,
  columns: 3,
  fleetConfig: { 2: 1, 3: 0, 4: 0, 5: 0 },
  adjacencyRule: 'orthogonal-and-diagonal',
}

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(ProbabilityRecommendationError)
  try {
    action()
  } catch (error: unknown) {
    expect(error).toMatchObject({ code })
  }
}

function fillBoard(observation: CellObservation) {
  let board = createBoard(config.rows, config.columns)
  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      if (observation !== 'unknown') {
        board = updateCellState(board, { row, column }, observation)
      }
    }
  }
  return board
}

describe('getProbabilityRecommendation', () => {
  it('选择唯一最高概率的未知格', () => {
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [], [
      [0.1, 0.7, 0.2], [0.3, 0.4, 0.5],
    ])).toEqual({
      position: { row: 0, column: 1 }, probability: 0.7, tiedCandidateCount: 1,
    })
  })

  it.each(['miss', 'hit'] as const)('排除 %s 格，即使其概率为1', (state) => {
    const board = updateCellState(createBoard(2, 3), { row: 0, column: 0 }, state)
    expect(getProbabilityRecommendation(config, board, [], [
      [1, 0.8, 0], [0, 0, 0],
    ])?.position).toEqual({ row: 0, column: 1 })
  })

  it('排除可信解析的固定潜艇格', () => {
    const placement = buildPlacementCatalog(
      config,
      config.fleetConfig,
      config.adjacencyRule,
    )[2]?.[0]
    if (!placement) throw new Error('测试候选缺失')
    const fixed = createFixedSubmarineFromPlacement(placement)
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [fixed], [
      [1, 1, 0.8], [0, 0, 0],
    ])?.position).toEqual({ row: 0, column: 2 })
  })

  it('按行优先选择并列最高的第一个格并统计数量', () => {
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [], [
      [0.8, 0.2, 0.8], [0.8, 0, 0],
    ])).toEqual({
      position: { row: 0, column: 0 }, probability: 0.8, tiedCandidateCount: 3,
    })
  })

  it('以真实全局最大值处理链式 epsilon，而非扫描暂存最大值', () => {
    const epsilon = PROBABILITY_TIE_EPSILON
    const a = 0.5
    const b = a + epsilon * 0.75
    const c = a + epsilon * 1.5
    expect(Math.abs(a - b)).toBeLessThanOrEqual(epsilon)
    expect(Math.abs(b - c)).toBeLessThanOrEqual(epsilon)
    expect(Math.abs(a - c)).toBeGreaterThan(epsilon)
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [], [
      [a, b, c], [0, 0, 0],
    ])).toEqual({
      position: { row: 0, column: 1 }, probability: b, tiedCandidateCount: 2,
    })
  })

  it('明显概率差异不视为并列', () => {
    const result = getProbabilityRecommendation(config, createBoard(2, 3), [], [
      [0.5, 0.5 + PROBABILITY_TIE_EPSILON * 2, 0], [0, 0, 0],
    ])
    expect(result?.position).toEqual({ row: 0, column: 1 })
    expect(result?.tiedCandidateCount).toBe(1)
  })

  it('极小正概率仍是有效推荐候选', () => {
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [], [
      [Number.MIN_VALUE, 0, 0], [0, 0, 0],
    ])).toEqual({
      position: { row: 0, column: 0 },
      probability: Number.MIN_VALUE,
      tiedCandidateCount: 1,
    })
  })

  it('所有候选为0或没有 unknown 时返回 null', () => {
    const zero: ProbabilityMatrix = [[0, 0, 0], [0, 0, 0]]
    expect(getProbabilityRecommendation(config, createBoard(2, 3), [], zero)).toBeNull()
    expect(getProbabilityRecommendation(config, fillBoard('hit'), [], zero)).toBeNull()
  })

  it('按稳定顺序验证 Board、矩阵尺寸和全部概率', () => {
    expectCode(
      () => getProbabilityRecommendation(config, createBoard(1, 3), [], [[0]]),
      'recommendation-board-dimension-mismatch',
    )
    expectCode(
      () => getProbabilityRecommendation(config, createBoard(2, 3), [], [[0]]),
      'recommendation-matrix-dimension-mismatch',
    )
    expectCode(
      () => getProbabilityRecommendation(config, createBoard(2, 3), [], [[0, 0], [0, 0]]),
      'recommendation-matrix-dimension-mismatch',
    )
  })

  it.each([NaN, Infinity, -0.1, 1.1])(
    '非候选格中的非法概率 %s 仍返回稳定错误',
    (invalid) => {
      const board = updateCellState(createBoard(2, 3), { row: 0, column: 0 }, 'miss')
      expectCode(
        () => getProbabilityRecommendation(config, board, [], [
          [invalid, 0, 0], [0, 0, 0],
        ]),
        'recommendation-invalid-probability',
      )
    },
  )

  it('非 number 值以及非法概率与伪造 fixed 同时存在时，优先报告概率错误', () => {
    const invalid: FixedSubmarine = {
      id: 'forged', length: 2, orientation: 'horizontal',
      start: { row: 0, column: 0 },
    }
    const probabilities = [
      ['0.5', 0, 0],
      [0, 0, 0],
    ] as unknown as ProbabilityMatrix
    expectCode(
      () => getProbabilityRecommendation(config, createBoard(2, 3), [invalid], probabilities),
      'recommendation-invalid-probability',
    )
  })

  it('hit 和 fixed 格中的非法概率也不能被忽略', () => {
    const hitBoard = updateCellState(createBoard(2, 3), { row: 0, column: 0 }, 'hit')
    expectCode(
      () => getProbabilityRecommendation(config, hitBoard, [], [[NaN, 0, 0], [0, 0, 0]]),
      'recommendation-invalid-probability',
    )
    const placement = buildPlacementCatalog(
      config,
      config.fleetConfig,
      config.adjacencyRule,
    )[2]?.[0]
    if (!placement) throw new Error('测试候选缺失')
    expectCode(
      () => getProbabilityRecommendation(
        config,
        createBoard(2, 3),
        [createFixedSubmarineFromPlacement(placement)],
        [[Infinity, 0, 0], [0, 0, 0]],
      ),
      'recommendation-invalid-probability',
    )
  })

  it('非法固定潜艇转换为推荐领域错误', () => {
    const invalid: FixedSubmarine = {
      id: 'forged', length: 2, orientation: 'horizontal',
      start: { row: 0, column: 0 },
    }
    expectCode(
      () => getProbabilityRecommendation(config, createBoard(2, 3), [invalid], [
        [0.5, 0, 0], [0, 0, 0],
      ]),
      'recommendation-invalid-fixed-submarine',
    )
  })

  it('冻结输入保持不变，结果确定且不调用 Math.random', () => {
    const frozenConfig = Object.freeze({
      ...config,
      fleetConfig: Object.freeze({ ...config.fleetConfig }),
    })
    const board = Object.freeze(
      createBoard(2, 3).map((row) =>
        Object.freeze(row.map((cell) => Object.freeze(cell))),
      ),
    )
    const probabilities = Object.freeze([
      Object.freeze([0.2, 0.9, 0.9]),
      Object.freeze([0.1, 0, 0]),
    ])
    const random = vi.spyOn(Math, 'random')
    const first = getProbabilityRecommendation(frozenConfig, board, Object.freeze([]), probabilities)
    const second = getProbabilityRecommendation(frozenConfig, board, Object.freeze([]), probabilities)
    expect(second).toEqual(first)
    expect(random).not.toHaveBeenCalled()
  })

  it('输入集合出现顺序改变时仍按地图行列生成相同推荐', () => {
    const largerConfig: BoardConfig = {
      rows: 3,
      columns: 5,
      fleetConfig: { 2: 2, 3: 0, 4: 0, 5: 0 },
      adjacencyRule: 'orthogonal-and-diagonal',
    }
    const placements = buildPlacementCatalog(
      largerConfig,
      largerConfig.fleetConfig,
      largerConfig.adjacencyRule,
    )[2]
    const firstPlacement = placements?.find(
      (placement) => placement.start.row === 0 && placement.start.column === 0,
    )
    const secondPlacement = placements?.find(
      (placement) => placement.start.row === 2 && placement.start.column === 3,
    )
    if (!firstPlacement || !secondPlacement) throw new Error('测试候选缺失')
    const first = createFixedSubmarineFromPlacement(firstPlacement)
    const second = createFixedSubmarineFromPlacement(secondPlacement)
    const probabilities = [
      [0.1, 0.1, 0.2, 0.2, 0.2],
      [0.3, 0.4, 0.9, 0.4, 0.3],
      [0.2, 0.2, 0.2, 0.1, 0.1],
    ]
    const forward = getProbabilityRecommendation(
      largerConfig,
      createBoard(3, 5),
      [first, second],
      probabilities,
    )
    const reversed = getProbabilityRecommendation(
      largerConfig,
      createBoard(3, 5),
      [second, first],
      probabilities,
    )
    expect(reversed).toEqual(forward)
    expect(forward?.position).toEqual({ row: 1, column: 2 })
  })
})
