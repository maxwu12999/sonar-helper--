import type { BoardConfig } from '../types/game'
import { ImportanceAccumulator } from './importanceAccumulator'
import {
  canRemainingShipsCoverEvidence,
  prepareLayoutProblem,
  type EngineCandidate,
} from './layoutProblem'
import { createSeededRandom } from './seededRandom'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type LayoutSamplingAnalysis,
  type LayoutSamplingOptions,
  type ProbabilityMatrix,
} from './types'

export const DEFAULT_SAMPLING_SEED = 0x5eed1234
export const DEFAULT_TARGET_ACCEPTED_SAMPLES = 10_000
export const DEFAULT_MAX_ATTEMPTS = 100_000

interface ResolvedSamplingOptions {
  readonly seed: number
  readonly targetAcceptedSamples: number
  readonly maxAttempts: number
}

interface CandidateChoice {
  readonly candidate: EngineCandidate
  readonly nextGroupIndex: number
  readonly nextRemainingInGroup: number
  readonly nextCandidateIndex: number
  readonly nextOccupiedMask: bigint
  readonly nextBlockedMask: bigint
}

function validatePositiveOption(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new LayoutAnalysisError(
      'invalid-sampling-option',
      `${name} 必须是正安全整数`,
    )
  }
  return value
}

function resolveSamplingOptions(
  options: LayoutSamplingOptions | undefined,
): ResolvedSamplingOptions {
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new LayoutAnalysisError(
      'invalid-sampling-option',
      '采样选项必须是有效对象',
    )
  }
  const seed = options?.seed ?? DEFAULT_SAMPLING_SEED
  if (
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffff_ffff
  ) {
    throw new LayoutAnalysisError(
      'invalid-sampling-option',
      'seed 必须是 0～2^32-1 的整数',
    )
  }
  return {
    seed,
    targetAcceptedSamples: validatePositiveOption(
      options?.targetAcceptedSamples ?? DEFAULT_TARGET_ACCEPTED_SAMPLES,
      'targetAcceptedSamples',
    ),
    maxAttempts: validatePositiveOption(
      options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      'maxAttempts',
    ),
  }
}

export function validateLayoutSamplingOptions(
  options: LayoutSamplingOptions | undefined,
): void {
  resolveSamplingOptions(options)
}

function toProbabilityMatrix(
  flat: readonly number[],
  rows: number,
  columns: number,
): ProbabilityMatrix {
  return Array.from({ length: rows }, (_, row) =>
    flat.slice(row * columns, (row + 1) * columns),
  )
}

export function estimateFleetLayouts(
  config: BoardConfig,
  evidence: BoardEvidence,
  options?: LayoutSamplingOptions,
): LayoutSamplingAnalysis {
  const resolved = resolveSamplingOptions(options)
  const problem = prepareLayoutProblem(config, evidence)
  const random = createSeededRandom(resolved.seed)
  const accumulator = new ImportanceAccumulator(problem.cellCount)
  let attemptedSamples = 0
  let acceptedSamples = 0

  while (
    attemptedSamples < resolved.maxAttempts &&
    acceptedSamples < resolved.targetAcceptedSamples
  ) {
    attemptedSamples += 1
    let groupIndex = 0
    let remainingInGroup = problem.groups[0]?.count ?? 0
    let nextCandidateIndex = 0
    let occupiedMask = problem.initialOccupiedMask
    let blockedMask = problem.initialBlockedMask
    let logWeight = 0
    let failed = false

    while (groupIndex < problem.groups.length) {
      const group = problem.groups[groupIndex]
      const lastCandidateIndex =
        group.candidates.length - remainingInGroup
      const feasibleChoices: CandidateChoice[] = []

      // 必须先完整构造 A_t，再记录其大小并进行随机选择。
      for (
        let candidateIndex = nextCandidateIndex;
        candidateIndex <= lastCandidateIndex;
        candidateIndex += 1
      ) {
        const candidate = group.candidates[candidateIndex]
        if ((candidate.occupiedMask & blockedMask) !== 0n) continue

        const nextOccupiedMask = occupiedMask | candidate.occupiedMask
        const nextBlockedMask = blockedMask | candidate.blockedMask
        const nextGroupIndex =
          remainingInGroup === 1 ? groupIndex + 1 : groupIndex
        const nextRemainingInGroup =
          remainingInGroup === 1
            ? (problem.groups[nextGroupIndex]?.count ?? 0)
            : remainingInGroup - 1
        const followingCandidateIndex =
          remainingInGroup === 1 ? 0 : candidateIndex + 1

        // 只使用共享的数学必要条件；false 表示该分支不可能完成。
        if (
          !canRemainingShipsCoverEvidence(
            problem,
            nextGroupIndex,
            nextRemainingInGroup,
            followingCandidateIndex,
            nextOccupiedMask,
            nextBlockedMask,
          )
        ) {
          continue
        }

        feasibleChoices.push({
          candidate,
          nextGroupIndex,
          nextRemainingInGroup,
          nextCandidateIndex: followingCandidateIndex,
          nextOccupiedMask,
          nextBlockedMask,
        })
      }

      if (feasibleChoices.length === 0) {
        failed = true
        break
      }

      // q_t = 1 / |A_t|，所以 logWeight 累加 log(|A_t|)。
      logWeight += Math.log(feasibleChoices.length)
      const selected = feasibleChoices[random.nextInt(feasibleChoices.length)]
      groupIndex = selected.nextGroupIndex
      remainingInGroup = selected.nextRemainingInGroup
      nextCandidateIndex = selected.nextCandidateIndex
      occupiedMask = selected.nextOccupiedMask
      blockedMask = selected.nextBlockedMask
    }

    if (
      !failed &&
      (occupiedMask & problem.requiredOccupiedMask) ===
        problem.requiredOccupiedMask
    ) {
      accumulator.add(logWeight, occupiedMask)
      acceptedSamples += 1
    }
  }

  const failedAttempts = attemptedSamples - acceptedSamples
  const targetReached =
    acceptedSamples >= resolved.targetAcceptedSamples
  const summary = accumulator.summarize()
  if (!summary) {
    return {
      status: 'no-samples',
      seed: resolved.seed,
      attemptedSamples,
      acceptedSamples: 0,
      failedAttempts,
      targetReached: false,
      effectiveSampleSize: 0,
      maxWeightFraction: null,
      probabilities: null,
    }
  }

  return {
    status: 'estimated',
    seed: resolved.seed,
    attemptedSamples,
    acceptedSamples,
    failedAttempts,
    targetReached,
    effectiveSampleSize: summary.effectiveSampleSize,
    maxWeightFraction: summary.maxWeightFraction,
    probabilities: toProbabilityMatrix(
      summary.probabilities,
      config.rows,
      config.columns,
    ),
  }
}
