import type { BoardConfig } from '../types/game'
import {
  LayoutAnalysisError,
  type BoardAnalysisOptions,
  type BoardAnalysisResult,
  type BoardEvidence,
  type LayoutAnalysisErrorCode,
  type ProbabilityMatrix,
} from '../engine/types'

export const INVALID_REQUEST_ID = 'invalid-request'
export const WORKER_PROTOCOL_ERROR_CODE = 'invalid-analysis-worker-protocol'

export interface AnalysisWorkerRequest {
  readonly type: 'analyze'
  readonly requestId: string
  readonly config: BoardConfig
  readonly evidence: BoardEvidence
  readonly options?: BoardAnalysisOptions
}

export interface SerializedAnalysisError {
  readonly name: string
  readonly message: string
  readonly code?: string
}

export type AnalysisWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly result: BoardAnalysisResult
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly error: SerializedAnalysisError
    }

const DOMAIN_ERROR_CODES: ReadonlySet<string> = new Set<LayoutAnalysisErrorCode>([
  'invalid-board-dimensions',
  'invalid-adjacency-rule',
  'invalid-fleet-count',
  'empty-fleet',
  'fleet-exceeds-board',
  'submarine-does-not-fit',
  'invalid-evidence',
  'evidence-out-of-bounds',
  'evidence-conflict',
  'invalid-fixed-placement',
  'fixed-placement-out-of-bounds',
  'fixed-placement-count-exceeded',
  'fixed-placement-conflict',
  'fixed-placement-miss-conflict',
  'invalid-search-option',
  'invalid-sampling-option',
  'invalid-board-analysis-option',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}

export function getProtocolDataError(value: unknown): string | null {
  const activeObjects = new WeakSet<object>()

  function visit(current: unknown): string | null {
    if (typeof current === 'bigint') return 'Worker 协议不允许 bigint'
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'number' ||
      typeof current === 'boolean' ||
      typeof current === 'undefined'
    ) {
      return null
    }
    if (typeof current !== 'object') return 'Worker 协议只允许普通数据'
    if (activeObjects.has(current)) return 'Worker 协议不允许循环引用'
    const prototype = Object.getPrototypeOf(current)
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      return 'Worker 协议只允许普通对象和数组'
    }
    activeObjects.add(current)
    const values = Array.isArray(current) ? current : Object.values(current)
    for (const child of values) {
      const error = visit(child)
      if (error) return error
    }
    activeObjects.delete(current)
    return null
  }

  return visit(value)
}

function isProbabilityMatrix(value: unknown): value is ProbabilityMatrix {
  if (!Array.isArray(value) || value.length === 0) return false
  let columns: number | null = null
  for (const row of value) {
    if (!Array.isArray(row) || row.length === 0) return false
    columns ??= row.length
    if (row.length !== columns) return false
    if (!row.every((cell) => isFiniteRange(cell, 0, 1))) return false
  }
  return true
}

function isOccupancyMatrix(value: unknown, rows: number, columns: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === rows &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === columns &&
        row.every(isNonNegativeInteger),
    )
  )
}

function hasSamplingDiagnostics(value: Record<string, unknown>): boolean {
  return (
    isNonNegativeInteger(value.seed) &&
    value.seed <= 0xffff_ffff &&
    isNonNegativeInteger(value.attemptedSamples) &&
    isNonNegativeInteger(value.acceptedSamples) &&
    value.acceptedSamples <= value.attemptedSamples &&
    value.failedAttempts === value.attemptedSamples - value.acceptedSamples &&
    typeof value.targetReached === 'boolean' &&
    typeof value.effectiveSampleSize === 'number' &&
    Number.isFinite(value.effectiveSampleSize) &&
    value.effectiveSampleSize >= 0
  )
}

function hasDirectOrigin(value: Record<string, unknown>): boolean {
  return (
    value.origin === 'direct' &&
    !('fallbackReason' in value) &&
    !('exactLimitReason' in value) &&
    !('exactVisitedNodes' in value) &&
    !('exactPartialLayouts' in value)
  )
}

