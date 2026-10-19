import type { BoardConfig } from '../types/game'
import {
  LayoutAnalysisError,
  type BoardAnalysisOptions,
  type BoardAnalysisResult,
  type BoardEvidence,
} from '../engine/types'
import {
  WORKER_PROTOCOL_ERROR_CODE,
  extractWorkerRequestId,
  isAnalysisWorkerResponse,
  isLayoutAnalysisErrorCode,
  type AnalysisWorkerRequest,
  type AnalysisWorkerResponse,
  type SerializedAnalysisError,
} from './analysisWorkerProtocol'

export type AnalysisWorkerCancellationReason = 'cancelled' | 'superseded'

export class AnalysisWorkerCancelledError extends Error {
  readonly reason: AnalysisWorkerCancellationReason

  constructor(reason: AnalysisWorkerCancellationReason) {
    super(reason === 'cancelled' ? '分析已取消' : '分析已被新请求替换')
    this.name = 'AnalysisWorkerCancelledError'
    this.reason = reason
  }
}

export class AnalysisWorkerDisposedError extends Error {
  constructor() {
    super('分析 Worker 客户端已释放')
    this.name = 'AnalysisWorkerDisposedError'
  }
}

export class AnalysisWorkerCreationError extends Error {
  constructor() {
    super('无法创建分析 Worker')
    this.name = 'AnalysisWorkerCreationError'
  }
}

export class AnalysisWorkerRuntimeError extends Error {
  constructor(message = '分析 Worker 运行失败') {
    super(message)
    this.name = 'AnalysisWorkerRuntimeError'
  }
}

export class AnalysisWorkerPostMessageError extends Error {
  constructor() {
    super('无法向分析 Worker 发送请求')
    this.name = 'AnalysisWorkerPostMessageError'
  }
}

export class AnalysisWorkerProtocolError extends Error {
  readonly code = WORKER_PROTOCOL_ERROR_CODE

  constructor(message = '分析 Worker 返回了无效响应') {
    super(message)
    this.name = 'AnalysisWorkerProtocolError'
  }
}

export class AnalysisWorkerRemoteError extends Error {
  readonly remoteName: string
  readonly code: string | undefined

  constructor(error: SerializedAnalysisError) {
    super(error.message)
    this.name = 'AnalysisWorkerRemoteError'
    this.remoteName = error.name
    this.code = error.code
  }
}

type MessageListener = (event: MessageEvent<unknown>) => void
type EventListener = (event: Event) => void

export interface AnalysisWorkerLike {
  postMessage(message: AnalysisWorkerRequest): void
  terminate(): void
  addEventListener(type: 'message', listener: MessageListener): void
  addEventListener(type: 'error' | 'messageerror', listener: EventListener): void
  removeEventListener(type: 'message', listener: MessageListener): void
  removeEventListener(type: 'error' | 'messageerror', listener: EventListener): void
}

export type AnalysisWorkerFactory = () => AnalysisWorkerLike

export function createDefaultAnalysisWorker(): AnalysisWorkerLike {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), {
    type: 'module',
  })
}

interface WorkerListeners {
  readonly message: MessageListener
  readonly error: EventListener
  readonly messageerror: EventListener
}

interface PendingAnalysis {
  readonly requestId: string
  readonly workerGeneration: number
  readonly resolve: (result: BoardAnalysisResult) => void
  readonly reject: (error: Error) => void
}

let nextClientInstanceId = 1

function restoreRemoteError(error: SerializedAnalysisError): Error {
  if (error.code && isLayoutAnalysisErrorCode(error.code)) {
    return new LayoutAnalysisError(error.code, error.message)
  }
  if (
    error.name === 'AnalysisWorkerProtocolError' ||
    error.code === WORKER_PROTOCOL_ERROR_CODE
  ) {
    return new AnalysisWorkerProtocolError(error.message)
  }
  return new AnalysisWorkerRemoteError(error)
}

export class AnalysisWorkerClient {
  private readonly clientInstanceId = nextClientInstanceId++
  private readonly workerFactory: AnalysisWorkerFactory
  private worker: AnalysisWorkerLike | null = null
  private listeners: WorkerListeners | null = null
  private pending: PendingAnalysis | null = null
  private disposed = false
  private workerGeneration = 0
  private nextRequestSequence = 1
  private lastCreationError: AnalysisWorkerCreationError | null = null
  private readonly staleRequestIds = new Set<string>()

  constructor(workerFactory: AnalysisWorkerFactory = createDefaultAnalysisWorker) {
    this.workerFactory = workerFactory
  }

