import type { BoardConfig } from '../types/game'
import {
  analyzeFleetLayouts,
  validateLayoutSearchOptions,
} from './layoutAnalysis'
import {
  estimateFleetLayouts,
  validateLayoutSamplingOptions,
} from './layoutSampling'
import {
  LayoutAnalysisError,
  type BoardAnalysisOptions,
  type BoardAnalysisResult,
  type BoardEvidence,
  type EstimatedLayoutSamplingAnalysis,
  type LayoutSamplingOptions,
  type LimitReachedAnalysis,
  type NoSamplesLayoutSamplingAnalysis,
} from './types'

export const DEFAULT_ANALYSIS_MODE = 'auto'
export const DEFAULT_AUTO_MAX_VISITED_NODES = 100_000
export const DEFAULT_AUTO_MAX_LAYOUTS = 25_000

function validateBoardAnalysisOptions(
  options: BoardAnalysisOptions | undefined,
): void {
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new LayoutAnalysisError(
      'invalid-board-analysis-option',
      '统一分析选项必须是有效对象',
    )
  }
  const mode = options?.mode ?? DEFAULT_ANALYSIS_MODE
  if (mode !== 'exact' && mode !== 'estimated' && mode !== 'auto') {
    throw new LayoutAnalysisError(
      'invalid-board-analysis-option',
      'mode 必须是 exact、estimated 或 auto',
    )
  }
}

function mapEstimated(
  result: EstimatedLayoutSamplingAnalysis,
): EstimatedLayoutSamplingAnalysis {
  return {
    status: 'estimated',
    seed: result.seed,
    attemptedSamples: result.attemptedSamples,
    acceptedSamples: result.acceptedSamples,
    failedAttempts: result.failedAttempts,
    targetReached: result.targetReached,
    effectiveSampleSize: result.effectiveSampleSize,
    maxWeightFraction: result.maxWeightFraction,
    probabilities: result.probabilities,
  }
}

function mapUnavailable(
  result: NoSamplesLayoutSamplingAnalysis,
): Omit<NoSamplesLayoutSamplingAnalysis, 'status'> & {
  readonly status: 'unavailable'
  readonly reason: 'sampling-no-samples'
} {
  return {
    status: 'unavailable',
    reason: 'sampling-no-samples',
    seed: result.seed,
    attemptedSamples: result.attemptedSamples,
    acceptedSamples: 0,
    failedAttempts: result.failedAttempts,
    targetReached: false,
    effectiveSampleSize: 0,
    maxWeightFraction: null,
    probabilities: null,
  }
}

function runDirectSampling(
  config: BoardConfig,
  evidence: BoardEvidence,
  options: LayoutSamplingOptions | undefined,
): BoardAnalysisResult {
  const sampling = estimateFleetLayouts(config, evidence, options)
  if (sampling.status === 'estimated') {
    return { ...mapEstimated(sampling), origin: 'direct' }
  }
  return { ...mapUnavailable(sampling), origin: 'direct' }
}

function runFallbackSampling(
  config: BoardConfig,
  evidence: BoardEvidence,
  options: LayoutSamplingOptions | undefined,
  exact: LimitReachedAnalysis,
): BoardAnalysisResult {
  const sampling = estimateFleetLayouts(config, evidence, options)
  const fallback = {
    origin: 'exact-limit-fallback',
    fallbackReason: 'exact-limit-reached',
    exactLimitReason: exact.exactLimitReason,
    exactVisitedNodes: exact.visitedNodes,
    exactPartialLayouts: exact.partialLayouts,
  } as const
  if (sampling.status === 'estimated') {
    return { ...mapEstimated(sampling), ...fallback }
  }
  return { ...mapUnavailable(sampling), ...fallback }
}

export function analyzeBoard(
  config: BoardConfig,
  evidence: BoardEvidence,
  options?: BoardAnalysisOptions,
): BoardAnalysisResult {
  validateBoardAnalysisOptions(options)
  const mode = options?.mode ?? DEFAULT_ANALYSIS_MODE

  if (mode === 'estimated') {
    return runDirectSampling(config, evidence, options?.sampling)
  }

  if (mode === 'exact') {
    const exact = analyzeFleetLayouts(config, evidence, options?.exact)
    if (exact.status === 'complete') {
      return {
        status: 'exact',
        probabilities: exact.probabilities,
        occupancyCounts: exact.occupancyCounts,
        totalLayouts: exact.totalLayouts,
        visitedNodes: exact.visitedNodes,
      }
    }
    if (exact.status === 'no-layouts') {
      return {
        status: 'proven-no-layouts',
        probabilities: null,
        visitedNodes: exact.visitedNodes,
      }
    }
    return {
      status: 'exact-limit-reached',
      probabilities: null,
      exactLimitReason: exact.exactLimitReason,
      visitedNodes: exact.visitedNodes,
      partialLayouts: exact.partialLayouts,
    }
  }

  // auto 的两个子选项必须在任何计算开始前同时通过验证。
  validateLayoutSearchOptions(options?.exact)
  validateLayoutSamplingOptions(options?.sampling)
  const exactOptions = {
    maxVisitedNodes:
      options?.exact?.maxVisitedNodes ?? DEFAULT_AUTO_MAX_VISITED_NODES,
    maxLayouts: options?.exact?.maxLayouts ?? DEFAULT_AUTO_MAX_LAYOUTS,
  }
  const exact = analyzeFleetLayouts(config, evidence, exactOptions)
  if (exact.status === 'complete') {
    return {
      status: 'exact',
      probabilities: exact.probabilities,
      occupancyCounts: exact.occupancyCounts,
      totalLayouts: exact.totalLayouts,
      visitedNodes: exact.visitedNodes,
    }
  }
  if (exact.status === 'no-layouts') {
    return {
      status: 'proven-no-layouts',
      probabilities: null,
      visitedNodes: exact.visitedNodes,
    }
  }
  return runFallbackSampling(config, evidence, options?.sampling, exact)
}
