import { analyzeBoard } from '../engine/boardAnalysis'
import type { BoardAnalysisResult } from '../engine/types'
import {
  WORKER_PROTOCOL_ERROR_CODE,
  extractWorkerRequestId,
  getAnalysisWorkerRequestError,
  getProtocolDataError,
  isBoardAnalysisResult,
  type AnalysisWorkerRequest,
  type AnalysisWorkerResponse,
  serializeAnalysisError,
} from './analysisWorkerProtocol'

type BoardAnalyzer = (
  config: AnalysisWorkerRequest['config'],
  evidence: AnalysisWorkerRequest['evidence'],
  options?: AnalysisWorkerRequest['options'],
) => BoardAnalysisResult

export function handleAnalysisWorkerRequest(
  input: unknown,
  analyzer: BoardAnalyzer = analyzeBoard,
): AnalysisWorkerResponse {
  const requestId = extractWorkerRequestId(input)
  const requestError = getAnalysisWorkerRequestError(input)
  if (requestError) {
    return {
      type: 'error',
      requestId,
      error: {
        name: 'AnalysisWorkerProtocolError',
        message: requestError,
        code: WORKER_PROTOCOL_ERROR_CODE,
      },
    }
  }

  const request = input as AnalysisWorkerRequest
  try {
    const result = analyzer(request.config, request.evidence, request.options)
    const resultError = getProtocolDataError(result)
    if (resultError || !isBoardAnalysisResult(result)) {
      return {
        type: 'error',
        requestId,
        error: {
          name: 'AnalysisWorkerProtocolError',
          message: resultError ?? '分析结果不符合 Worker 响应协议',
          code: WORKER_PROTOCOL_ERROR_CODE,
        },
      }
    }
    return { type: 'result', requestId, result }
  } catch (error: unknown) {
    return { type: 'error', requestId, error: serializeAnalysisError(error) }
  }
}
