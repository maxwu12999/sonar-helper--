import { describe, expect, it } from 'vitest'
import type { BoardConfig, FleetConfig } from '../types/game'
import type { BoardAnalysisResult, BoardEvidence } from '../engine/types'
import { handleAnalysisWorkerRequest } from './analysisWorkerHandler'
import {
  INVALID_REQUEST_ID,
  WORKER_PROTOCOL_ERROR_CODE,
  getProtocolDataError,
  isAnalysisWorkerResponse,
  isBoardAnalysisResult,
  type AnalysisWorkerRequest,
} from './analysisWorkerProtocol'

const noEvidence: BoardEvidence = { misses: [], occupied: [] }

function config(
  rows: number,
  columns: number,
  fleetConfig: FleetConfig,
  adjacencyRule: BoardConfig['adjacencyRule'] = 'orthogonal-and-diagonal',
): BoardConfig {
  return { rows, columns, fleetConfig, adjacencyRule }
}

function request(
  requestId: string,
  boardConfig: BoardConfig,
  options?: AnalysisWorkerRequest['options'],
  evidence: BoardEvidence = noEvidence,
): AnalysisWorkerRequest {
  return {
    type: 'analyze',
    requestId,
    config: boardConfig,
    evidence,
    ...(options === undefined ? {} : { options }),
  }
}

function expectResultStatus(
  response: ReturnType<typeof handleAnalysisWorkerRequest>,
  status: BoardAnalysisResult['status'],
): void {
  expect(response.type).toBe('result')
  if (response.type === 'result') expect(response.result.status).toBe(status)
  expect(isAnalysisWorkerResponse(response)).toBe(true)
  expect(getProtocolDataError(response)).toBeNull()
}

