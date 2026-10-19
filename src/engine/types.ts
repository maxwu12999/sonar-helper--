import type {
  Orientation,
  Position,
  SubmarineLength,
} from '../types/game'

export interface FixedPlacementEvidence {
  readonly length: SubmarineLength
  readonly orientation: Orientation
  readonly start: Position
}

export interface BoardEvidence {
  readonly misses: readonly Position[]
  readonly occupied: readonly Position[]
  readonly fixedPlacements?: readonly FixedPlacementEvidence[]
}

export interface LayoutSearchOptions {
  readonly maxVisitedNodes?: number
  readonly maxLayouts?: number
}

export interface LayoutSamplingOptions {
  readonly seed?: number
  readonly targetAcceptedSamples?: number
  readonly maxAttempts?: number
}

export type AnalysisMode = 'exact' | 'estimated' | 'auto'

export interface BoardAnalysisOptions {
  readonly mode?: AnalysisMode
  readonly exact?: LayoutSearchOptions
  readonly sampling?: LayoutSamplingOptions
}

export type OccupancyCountMatrix = readonly (readonly number[])[]
export type ProbabilityMatrix = readonly (readonly number[])[]

export type ExactLimitReason = 'max-visited-nodes' | 'max-layouts'

interface LayoutAnalysisBase {
  readonly visitedNodes: number
}

export interface CompleteLayoutAnalysis extends LayoutAnalysisBase {
  readonly status: 'complete'
  readonly totalLayouts: number
  readonly occupancyCounts: OccupancyCountMatrix
  readonly probabilities: ProbabilityMatrix
}

export interface NoLayoutsAnalysis extends LayoutAnalysisBase {
  readonly status: 'no-layouts'
  readonly totalLayouts: 0
  readonly occupancyCounts: OccupancyCountMatrix
  readonly probabilities: null
}

export interface LimitReachedAnalysis extends LayoutAnalysisBase {
  readonly status: 'limit-reached'
  readonly exactLimitReason: ExactLimitReason
  readonly partialLayouts: number
  readonly probabilities: null
}

export type LayoutAnalysis =
  | CompleteLayoutAnalysis
  | NoLayoutsAnalysis
  | LimitReachedAnalysis

interface LayoutSamplingAnalysisBase {
  readonly seed: number
  readonly attemptedSamples: number
  readonly acceptedSamples: number
  readonly failedAttempts: number
  readonly targetReached: boolean
  readonly effectiveSampleSize: number
}

export interface EstimatedLayoutSamplingAnalysis
  extends LayoutSamplingAnalysisBase {
  readonly status: 'estimated'
  readonly maxWeightFraction: number
  readonly probabilities: ProbabilityMatrix
}

export interface NoSamplesLayoutSamplingAnalysis
  extends LayoutSamplingAnalysisBase {
  readonly status: 'no-samples'
  readonly acceptedSamples: 0
  readonly targetReached: false
  readonly effectiveSampleSize: 0
  readonly maxWeightFraction: null
  readonly probabilities: null
}

export type LayoutSamplingAnalysis =
  | EstimatedLayoutSamplingAnalysis
  | NoSamplesLayoutSamplingAnalysis

interface SamplingDiagnostics {
  readonly seed: number
  readonly attemptedSamples: number
  readonly acceptedSamples: number
  readonly failedAttempts: number
  readonly targetReached: boolean
  readonly effectiveSampleSize: number
  readonly maxWeightFraction: number
}

export interface ExactBoardAnalysis {
  readonly status: 'exact'
  readonly probabilities: ProbabilityMatrix
  readonly occupancyCounts: OccupancyCountMatrix
  readonly totalLayouts: number
  readonly visitedNodes: number
}

export interface ProvenNoLayoutsBoardAnalysis {
  readonly status: 'proven-no-layouts'
  readonly probabilities: null
  readonly visitedNodes: number
}

export interface ExactLimitReachedBoardAnalysis {
  readonly status: 'exact-limit-reached'
  readonly probabilities: null
  readonly exactLimitReason: ExactLimitReason
  readonly visitedNodes: number
  readonly partialLayouts: number
}

export interface DirectEstimatedBoardAnalysis extends SamplingDiagnostics {
  readonly status: 'estimated'
  readonly origin: 'direct'
  readonly probabilities: ProbabilityMatrix
}

interface ExactLimitFallbackDiagnostics {
  readonly origin: 'exact-limit-fallback'
  readonly fallbackReason: 'exact-limit-reached'
  readonly exactLimitReason: ExactLimitReason
  readonly exactVisitedNodes: number
  readonly exactPartialLayouts: number
}

export interface FallbackEstimatedBoardAnalysis
  extends SamplingDiagnostics,
    ExactLimitFallbackDiagnostics {
  readonly status: 'estimated'
  readonly probabilities: ProbabilityMatrix
}

interface UnavailableSamplingDiagnostics {
  readonly seed: number
  readonly attemptedSamples: number
  readonly acceptedSamples: 0
  readonly failedAttempts: number
  readonly targetReached: false
  readonly effectiveSampleSize: 0
  readonly maxWeightFraction: null
  readonly probabilities: null
}

export interface DirectUnavailableBoardAnalysis
  extends UnavailableSamplingDiagnostics {
  readonly status: 'unavailable'
  readonly origin: 'direct'
  readonly reason: 'sampling-no-samples'
}

export interface FallbackUnavailableBoardAnalysis
  extends UnavailableSamplingDiagnostics,
    ExactLimitFallbackDiagnostics {
  readonly status: 'unavailable'
  readonly reason: 'sampling-no-samples'
}

export type BoardAnalysisResult =
  | ExactBoardAnalysis
  | ProvenNoLayoutsBoardAnalysis
  | ExactLimitReachedBoardAnalysis
  | DirectEstimatedBoardAnalysis
  | FallbackEstimatedBoardAnalysis
  | DirectUnavailableBoardAnalysis
  | FallbackUnavailableBoardAnalysis

export type LayoutAnalysisErrorCode =
  | 'invalid-board-dimensions'
  | 'invalid-adjacency-rule'
  | 'invalid-fleet-count'
  | 'empty-fleet'
  | 'fleet-exceeds-board'
  | 'submarine-does-not-fit'
  | 'invalid-evidence'
  | 'evidence-out-of-bounds'
  | 'evidence-conflict'
  | 'invalid-fixed-placement'
  | 'fixed-placement-out-of-bounds'
  | 'fixed-placement-count-exceeded'
  | 'fixed-placement-conflict'
  | 'fixed-placement-miss-conflict'
  | 'invalid-search-option'
  | 'invalid-sampling-option'
  | 'invalid-board-analysis-option'

export class LayoutAnalysisError extends Error {
  readonly code: LayoutAnalysisErrorCode

  constructor(code: LayoutAnalysisErrorCode, message: string) {
    super(message)
    this.name = 'LayoutAnalysisError'
    this.code = code
  }
}
