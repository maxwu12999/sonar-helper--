import type { ProbabilityMatrix } from '../engine/types'
import {
  FixedSubmarineDomainError,
  resolveFixedSubmarinePlacements,
} from '../rules/fixedSubmarines'
import type {
  Board,
  BoardConfig,
  FixedSubmarine,
  Position,
} from '../types/game'

export const PROBABILITY_TIE_EPSILON = 1e-12

export interface ProbabilityRecommendation {
  readonly position: Position
  readonly probability: number
  readonly tiedCandidateCount: number
}

export type ProbabilityRecommendationErrorCode =
  | 'recommendation-board-dimension-mismatch'
  | 'recommendation-matrix-dimension-mismatch'
  | 'recommendation-invalid-probability'
  | 'recommendation-invalid-fixed-submarine'

export class ProbabilityRecommendationError extends Error {
  readonly code: ProbabilityRecommendationErrorCode

  constructor(code: ProbabilityRecommendationErrorCode, message: string) {
    super(message)
    this.name = 'ProbabilityRecommendationError'
    this.code = code
  }
}

interface AttackCandidate {
  readonly position: Position
  readonly probability: number
}

function cellIndex(position: Position, columns: number): number {
  return position.row * columns + position.column
}

function validateBoardDimensions(config: BoardConfig, board: Board): void {
  if (
    board.length !== config.rows ||
    board.some((row) => row.length !== config.columns)
  ) {
    throw new ProbabilityRecommendationError(
      'recommendation-board-dimension-mismatch',
      '地图尺寸与当前配置不一致',
    )
  }
}

function validateProbabilityMatrix(
  config: BoardConfig,
  probabilities: ProbabilityMatrix,
): void {
  if (
    probabilities.length !== config.rows ||
    probabilities.some((row) => row.length !== config.columns)
  ) {
    throw new ProbabilityRecommendationError(
      'recommendation-matrix-dimension-mismatch',
      '概率矩阵尺寸与当前地图不一致',
    )
  }

  for (const row of probabilities) {
    for (const probability of row) {
      if (
        typeof probability !== 'number' ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        throw new ProbabilityRecommendationError(
          'recommendation-invalid-probability',
          '概率矩阵包含无效数值',
        )
      }
    }
  }
}

function getFixedCellIndexes(
  config: BoardConfig,
  fixedSubmarines: readonly FixedSubmarine[],
): ReadonlySet<number> {
  try {
    const placements = resolveFixedSubmarinePlacements(config, fixedSubmarines)
    return new Set(
      placements.flatMap((placement) =>
        placement.occupiedCells.map((position) =>
          cellIndex(position, config.columns),
        ),
      ),
    )
  } catch (error: unknown) {
    if (error instanceof FixedSubmarineDomainError) {
      throw new ProbabilityRecommendationError(
        'recommendation-invalid-fixed-submarine',
        '固定潜艇证据无法按当前规则解析',
      )
    }
    throw error
  }
}

export function getProbabilityRecommendation(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
  probabilities: ProbabilityMatrix,
): ProbabilityRecommendation | null {
  validateBoardDimensions(config, board)
  validateProbabilityMatrix(config, probabilities)
  const fixedCellIndexes = getFixedCellIndexes(config, fixedSubmarines)
  const candidates: AttackCandidate[] = []

  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      const probability = probabilities[row][column]
      if (
        board[row][column].state === 'unknown' &&
        !fixedCellIndexes.has(row * config.columns + column) &&
        probability > 0
      ) {
        candidates.push({ position: { row, column }, probability })
      }
    }
  }

  if (candidates.length === 0) return null

  let globalMaximum = candidates[0].probability
  for (let index = 1; index < candidates.length; index += 1) {
    globalMaximum = Math.max(globalMaximum, candidates[index].probability)
  }

  const tiedCandidates = candidates.filter(
    (candidate) =>
      Math.abs(candidate.probability - globalMaximum) <=
      PROBABILITY_TIE_EPSILON,
  )
  const selected = tiedCandidates[0]
  return {
    position: selected.position,
    probability: selected.probability,
    tiedCandidateCount: tiedCandidates.length,
  }
}