describe('analysis worker handler result protocol', () => {
  const lengthThree = config(3, 3, { 2: 0, 3: 1, 4: 0, 5: 0 })

  it('往返 exact、proven-no-layouts 和 exact-limit-reached', () => {
    const exact = handleAnalysisWorkerRequest(
      request('exact-1', lengthThree, { mode: 'exact' }),
    )
    expectResultStatus(exact, 'exact')
    expect(exact.requestId).toBe('exact-1')

    const impossible = config(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    expectResultStatus(
      handleAnalysisWorkerRequest(
        request('none-1', impossible, { mode: 'exact' }),
      ),
      'proven-no-layouts',
    )
    expectResultStatus(
      handleAnalysisWorkerRequest(
        request('limit-1', lengthThree, {
          mode: 'exact',
          exact: { maxVisitedNodes: 1 },
        }),
      ),
      'exact-limit-reached',
    )
  })

  it('往返 direct estimated、fallback estimated 和 unavailable', () => {
    expectResultStatus(
      handleAnalysisWorkerRequest(
        request('estimated-1', lengthThree, {
          mode: 'estimated',
          sampling: { seed: 2, targetAcceptedSamples: 5, maxAttempts: 5 },
        }),
      ),
      'estimated',
    )
    expectResultStatus(
      handleAnalysisWorkerRequest(
        request('fallback-1', lengthThree, {
          mode: 'auto',
          exact: { maxLayouts: 1 },
          sampling: { seed: 3, targetAcceptedSamples: 5, maxAttempts: 5 },
        }),
      ),
      'estimated',
    )
    const impossible = config(
      1,
      4,
      { 2: 2, 3: 0, 4: 0, 5: 0 },
      'orthogonal-only',
    )
    expectResultStatus(
      handleAnalysisWorkerRequest(
        request('unavailable-1', impossible, {
          mode: 'estimated',
          sampling: { seed: 7, targetAcceptedSamples: 1, maxAttempts: 1 },
        }),
      ),
      'unavailable',
    )
  })

  it('fixedPlacements 可传输且冻结输入不被修改', () => {
    const start = Object.freeze({ row: 0, column: 0 })
    const evidence = Object.freeze<BoardEvidence>({
      misses: Object.freeze([]),
      occupied: Object.freeze([]),
      fixedPlacements: Object.freeze([
        Object.freeze({ length: 2, orientation: 'horizontal', start }),
      ]),
    })
    const board = Object.freeze<BoardConfig>({
      rows: 1,
      columns: 5,
      adjacencyRule: 'orthogonal-only',
      fleetConfig: Object.freeze({ 2: 2, 3: 0, 4: 0, 5: 0 }),
    })
    const input = Object.freeze(
      request('fixed-1', board, { mode: 'exact' }, evidence),
    )
    const response = handleAnalysisWorkerRequest(input)

    expectResultStatus(response, 'exact')
    expect(evidence.fixedPlacements?.[0].start).toEqual({ row: 0, column: 0 })
    expect(getProtocolDataError(input)).toBeNull()
    expect(getProtocolDataError(response)).toBeNull()
  })

  it('领域错误保留 name、message 和稳定 code', () => {
    const response = handleAnalysisWorkerRequest(
      request('error-1', lengthThree, {
        mode: 'exact',
        exact: { maxLayouts: 0 },
      }),
    )
    expect(response.type).toBe('error')
    if (response.type === 'error') {
      expect(response.requestId).toBe('error-1')
      expect(response.error.name).toBe('LayoutAnalysisError')
      expect(response.error.code).toBe('invalid-search-option')
      expect(response.error.message.length).toBeGreaterThan(0)
    }
  })

  it('非法、bigint 和循环消息返回受控协议错误', () => {
    const circular: Record<string, unknown> = { type: 'analyze', requestId: 'cycle-1' }
    circular.self = circular
    for (const input of [
      { type: 'other', requestId: 'bad-1' },
      { type: 'analyze', requestId: 'big-1', config: { rows: 1n } },
      circular,
      null,
    ]) {
      const response = handleAnalysisWorkerRequest(input)
      expect(response.type).toBe('error')
      if (response.type === 'error') {
        expect(response.error.name).toBe('AnalysisWorkerProtocolError')
        expect(response.error.code).toBe(WORKER_PROTOCOL_ERROR_CODE)
      }
    }
    expect(handleAnalysisWorkerRequest(null).requestId).toBe(INVALID_REQUEST_ID)
  })

  it('未知异常和畸形分析结果不会泄漏或进入结果协议', () => {
    const unknown = handleAnalysisWorkerRequest(
      request('unknown-1', lengthThree),
      () => {
        throw { secret: 'do-not-expose' }
      },
    )
    expect(unknown).toMatchObject({
      type: 'error',
      requestId: 'unknown-1',
      error: {
        name: 'AnalysisWorkerError',
        message: '分析 Worker 执行期间发生未知错误',
      },
    })

    const malformed = handleAnalysisWorkerRequest(
      request('malformed-1', lengthThree),
      () => ({ status: 'exact' }) as BoardAnalysisResult,
    )
    expect(malformed).toMatchObject({
      type: 'error',
      error: { code: WORKER_PROTOCOL_ERROR_CODE },
    })
  })
})

describe('board result runtime validation', () => {
  it('逐一验证七种联合分支的关键字段', () => {
    const probability = [[1]] as const
    const results: readonly BoardAnalysisResult[] = [
      { status: 'exact', probabilities: probability, occupancyCounts: [[1]], totalLayouts: 1, visitedNodes: 1 },
      { status: 'proven-no-layouts', probabilities: null, visitedNodes: 1 },
      { status: 'exact-limit-reached', probabilities: null, exactLimitReason: 'max-layouts', visitedNodes: 2, partialLayouts: 1 },
      { status: 'estimated', origin: 'direct', probabilities: probability, seed: 1, attemptedSamples: 1, acceptedSamples: 1, failedAttempts: 0, targetReached: true, effectiveSampleSize: 1, maxWeightFraction: 1 },
      { status: 'estimated', origin: 'exact-limit-fallback', fallbackReason: 'exact-limit-reached', exactLimitReason: 'max-layouts', exactVisitedNodes: 2, exactPartialLayouts: 1, probabilities: probability, seed: 1, attemptedSamples: 1, acceptedSamples: 1, failedAttempts: 0, targetReached: true, effectiveSampleSize: 1, maxWeightFraction: 1 },
      { status: 'unavailable', origin: 'direct', reason: 'sampling-no-samples', probabilities: null, seed: 1, attemptedSamples: 1, acceptedSamples: 0, failedAttempts: 1, targetReached: false, effectiveSampleSize: 0, maxWeightFraction: null },
      { status: 'unavailable', origin: 'exact-limit-fallback', fallbackReason: 'exact-limit-reached', exactLimitReason: 'max-visited-nodes', exactVisitedNodes: 1, exactPartialLayouts: 0, reason: 'sampling-no-samples', probabilities: null, seed: 1, attemptedSamples: 1, acceptedSamples: 0, failedAttempts: 1, targetReached: false, effectiveSampleSize: 0, maxWeightFraction: null },
    ]
    for (const result of results) expect(isBoardAnalysisResult(result)).toBe(true)
    expect(isBoardAnalysisResult({ ...results[0], probabilities: [[2]] })).toBe(false)
    expect(isBoardAnalysisResult({ ...results[3], origin: 'other' })).toBe(false)
    expect(isBoardAnalysisResult({ ...results[3], exactVisitedNodes: 1 })).toBe(false)
    expect(isBoardAnalysisResult({ ...results[6], exactLimitReason: undefined })).toBe(false)
  })
})
