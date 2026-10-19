import {
  canRemainingShipsCoverEvidence,
  createNumberMatrix,
  prepareLayoutProblem,
} from './layoutProblem'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type ExactLimitReason,
  type LayoutAnalysis,
  type LayoutSearchOptions,
  type OccupancyCountMatrix,
  type ProbabilityMatrix,
} from './types'
import type { BoardConfig } from '../types/game'

export const DEFAULT_MAX_VISITED_NODES = 1_000_000
export const DEFAULT_MAX_LAYOUTS = 100_000

interface ResolvedSearchOptions {
  readonly maxVisitedNodes: number
  readonly maxLayouts: number
}

function resolveSearchLimit(
  value: number | undefined,
  fallback: number,
  optionName: keyof LayoutSearchOptions,
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LayoutAnalysisError(
      'invalid-search-option',
      `${optionName} 必须是正安全整数`,
    )
  }
  return value
}

function resolveSearchOptions(
  options: LayoutSearchOptions | undefined,
): ResolvedSearchOptions {
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new LayoutAnalysisError(
      'invalid-search-option',
      '搜索选项必须是有效对象',
    )
  }
  return {
    maxVisitedNodes: resolveSearchLimit(
      options?.maxVisitedNodes,
      DEFAULT_MAX_VISITED_NODES,
      'maxVisitedNodes',
    ),
    maxLayouts: resolveSearchLimit(
      options?.maxLayouts,
      DEFAULT_MAX_LAYOUTS,
      'maxLayouts',
    ),
  }
}

export function validateLayoutSearchOptions(
  options: LayoutSearchOptions | undefined,
): void {
  resolveSearchOptions(options)
}

export function analyzeFleetLayouts(
  config: BoardConfig,
  evidence: BoardEvidence,
  options?: LayoutSearchOptions,
): LayoutAnalysis {
  const resolvedOptions = resolveSearchOptions(options)
  const problem = prepareLayoutProblem(config, evidence)
  const occupancyCounts = createNumberMatrix(config.rows, config.columns)
  let visitedNodes = 0
  let totalLayouts = 0
  let exactLimitReason: ExactLimitReason | null = null

  function recordLayout(occupiedMask: bigint): void {
    if (totalLayouts >= resolvedOptions.maxLayouts) {
      exactLimitReason = 'max-layouts'
      return
    }
    totalLayouts += 1
    for (let index = 0; index < problem.cellCount; index += 1) {
      if ((occupiedMask & problem.cellMasks[index]) !== 0n) {
        const row = Math.floor(index / config.columns)
        const column = index % config.columns
        occupancyCounts[row][column] += 1
      }
    }
  }

  function search(
    groupIndex: number,
    remainingInGroup: number,
    nextCandidateIndex: number,
    occupiedMask: bigint,
    currentBlockedMask: bigint,
  ): void {
    if (exactLimitReason !== null) return
    if (visitedNodes >= resolvedOptions.maxVisitedNodes) {
      exactLimitReason = 'max-visited-nodes'
      return
    }
    visitedNodes += 1

    if (groupIndex === problem.groups.length) {
      if (
        (occupiedMask & problem.requiredOccupiedMask) ===
        problem.requiredOccupiedMask
      ) {
        recordLayout(occupiedMask)
      }
      return
    }

    const group = problem.groups[groupIndex]
    if (group.candidates.length - nextCandidateIndex < remainingInGroup) {
      return
    }
    if (
      !canRemainingShipsCoverEvidence(
        problem,
        groupIndex,
        remainingInGroup,
        nextCandidateIndex,
        occupiedMask,
        currentBlockedMask,
      )
    ) {
      return
    }

    const lastCandidateIndex = group.candidates.length - remainingInGroup
    for (
      let candidateIndex = nextCandidateIndex;
      candidateIndex <= lastCandidateIndex;
      candidateIndex += 1
    ) {
      const candidate = group.candidates[candidateIndex]
      if ((candidate.occupiedMask & currentBlockedMask) !== 0n) continue
      const nextOccupiedMask = occupiedMask | candidate.occupiedMask
      const nextBlockedMask = currentBlockedMask | candidate.blockedMask

      if (remainingInGroup === 1) {
        const nextGroupIndex = groupIndex + 1
        search(
          nextGroupIndex,
          problem.groups[nextGroupIndex]?.count ?? 0,
          0,
          nextOccupiedMask,
          nextBlockedMask,
        )
      } else {
        search(
          groupIndex,
          remainingInGroup - 1,
          candidateIndex + 1,
          nextOccupiedMask,
          nextBlockedMask,
        )
      }
      if (exactLimitReason !== null) return
    }
  }

  search(
    0,
    problem.groups[0]?.count ?? 0,
    0,
    problem.initialOccupiedMask,
    problem.initialBlockedMask,
  )

  if (exactLimitReason !== null) {
    return {
      status: 'limit-reached',
      exactLimitReason,
      visitedNodes,
      partialLayouts: totalLayouts,
      probabilities: null,
    }
  }
  const readonlyCounts: OccupancyCountMatrix = occupancyCounts
  if (totalLayouts === 0) {
    return {
      status: 'no-layouts',
      totalLayouts: 0,
      visitedNodes,
      occupancyCounts: readonlyCounts,
      probabilities: null,
    }
  }
  const probabilities: ProbabilityMatrix = occupancyCounts.map((row) =>
    row.map((count) => count / totalLayouts),
  )
  return {
    status: 'complete',
    totalLayouts,
    visitedNodes,
    occupancyCounts: readonlyCounts,
    probabilities,
  }
}
