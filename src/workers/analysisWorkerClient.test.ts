import { describe, expect, it } from 'vitest'
import type { BoardConfig } from '../types/game'
import { LayoutAnalysisError, type BoardAnalysisResult, type BoardEvidence } from '../engine/types'
import {
  AnalysisWorkerCancelledError,
  AnalysisWorkerClient,
  AnalysisWorkerCreationError,
  AnalysisWorkerDisposedError,
  AnalysisWorkerPostMessageError,
  AnalysisWorkerProtocolError,
  AnalysisWorkerRuntimeError,
  type AnalysisWorkerFactory,
  type AnalysisWorkerLike,
} from './analysisWorkerClient'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysisWorkerProtocol'

type MessageListener = (event: MessageEvent<unknown>) => void
type EventListener = (event: Event) => void

class FakeWorker implements AnalysisWorkerLike {
  readonly sent: AnalysisWorkerRequest[] = []
  terminated = false
  throwOnPost = false
  private messageListeners = new Set<MessageListener>()
  private errorListeners = new Set<EventListener>()
  private messageErrorListeners = new Set<EventListener>()

  postMessage(message: AnalysisWorkerRequest): void {
    if (this.throwOnPost) throw new Error('post failed')
    this.sent.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: 'message', listener: MessageListener): void
  addEventListener(type: 'error' | 'messageerror', listener: EventListener): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: MessageListener | EventListener): void {
    if (type === 'message') this.messageListeners.add(listener as MessageListener)
    else if (type === 'error') this.errorListeners.add(listener as EventListener)
    else this.messageErrorListeners.add(listener as EventListener)
  }

  removeEventListener(type: 'message', listener: MessageListener): void
  removeEventListener(type: 'error' | 'messageerror', listener: EventListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: MessageListener | EventListener): void {
    if (type === 'message') this.messageListeners.delete(listener as MessageListener)
    else if (type === 'error') this.errorListeners.delete(listener as EventListener)
    else this.messageErrorListeners.delete(listener as EventListener)
  }

  emitMessage(response: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(new MessageEvent('message', { data: response }))
    }
  }

  emitError(): void {
    for (const listener of [...this.errorListeners]) listener(new Event('error'))
  }

  emitMessageError(): void {
    for (const listener of [...this.messageErrorListeners]) listener(new Event('messageerror'))
  }

  captureMessageDispatch(): (response: unknown) => void {
    const listeners = [...this.messageListeners]
    return (response) => {
      for (const listener of listeners) listener(new MessageEvent('message', { data: response }))
    }
  }
}

const config: BoardConfig = {
  rows: 3,
  columns: 3,
  adjacencyRule: 'orthogonal-and-diagonal',
  fleetConfig: { 2: 0, 3: 1, 4: 0, 5: 0 },
}
const evidence: BoardEvidence = { misses: [], occupied: [] }
const exactResult: BoardAnalysisResult = {
  status: 'exact',
  probabilities: [[1]],
  occupancyCounts: [[1]],
  totalLayouts: 1,
  visitedNodes: 1,
}
const estimatedResult: BoardAnalysisResult = {
  status: 'estimated',
  origin: 'direct',
  probabilities: [[1]],
  seed: 1,
  attemptedSamples: 1,
  acceptedSamples: 1,
  failedAttempts: 0,
  targetReached: true,
  effectiveSampleSize: 1,
  maxWeightFraction: 1,
}

function resultResponse(worker: FakeWorker, result: BoardAnalysisResult): AnalysisWorkerResponse {
  return { type: 'result', requestId: worker.sent.at(-1)!.requestId, result }
}

function workerFactory(workers: FakeWorker[]): AnalysisWorkerFactory {
  return () => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }
}

describe('analysis worker client results and errors', () => {
  it('连续解析 exact 和 estimated，不发生串线', async () => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const first = client.analyze(config, evidence)
    workers[0].emitMessage(resultResponse(workers[0], exactResult))
    await expect(first).resolves.toEqual(exactResult)

    const second = client.analyze(config, evidence)
    expect(workers).toHaveLength(1)
    workers[0].emitMessage(resultResponse(workers[0], estimatedResult))
    await expect(second).resolves.toEqual(estimatedResult)
    expect(workers[0].sent[0].requestId).not.toBe(workers[0].sent[1].requestId)
  })

  it('还原领域错误的稳定 code、name 和 message', async () => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const promise = client.analyze(config, evidence)
    workers[0].emitMessage({
      type: 'error',
      requestId: workers[0].sent[0].requestId,
      error: { name: 'LayoutAnalysisError', message: 'bad option', code: 'invalid-search-option' },
    })
    const error = await promise.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(LayoutAnalysisError)
    expect(error).toMatchObject({ name: 'LayoutAnalysisError', message: 'bad option', code: 'invalid-search-option' })
  })

  it.each([
    ['error', 'emitError', AnalysisWorkerRuntimeError],
    ['messageerror', 'emitMessageError', AnalysisWorkerProtocolError],
  ] as const)('%s 事件拒绝请求、终止旧 Worker 并创建新 Worker', async (_name, method, ErrorType) => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const promise = client.analyze(config, evidence)
    workers[0][method]()
    await expect(promise).rejects.toBeInstanceOf(ErrorType)
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })

  it('畸形和无法归属的当前响应触发协议错误与硬重置', async () => {
    for (const response of [
      { type: 'result', requestId: 'invalid-request', result: {} },
      { type: 'result', requestId: 'unknown-current-id', result: exactResult },
    ]) {
      const workers: FakeWorker[] = []
      const client = new AnalysisWorkerClient(workerFactory(workers))
      const promise = client.analyze(config, evidence)
      workers[0].emitMessage(response)
      await expect(promise).rejects.toBeInstanceOf(AnalysisWorkerProtocolError)
      expect(workers[0].terminated).toBe(true)
      expect(workers).toHaveLength(2)
    }
  })

  it('postMessage 抛出异常时硬重置且 Promise 只拒绝一次', async () => {
    const workers: FakeWorker[] = []
    const factory: AnalysisWorkerFactory = () => {
      const worker = new FakeWorker()
      if (workers.length === 0) worker.throwOnPost = true
      workers.push(worker)
      return worker
    }
    const client = new AnalysisWorkerClient(factory)
    let settlements = 0
    const promise = client.analyze(config, evidence).finally(() => {
      settlements += 1
    })
    await expect(promise).rejects.toBeInstanceOf(AnalysisWorkerPostMessageError)
    workers[0].emitError()
    await Promise.resolve()
    expect(settlements).toBe(1)
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })
})