function hasFallbackDiagnostics(value: Record<string, unknown>): boolean {
  return (
    value.origin === 'exact-limit-fallback' &&
    value.fallbackReason === 'exact-limit-reached' &&
    (value.exactLimitReason === 'max-visited-nodes' ||
      value.exactLimitReason === 'max-layouts') &&
    isNonNegativeInteger(value.exactVisitedNodes) &&
    isNonNegativeInteger(value.exactPartialLayouts)
  )
}

export function isBoardAnalysisResult(value: unknown): value is BoardAnalysisResult {
  if (getProtocolDataError(value) !== null || !isRecord(value)) return false
  switch (value.status) {
    case 'exact': {
      if (
        !isProbabilityMatrix(value.probabilities) ||
        !isPositiveInteger(value.totalLayouts) ||
        !isNonNegativeInteger(value.visitedNodes)
      ) {
        return false
      }
      return isOccupancyMatrix(
        value.occupancyCounts,
        value.probabilities.length,
        value.probabilities[0].length,
      )
    }
    case 'proven-no-layouts':
      return value.probabilities === null && isNonNegativeInteger(value.visitedNodes)
    case 'exact-limit-reached':
      return (
        value.probabilities === null &&
        (value.exactLimitReason === 'max-visited-nodes' ||
          value.exactLimitReason === 'max-layouts') &&
        isNonNegativeInteger(value.visitedNodes) &&
        isNonNegativeInteger(value.partialLayouts)
      )
    case 'estimated':
      return (
        hasSamplingDiagnostics(value) &&
        (value.acceptedSamples as number) > 0 &&
        (value.effectiveSampleSize as number) > 0 &&
        isFiniteRange(value.maxWeightFraction, 0, 1) &&
        value.maxWeightFraction > 0 &&
        isProbabilityMatrix(value.probabilities) &&
        (hasDirectOrigin(value) || hasFallbackDiagnostics(value))
      )
    case 'unavailable':
      return (
        hasSamplingDiagnostics(value) &&
        value.reason === 'sampling-no-samples' &&
        value.acceptedSamples === 0 &&
        value.targetReached === false &&
        value.effectiveSampleSize === 0 &&
        value.maxWeightFraction === null &&
        value.probabilities === null &&
        (hasDirectOrigin(value) || hasFallbackDiagnostics(value))
      )
    default:
      return false
  }
}

export function getAnalysisWorkerRequestError(value: unknown): string | null {
  const dataError = getProtocolDataError(value)
  if (dataError) return dataError
  if (!isRecord(value) || value.type !== 'analyze') return 'Worker 请求类型无效'
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    return 'Worker requestId 必须是非空字符串'
  }
  if (!isRecord(value.config)) return 'Worker config 必须是对象'
  if (!isRecord(value.evidence)) return 'Worker evidence 必须是对象'
  if (value.options !== undefined && !isRecord(value.options)) {
    return 'Worker options 必须是对象'
  }
  return null
}

export function isAnalysisWorkerResponse(value: unknown): value is AnalysisWorkerResponse {
  if (getProtocolDataError(value) !== null || !isRecord(value)) return false
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) return false
  if (value.type === 'result') return isBoardAnalysisResult(value.result)
  if (value.type !== 'error' || !isRecord(value.error)) return false
  return (
    typeof value.error.name === 'string' &&
    value.error.name.length > 0 &&
    typeof value.error.message === 'string' &&
    (value.error.code === undefined || typeof value.error.code === 'string')
  )
}

export function extractWorkerRequestId(value: unknown): string {
  if (isRecord(value) && typeof value.requestId === 'string' && value.requestId.length > 0) {
    return value.requestId
  }
  return INVALID_REQUEST_ID
}

export function serializeAnalysisError(error: unknown): SerializedAnalysisError {
  if (error instanceof LayoutAnalysisError) {
    return { name: error.name, message: error.message, code: error.code }
  }
  return {
    name: 'AnalysisWorkerError',
    message: '分析 Worker 执行期间发生未知错误',
  }
}

export function isLayoutAnalysisErrorCode(code: string): code is LayoutAnalysisErrorCode {
  return DOMAIN_ERROR_CODES.has(code)
}