  analyze(
    config: BoardConfig,
    evidence: BoardEvidence,
    options?: BoardAnalysisOptions,
  ): Promise<BoardAnalysisResult> {
    if (this.disposed) return Promise.reject(new AnalysisWorkerDisposedError())

    if (this.pending) {
      const recreated = this.cancelActiveRequest('superseded')
      if (!recreated) {
        return Promise.reject(
          this.lastCreationError ?? new AnalysisWorkerCreationError(),
        )
      }
    } else if (!this.worker && !this.tryCreateWorker()) {
      return Promise.reject(
        this.lastCreationError ?? new AnalysisWorkerCreationError(),
      )
    }

    const worker = this.worker
    if (!worker) return Promise.reject(new AnalysisWorkerCreationError())
    const requestId = this.createRequestId()
    const request: AnalysisWorkerRequest = {
      type: 'analyze',
      requestId,
      config,
      evidence,
      ...(options === undefined ? {} : { options }),
    }

    return new Promise<BoardAnalysisResult>((resolve, reject) => {
      this.pending = {
        requestId,
        workerGeneration: this.workerGeneration,
        resolve,
        reject,
      }
      try {
        worker.postMessage(request)
      } catch {
        this.hardReset(new AnalysisWorkerPostMessageError())
      }
    })
  }

  cancel(): void {
    if (this.disposed || !this.pending) return
    this.cancelActiveRequest('cancelled')
  }

  dispose(): void {
    if (this.disposed) return
    const pending = this.pending
    this.pending = null
    if (pending) this.rememberStaleRequestId(pending.requestId)
    this.detachAndTerminateWorker()
    this.workerGeneration += 1
    this.disposed = true
    if (pending) pending.reject(new AnalysisWorkerDisposedError())
  }

  private createRequestId(): string {
    const requestId = `analysis-${this.clientInstanceId}-${this.nextRequestSequence}`
    this.nextRequestSequence += 1
    return requestId
  }

  private tryCreateWorker(): boolean {
    if (this.disposed) return false
    let worker: AnalysisWorkerLike | null = null
    try {
      worker = this.workerFactory()
      const generation = this.workerGeneration
      const listeners: WorkerListeners = {
        message: (event) => this.handleMessage(worker, generation, event),
        error: () =>
          this.handleWorkerFailure(
            worker,
            generation,
            new AnalysisWorkerRuntimeError(),
          ),
        messageerror: () =>
          this.handleWorkerFailure(
            worker,
            generation,
            new AnalysisWorkerProtocolError('分析 Worker 消息无法反序列化'),
          ),
      }
      worker.addEventListener('message', listeners.message)
      worker.addEventListener('error', listeners.error)
      worker.addEventListener('messageerror', listeners.messageerror)
      this.worker = worker
      this.listeners = listeners
      this.lastCreationError = null
      return true
    } catch {
      worker?.terminate()
      this.worker = null
      this.listeners = null
      this.lastCreationError = new AnalysisWorkerCreationError()
      return false
    }
  }

  private cancelActiveRequest(reason: AnalysisWorkerCancellationReason): boolean {
    const pending = this.pending
    if (!pending) return this.worker !== null
    this.pending = null
    this.rememberStaleRequestId(pending.requestId)
    this.detachAndTerminateWorker()
    this.workerGeneration += 1
    const recreated = this.tryCreateWorker()
    pending.reject(new AnalysisWorkerCancelledError(reason))
    return recreated
  }

  private hardReset(error: Error): void {
    const pending = this.pending
    this.pending = null
    if (pending) this.rememberStaleRequestId(pending.requestId)
    this.detachAndTerminateWorker()
    this.workerGeneration += 1
    this.tryCreateWorker()
    if (pending) pending.reject(error)
  }

  private detachAndTerminateWorker(): void {
    const worker = this.worker
    const listeners = this.listeners
    this.worker = null
    this.listeners = null
    if (!worker) return
    if (listeners) {
      worker.removeEventListener('message', listeners.message)
      worker.removeEventListener('error', listeners.error)
      worker.removeEventListener('messageerror', listeners.messageerror)
    }
    worker.terminate()
  }

  private handleWorkerFailure(
    worker: AnalysisWorkerLike | null,
    generation: number,
    error: Error,
  ): void {
    if (worker !== this.worker || generation !== this.workerGeneration) return
    this.hardReset(error)
  }

  private handleMessage(
    worker: AnalysisWorkerLike | null,
    generation: number,
    event: MessageEvent<unknown>,
  ): void {
    if (worker !== this.worker || generation !== this.workerGeneration) return
    const responseId = extractWorkerRequestId(event.data)
    if (this.staleRequestIds.has(responseId)) return
    if (!isAnalysisWorkerResponse(event.data)) {
      this.hardReset(new AnalysisWorkerProtocolError())
      return
    }
    const response: AnalysisWorkerResponse = event.data
    const pending = this.pending
    if (!pending) {
      this.hardReset(new AnalysisWorkerProtocolError('分析 Worker 返回了无法归属的响应'))
      return
    }
    if (
      pending.workerGeneration !== generation ||
      response.requestId !== pending.requestId
    ) {
      this.hardReset(new AnalysisWorkerProtocolError('分析 Worker requestId 不匹配'))
      return
    }

    this.pending = null
    this.rememberStaleRequestId(pending.requestId)
    if (response.type === 'result') {
      pending.resolve(response.result)
    } else {
      pending.reject(restoreRemoteError(response.error))
    }
  }

  private rememberStaleRequestId(requestId: string): void {
    this.staleRequestIds.add(requestId)
    if (this.staleRequestIds.size > 1_000) {
      const oldest = this.staleRequestIds.values().next().value
      if (typeof oldest === 'string') this.staleRequestIds.delete(oldest)
    }
  }
}
