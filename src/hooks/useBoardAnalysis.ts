import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { buildBoardEvidence } from '../adapters/boardEvidence'
import type {
  BoardAnalysisOptions,
  BoardAnalysisResult,
  BoardEvidence,
  ProbabilityMatrix,
} from '../engine/types'
import { LayoutAnalysisError } from '../engine/types'
import { FixedSubmarineDomainError } from '../rules/fixedSubmarines'
import type { Board, BoardConfig, FixedSubmarine } from '../types/game'
import {
  AnalysisWorkerCancelledError,
  AnalysisWorkerClient,
  AnalysisWorkerCreationError,
  AnalysisWorkerDisposedError,
  AnalysisWorkerPostMessageError,
  AnalysisWorkerProtocolError,
  AnalysisWorkerRemoteError,
  AnalysisWorkerRuntimeError,
} from '../workers/analysisWorkerClient'

export interface BoardAnalysisClient {
  analyze(
    config: BoardConfig,
    evidence: BoardEvidence,
    options?: BoardAnalysisOptions,
  ): Promise<BoardAnalysisResult>
  cancel(): void
  dispose(): void
}

export type BoardAnalysisClientFactory = () => BoardAnalysisClient

export interface UseBoardAnalysisInput {
  readonly config: BoardConfig | null
  readonly board: Board
  readonly fixedSubmarines: readonly FixedSubmarine[]
}

export interface UseBoardAnalysisOptions {
  readonly debounceMs?: number
  readonly clientFactory?: BoardAnalysisClientFactory
}

type CompletedAnalysisUiState = {
  [Status in BoardAnalysisResult['status']]: {
    readonly status: Status
    readonly result: Extract<BoardAnalysisResult, { readonly status: Status }>
  }
}[BoardAnalysisResult['status']]

export type AnalysisUiState =
  | { readonly status: 'idle' }
  | { readonly status: 'debouncing' }
  | { readonly status: 'analyzing'; readonly requestVersion: number }
  | CompletedAnalysisUiState
  | {
      readonly status: 'error'
      readonly message: string
      readonly code?: string
    }

export interface UseBoardAnalysisResult {
  readonly state: AnalysisUiState
  readonly probabilities: ProbabilityMatrix | null
  readonly isBusy: boolean
  readonly recalculate: () => void
  readonly cancel: () => void
}

interface AnalysisStateRecord {
  readonly state: AnalysisUiState
  readonly inputSnapshot: UseBoardAnalysisInput | null
  readonly clientFactory: BoardAnalysisClientFactory | null
}

interface AnalysisUiError {
  readonly message: string
  readonly code?: string
}

const AUTO_ANALYSIS_OPTIONS = { mode: 'auto' } as const
const DEFAULT_DEBOUNCE_MS = 200
const DEFAULT_CLIENT_FACTORY: BoardAnalysisClientFactory = () =>
  new AnalysisWorkerClient()

function toCompletedState(result: BoardAnalysisResult): CompletedAnalysisUiState {
  switch (result.status) {
    case 'exact':
      return { status: 'exact', result }
    case 'estimated':
      return { status: 'estimated', result }
    case 'proven-no-layouts':
      return { status: 'proven-no-layouts', result }
    case 'exact-limit-reached':
      return { status: 'exact-limit-reached', result }
    case 'unavailable':
      return { status: 'unavailable', result }
  }
}

function toUiError(error: unknown): AnalysisUiError {
  if (error instanceof LayoutAnalysisError) {
    return { message: error.message, code: error.code }
  }
  if (error instanceof FixedSubmarineDomainError) {
    return { message: error.message, code: error.code }
  }
  if (error instanceof AnalysisWorkerProtocolError) {
    return { message: error.message, code: error.code }
  }
  if (error instanceof AnalysisWorkerRemoteError) {
    return { message: error.message, ...(error.code ? { code: error.code } : {}) }
  }
  if (
    error instanceof AnalysisWorkerCreationError ||
    error instanceof AnalysisWorkerRuntimeError ||
    error instanceof AnalysisWorkerPostMessageError
  ) {
    return { message: error.message }
  }
  return { message: '分析执行失败，请重试。' }
}

function isSilentCancellation(error: unknown): boolean {
  return (
    error instanceof AnalysisWorkerCancelledError ||
    error instanceof AnalysisWorkerDisposedError
  )
}