describe('analysis worker client cancellation and lifecycle', () => {
  it('显式 cancel 使用 cancelled，新请求替换使用 superseded', async () => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const cancelled = client.analyze(config, evidence)
    client.cancel()
    const cancelError = await cancelled.catch((reason: unknown) => reason)
    expect(cancelError).toBeInstanceOf(AnalysisWorkerCancelledError)
    expect(cancelError).toMatchObject({ reason: 'cancelled' })
    expect(workers[0].terminated).toBe(true)

    const superseded = client.analyze(config, evidence)
    const replacement = client.analyze(config, evidence)
    const supersededError = await superseded.catch((reason: unknown) => reason)
    expect(supersededError).toMatchObject({ reason: 'superseded' })
    const currentWorker = workers.at(-1)!
    currentWorker.emitMessage(resultResponse(currentWorker, exactResult))
    await expect(replacement).resolves.toEqual(exactResult)
  })

  it('初次创建失败只拒绝当前请求，后续 analyze 重试成功', async () => {
    const workers: FakeWorker[] = []
    let attempts = 0
    const factory: AnalysisWorkerFactory = () => {
      attempts += 1
      if (attempts === 1) throw new Error('creation failed')
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
    const client = new AnalysisWorkerClient(factory)
    await expect(client.analyze(config, evidence)).rejects.toBeInstanceOf(AnalysisWorkerCreationError)
    const recovered = client.analyze(config, evidence)
    workers[0].emitMessage(resultResponse(workers[0], exactResult))
    await expect(recovered).resolves.toEqual(exactResult)
  })

  it('重建失败后保持可恢复，下一次 analyze 可再次创建', async () => {
    const workers: FakeWorker[] = []
    let attempts = 0
    const factory: AnalysisWorkerFactory = () => {
      attempts += 1
      if (attempts === 2) throw new Error('rebuild failed')
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
    const client = new AnalysisWorkerClient(factory)
    const failed = client.analyze(config, evidence)
    workers[0].emitError()
    await expect(failed).rejects.toBeInstanceOf(AnalysisWorkerRuntimeError)
    const recovered = client.analyze(config, evidence)
    workers[1].emitMessage(resultResponse(workers[1], exactResult))
    await expect(recovered).resolves.toEqual(exactResult)
  })

  it('dispose 拒绝当前请求，之后永不重建', async () => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const pending = client.analyze(config, evidence)
    client.dispose()
    await expect(pending).rejects.toBeInstanceOf(AnalysisWorkerDisposedError)
    expect(workers[0].terminated).toBe(true)
    await expect(client.analyze(config, evidence)).rejects.toBeInstanceOf(AnalysisWorkerDisposedError)
    client.cancel()
    expect(workers).toHaveLength(1)
  })

  it('已知旧 requestId 和旧 Worker 残留消息被忽略，当前请求仍会完成', async () => {
    const workers: FakeWorker[] = []
    const client = new AnalysisWorkerClient(workerFactory(workers))
    const oldPromise = client.analyze(config, evidence)
    const oldWorker = workers[0]
    const oldRequestId = oldWorker.sent[0].requestId
    const dispatchOld = oldWorker.captureMessageDispatch()
    const currentPromise = client.analyze(config, evidence)
    await expect(oldPromise).rejects.toMatchObject({ reason: 'superseded' })

    dispatchOld({ type: 'result', requestId: oldRequestId, result: exactResult })
    const currentWorker = workers[1]
    currentWorker.emitMessage({ type: 'result', requestId: oldRequestId, result: exactResult })
    currentWorker.emitMessage(resultResponse(currentWorker, estimatedResult))
    await expect(currentPromise).resolves.toEqual(estimatedResult)
    expect(currentWorker.terminated).toBe(false)
  })
})
