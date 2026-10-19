import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardAnalysisResult } from '../engine/types'
import type { BoardConfig, FixedSubmarine } from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import type {
  BoardAnalysisClient,
  BoardAnalysisClientFactory,
  UseBoardAnalysisInput,
} from './useBoardAnalysis'
import { useBoardAnalysis } from './useBoardAnalysis'

const config: BoardConfig = {
  rows: 2,
  columns: 2,
  fleetConfig: { 2: 1, 3: 0, 4: 0, 5: 0 },
  adjacencyRule: 'orthogonal-and-diagonal',
}

const exactResult: BoardAnalysisResult = {
  status: 'exact',
  probabilities: [[0.5, 0.5], [0.5, 0.5]],
  occupancyCounts: [[1, 1], [1, 1]],
  totalLayouts: 2,
  visitedNodes: 3,
}
const defaultBoard = createBoard(2, 2)
const noFixedSubmarines: readonly FixedSubmarine[] = []

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeClient implements BoardAnalysisClient {
  readonly runs: Deferred<BoardAnalysisResult>[] = []
  readonly cancel = vi.fn()
  readonly dispose = vi.fn()

  analyze = vi.fn(() => {
    const run = deferred<BoardAnalysisResult>()
    this.runs.push(run)
    return run.promise
  })
}