export function useBoardAnalysis(
  { config, board, fixedSubmarines }: UseBoardAnalysisInput,
  options: UseBoardAnalysisOptions = {},
): UseBoardAnalysisResult {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const clientFactory = options.clientFactory ?? DEFAULT_CLIENT_FACTORY
  const inputSnapshot = useMemo(
    () => ({ config, board, fixedSubmarines }),
    [config, board, fixedSubmarines],
  )
  const [record, setRecord] = useState<AnalysisStateRecord>({
    state: { status: 'idle' },
    inputSnapshot: null,
    clientFactory: null,
  })
  const mountedRef = useRef(false)
  const clientRef = useRef<BoardAnalysisClient | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestVersionRef = useRef(0)
  const latestInputSnapshotRef = useRef(inputSnapshot)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const isCurrentRun = useCallback(
    (
      capturedVersion: number,
      capturedSnapshot: UseBoardAnalysisInput,
      capturedClient: BoardAnalysisClient,
    ): boolean =>
      mountedRef.current &&
      capturedVersion === requestVersionRef.current &&
      capturedSnapshot === latestInputSnapshotRef.current &&
      capturedClient === clientRef.current,
    [],
  )

  const executeAnalysis = useCallback(
    (
      snapshot: UseBoardAnalysisInput,
      requestVersion: number,
      client: BoardAnalysisClient,
    ) => {
      if (!snapshot.config || !isCurrentRun(requestVersion, snapshot, client)) {
        return
      }
      setRecord({
        state: { status: 'analyzing', requestVersion },
        inputSnapshot: snapshot,
        clientFactory,
      })

      let evidence: BoardEvidence
      try {
        evidence = buildBoardEvidence(
          snapshot.config,
          snapshot.board,
          snapshot.fixedSubmarines,
        )
      } catch (error: unknown) {
        if (!isCurrentRun(requestVersion, snapshot, client)) return
        const uiError = toUiError(error)
        setRecord({
          state: { status: 'error', ...uiError },
          inputSnapshot: snapshot,
          clientFactory,
        })
        return
      }

      let analysisPromise: Promise<BoardAnalysisResult>
      try {
        analysisPromise = client.analyze(
          snapshot.config,
          evidence,
          AUTO_ANALYSIS_OPTIONS,
        )
      } catch (error: unknown) {
        if (!isCurrentRun(requestVersion, snapshot, client)) return
        const uiError = toUiError(error)
        setRecord({
          state: { status: 'error', ...uiError },
          inputSnapshot: snapshot,
          clientFactory,
        })
        return
      }

      void analysisPromise.then(
        (result) => {
          if (!isCurrentRun(requestVersion, snapshot, client)) return
          setRecord({
            state: toCompletedState(result),
            inputSnapshot: snapshot,
            clientFactory,
          })
        },
        (error: unknown) => {
          if (!isCurrentRun(requestVersion, snapshot, client)) return
          if (isSilentCancellation(error)) {
            setRecord({
              state: { status: 'idle' },
              inputSnapshot: snapshot,
              clientFactory,
            })
            return
          }
          const uiError = toUiError(error)
          setRecord({
            state: { status: 'error', ...uiError },
            inputSnapshot: snapshot,
            clientFactory,
          })
        },
      )
    },
    [clientFactory, isCurrentRun],
  )

  useLayoutEffect(() => {
    requestVersionRef.current += 1
    latestInputSnapshotRef.current = inputSnapshot
    clearTimer()
    clientRef.current?.cancel()
  }, [clearTimer, clientFactory, inputSnapshot])

  useEffect(() => {
    mountedRef.current = true
    try {
      clientRef.current = clientFactory()
    } catch (error: unknown) {
      clientRef.current = null
      const uiError = toUiError(error)
      setRecord({
        state: { status: 'error', ...uiError },
        inputSnapshot: latestInputSnapshotRef.current,
        clientFactory,
      })
    }

    return () => {
      mountedRef.current = false
      requestVersionRef.current += 1
      clearTimer()
      const client = clientRef.current
      clientRef.current = null
      client?.dispose()
    }
  }, [clearTimer, clientFactory])

  useEffect(() => {
    if (!config) {
      clearTimer()
      return
    }
    const client = clientRef.current
    if (!client) return
    requestVersionRef.current += 1
    const requestVersion = requestVersionRef.current
    setRecord({
      state: { status: 'debouncing' },
      inputSnapshot,
      clientFactory,
    })
    const timer = setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = null
      executeAnalysis(inputSnapshot, requestVersion, client)
    }, debounceMs)
    timerRef.current = timer
    return () => {
      if (timerRef.current === timer) {
        clearTimeout(timer)
        timerRef.current = null
      }
    }
  }, [
    clearTimer,
    clientFactory,
    config,
    debounceMs,
    executeAnalysis,
    inputSnapshot,
  ])

  const recalculate = useCallback(() => {
    const snapshot = latestInputSnapshotRef.current
    const client = clientRef.current
    requestVersionRef.current += 1
    const requestVersion = requestVersionRef.current
    clearTimer()
    client?.cancel()
    if (!snapshot.config || !client) {
      setRecord({
        state: snapshot.config
          ? { status: 'error', message: '分析客户端暂时不可用，请重试。' }
          : { status: 'idle' },
        inputSnapshot: snapshot,
        clientFactory,
      })
      return
    }
    executeAnalysis(snapshot, requestVersion, client)
  }, [clearTimer, clientFactory, executeAnalysis])

  const cancel = useCallback(() => {
    requestVersionRef.current += 1
    clearTimer()
    clientRef.current?.cancel()
    setRecord({
      state: { status: 'idle' },
      inputSnapshot: latestInputSnapshotRef.current,
      clientFactory,
    })
  }, [clearTimer, clientFactory])

  const recordMatchesCurrentInput =
    record.inputSnapshot === inputSnapshot && record.clientFactory === clientFactory
  const state: AnalysisUiState = !config
    ? { status: 'idle' }
    : recordMatchesCurrentInput
      ? record.state
      : { status: 'debouncing' }
  const probabilities =
    state.status === 'exact' || state.status === 'estimated'
      ? state.result.probabilities
      : null

  return {
    state,
    probabilities,
    isBusy: state.status === 'debouncing' || state.status === 'analyzing',
    recalculate,
    cancel,
  }
}