function input(
  board = defaultBoard,
  currentConfig: BoardConfig | null = config,
  fixedSubmarines: readonly FixedSubmarine[] = noFixedSubmarines,
): UseBoardAnalysisInput {
  return { config: currentConfig, board, fixedSubmarines }
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useBoardAnalysis', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('只在 effect 中调用 Worker factory，config 为 null 时不分析', () => {
    const client = new FakeClient()
    let rendering = false
    let calledDuringRender = false
    const factory = vi.fn(() => {
      calledDuringRender ||= rendering
      return client
    })
    const noConfigInput = input(defaultBoard, null)
    const { result } = renderHook(() => {
      rendering = true
      const analysis = useBoardAnalysis(noConfigInput, {
        clientFactory: factory,
      })
      rendering = false
      return analysis
    })
    expect(factory).toHaveBeenCalledOnce()
    expect(calledDuringRender).toBe(false)
    expect(result.current.state.status).toBe('idle')
    act(() => vi.runAllTimers())
    expect(client.analyze).not.toHaveBeenCalled()
  })

  it('自动防抖后分析，并在新输入 render 时立即隐藏旧概率', async () => {
    const client = new FakeClient()
    const factory = () => client
    const original = createBoard(2, 2)
    const changed = updateCellState(original, { row: 0, column: 0 }, 'miss')
    const renderedProbabilities: Array<readonly (readonly number[])[] | null> = []
    const { result, rerender } = renderHook(
      ({ board }) => {
        const analysis = useBoardAnalysis(input(board), {
          clientFactory: factory,
          debounceMs: 20,
        })
        renderedProbabilities.push(analysis.probabilities)
        return analysis
      },
      { initialProps: { board: original } },
    )
    act(() => vi.advanceTimersByTime(20))
    expect(client.analyze).toHaveBeenCalledOnce()
    act(() => client.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.probabilities).toEqual(exactResult.probabilities)

    rerender({ board: changed })
    expect(renderedProbabilities.at(-1)).toBeNull()
    expect(result.current.probabilities).toBeNull()
    expect(result.current.state.status).toBe('debouncing')
  })

  it('保留 estimated 诊断并只向外提供有效的近似概率矩阵', async () => {
    const client = new FakeClient()
    const factory = () => client
    const { result } = renderHook(() => useBoardAnalysis(input(), {
      clientFactory: factory,
      debounceMs: 10,
    }))
    act(() => vi.advanceTimersByTime(10))
    const estimated: BoardAnalysisResult = {
      status: 'estimated', origin: 'direct', probabilities: [[0.2, 0.8], [0.4, 0.6]],
      seed: 9, attemptedSamples: 12, acceptedSamples: 10, failedAttempts: 2,
      targetReached: true, effectiveSampleSize: 8.5, maxWeightFraction: 0.18,
    }
    act(() => client.runs[0].resolve(estimated))
    await flushPromises()
    expect(result.current.state).toEqual({ status: 'estimated', result: estimated })
    expect(result.current.probabilities).toBe(estimated.probabilities)
  })

  it('旧 Promise 在输入替换后完成也不能覆盖新状态', async () => {
    const client = new FakeClient()
    const factory = () => client
    const original = createBoard(2, 2)
    const changed = updateCellState(original, { row: 0, column: 0 }, 'hit')
    const { result, rerender } = renderHook(
      ({ board }) => useBoardAnalysis(input(board), {
        clientFactory: factory,
        debounceMs: 10,
      }),
      { initialProps: { board: original } },
    )
    act(() => vi.advanceTimersByTime(10))
    rerender({ board: changed })
    act(() => client.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.probabilities).toBeNull()
    expect(result.current.state.status).toBe('debouncing')
  })

  it('cancel 不依赖客户端拒绝 Promise，旧结果保持失效', async () => {
    const client = new FakeClient()
    const factory = () => client
    const { result } = renderHook(() => useBoardAnalysis(input(), {
      clientFactory: factory,
      debounceMs: 10,
    }))
    act(() => vi.advanceTimersByTime(10))
    act(() => result.current.cancel())
    expect(result.current.state.status).toBe('idle')
    act(() => client.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.state.status).toBe('idle')
    expect(result.current.probabilities).toBeNull()
  })

  it('相同输入连续手动重算时只接受最后一次结果', async () => {
    const client = new FakeClient()
    const factory = () => client
    const { result } = renderHook(() => useBoardAnalysis(input(), {
      clientFactory: factory,
      debounceMs: 100,
    }))
    act(() => result.current.recalculate())
    act(() => result.current.recalculate())
    expect(client.analyze).toHaveBeenCalledTimes(2)
    act(() => client.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.probabilities).toBeNull()
    const newer = { ...exactResult, totalLayouts: 9 } as BoardAnalysisResult
    act(() => client.runs[1].resolve(newer))
    await flushPromises()
    expect(result.current.state.status).toBe('exact')
    if (result.current.state.status === 'exact') {
      expect(result.current.state.result.totalLayouts).toBe(9)
    }
  })

  it('手动重算会清除即将触发的自动防抖', () => {
    const client = new FakeClient()
    const factory = () => client
    const { result } = renderHook(() => useBoardAnalysis(input(), {
      clientFactory: factory,
      debounceMs: 50,
    }))
    act(() => result.current.recalculate())
    expect(client.analyze).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(50))
    expect(client.analyze).toHaveBeenCalledOnce()
  })

  it('证据同步校验失败时不调用 Worker，并公开稳定领域错误', () => {
    const client = new FakeClient()
    const factory = () => client
    const invalidFixed: FixedSubmarine = {
      id: 'not-a-placement', length: 2, orientation: 'horizontal',
      start: { row: 0, column: 0 },
    }
    const invalidInput = input(defaultBoard, config, [invalidFixed])
    const { result } = renderHook(() => useBoardAnalysis(
      invalidInput,
      { clientFactory: factory, debounceMs: 10 },
    ))
    act(() => vi.advanceTimersByTime(10))
    expect(client.analyze).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('error')
    if (result.current.state.status === 'error') {
      expect(result.current.state.code).toBe('fixed-submarine-placement-not-found')
    }
    expect(result.current.probabilities).toBeNull()
  })

  it('clientFactory 替换会释放旧客户端并使旧结果失效', async () => {
    const first = new FakeClient()
    const second = new FakeClient()
    const firstFactory: BoardAnalysisClientFactory = () => first
    const secondFactory: BoardAnalysisClientFactory = () => second
    const { result, rerender } = renderHook(
      ({ factory }) => useBoardAnalysis(input(), {
        clientFactory: factory,
        debounceMs: 10,
      }),
      { initialProps: { factory: firstFactory } },
    )
    act(() => vi.advanceTimersByTime(10))
    rerender({ factory: secondFactory })
    expect(first.dispose).toHaveBeenCalledOnce()
    act(() => first.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.probabilities).toBeNull()
    act(() => vi.advanceTimersByTime(10))
    expect(second.analyze).toHaveBeenCalledOnce()
  })

  it('config 变为 null 会立即清除概率并阻止旧 Promise 恢复', async () => {
    const client = new FakeClient()
    const factory = () => client
    const board = createBoard(2, 2)
    const { result, rerender } = renderHook(
      ({ currentConfig }) => useBoardAnalysis(input(board, currentConfig), {
        clientFactory: factory,
        debounceMs: 10,
      }),
      { initialProps: { currentConfig: config as BoardConfig | null } },
    )
    act(() => vi.advanceTimersByTime(10))
    act(() => client.runs[0].resolve(exactResult))
    await flushPromises()
    expect(result.current.probabilities).not.toBeNull()
    rerender({ currentConfig: null })
    expect(result.current.state.status).toBe('idle')
    expect(result.current.probabilities).toBeNull()
  })

  it('相同正式引用的临时界面 rerender 不产生新请求', () => {
    const client = new FakeClient()
    const factory = () => client
    const stableInput = input()
    const { rerender } = renderHook(
      ({ previewVersion }) => {
        void previewVersion
        return useBoardAnalysis(stableInput, {
          clientFactory: factory,
          debounceMs: 10,
        })
      },
      { initialProps: { previewVersion: 0 } },
    )
    act(() => vi.advanceTimersByTime(10))
    rerender({ previewVersion: 1 })
    act(() => vi.advanceTimersByTime(10))
    expect(client.analyze).toHaveBeenCalledOnce()
  })

  it('StrictMode 清理每个旧客户端且卸载后不残留计时器', () => {
    const clients: FakeClient[] = []
    const factory = () => {
      const client = new FakeClient()
      clients.push(client)
      return client
    }
    const { unmount } = renderHook(
      () => useBoardAnalysis(input(), { clientFactory: factory, debounceMs: 100 }),
      { wrapper: StrictMode },
    )
    expect(clients.length).toBeGreaterThanOrEqual(2)
    for (const client of clients.slice(0, -1)) {
      expect(client.dispose).toHaveBeenCalledOnce()
    }
    expect(clients.at(-1)?.dispose).not.toHaveBeenCalled()
    unmount()
    expect(clients.at(-1)?.dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
