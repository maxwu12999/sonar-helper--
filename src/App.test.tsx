import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import type { BoardAnalysisResult } from './engine/types'
import type { BoardAnalysisClient } from './hooks/useBoardAnalysis'
import {
  SAVED_GAME_STORAGE_KEY,
  serializeSavedGame,
  type StorageLike,
} from './persistence/savedGame'
import type { BoardConfig } from './types/game'
import { createBoard, updateCellState } from './utils/board'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  readonly getItem = vi.fn((key: string) => this.values.get(key) ?? null)
  readonly setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value)
  })
  readonly removeItem = vi.fn((key: string) => {
    this.values.delete(key)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function renderApp() {
  const client: BoardAnalysisClient = {
    analyze: vi.fn(() => new Promise<BoardAnalysisResult>(() => undefined)),
    cancel: vi.fn(),
    dispose: vi.fn(),
  }
  return render(
    <App
      analysisClientFactory={() => client}
      analysisDebounceMs={60_000}
      storage={new MemoryStorage()}
    />,
  )
}

async function createDefaultMap(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '创建地图' }))
  expect(screen.getByRole('heading', { name: '声呐网格' })).toBeInTheDocument()
}

describe('App', () => {
  it('显示中文输入错误且不创建地图', async () => {
    const user = userEvent.setup()
    renderApp()
    const rows = screen.getByLabelText('行数')
    await user.clear(rows)
    await user.click(screen.getByRole('button', { name: '创建地图' }))
    expect(screen.getByText('请输入行数')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '声呐网格' })).not.toBeInTheDocument()
  })

  it('完成 hit、固定潜艇预览确认、删除和整艘撤销流程', async () => {
    const user = userEvent.setup()
    renderApp()
    await createDefaultMap(user)

    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，未知/ }))
    const menu = screen.getByRole('dialog', { name: '第 1 行，第 1 列' })
    expect(within(menu).queryByRole('button', { name: '击沉' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('button', { name: '命中' }))

    await user.click(screen.getByRole('button', { name: '记录已击沉潜艇' }))
    expect(screen.getByText('正在选择潜艇起点')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，命中，选择为潜艇起点/ }))
    expect(screen.getByText(/待确认：2 格/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认记录' }))

    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，已击沉潜艇格/ })).toBeDisabled()
    expect(screen.getByText('记录已击沉，第 1 行，第 1 列起')).toBeInTheDocument()
    expect(screen.getByText('剩余 1 / 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，命中/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '撤销上一步' }))
    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，已击沉潜艇格/ })).toBeDisabled()
  })

  it('重置清空可见历史并显示“撤销重置”，撤销后恢复', async () => {
    const user = userEvent.setup()
    renderApp()
    await createDefaultMap(user)
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '未命中' }))
    await user.click(screen.getByRole('button', { name: '重置地图' }))

    expect(screen.getByText('暂无操作记录')).toBeInTheDocument()
    const undoReset = screen.getByRole('button', { name: '撤销重置' })
    expect(undoReset).toBeEnabled()
    await user.click(undoReset)
    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，未命中/ })).toBeDisabled()
  })

  it('创建地图后自动分析并显示概率，临时固定潜艇预览不重新分析', async () => {
    const user = userEvent.setup()
    const client: BoardAnalysisClient = {
      analyze: vi.fn((currentConfig: BoardConfig): Promise<BoardAnalysisResult> => Promise.resolve({
        status: 'exact',
        probabilities: Array.from(
          { length: currentConfig.rows },
          () => Array.from({ length: currentConfig.columns }, () => 0.374),
        ),
        occupancyCounts: Array.from(
          { length: currentConfig.rows },
          () => Array.from({ length: currentConfig.columns }, () => 1),
        ),
        totalLayouts: 8,
        visitedNodes: 12,
      })),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    render(<App analysisClientFactory={() => client} analysisDebounceMs={0} storage={new MemoryStorage()} />)
    await createDefaultMap(user)
    await waitFor(() => expect(screen.getByText('精确分析完成')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '精确概率推荐' })).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: /第 1 行，第 1 列，未知，占用概率 37.4%，推荐攻击目标/,
    })).toHaveClass('recommended-target')
    expect(client.analyze).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '记录已击沉潜艇' }))
    expect(screen.queryByRole('heading', { name: '精确概率推荐' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/推荐攻击目标/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('潜艇长度'), '3')
    await user.click(screen.getByRole('button', { name: '垂直' }))
    await user.click(screen.getByRole('button', {
      name: /第 1 行，第 1 列，未知，占用概率 37.4%.*选择为潜艇起点/,
    }))
    expect(client.analyze).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '取消录入' }))
    expect(screen.getByRole('heading', { name: '精确概率推荐' })).toBeInTheDocument()
    expect(screen.getByLabelText(/推荐攻击目标/)).toBeInTheDocument()
    expect(client.analyze).toHaveBeenCalledOnce()
  })

  it('estimated 结果产生明确的近似推荐', async () => {
    const user = userEvent.setup()
    const client: BoardAnalysisClient = {
      analyze: vi.fn((currentConfig: BoardConfig): Promise<BoardAnalysisResult> => Promise.resolve({
        status: 'estimated', origin: 'direct',
        probabilities: Array.from(
          { length: currentConfig.rows },
          (_, row) => Array.from(
            { length: currentConfig.columns },
            (_, column) => row === 0 && column === 1 ? 0.8 : 0.1,
          ),
        ),
        seed: 5, attemptedSamples: 10, acceptedSamples: 4, failedAttempts: 6,
        targetReached: false, effectiveSampleSize: 3, maxWeightFraction: 0.4,
      })),
      cancel: vi.fn(), dispose: vi.fn(),
    }
    render(<App analysisClientFactory={() => client} analysisDebounceMs={0} storage={new MemoryStorage()} />)
    await createDefaultMap(user)
    await waitFor(() => expect(
      screen.getByRole('heading', { name: '近似概率推荐' }),
    ).toBeInTheDocument())
    expect(screen.getByText('本次采样未达到目标样本数。')).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: /第 1 行，第 2 列.*80.0%.*推荐攻击目标/,
    })).toBeInTheDocument()
  })

  it('推荐派生错误受控显示且不会使 App render 崩溃', async () => {
    const user = userEvent.setup()
    const client: BoardAnalysisClient = {
      analyze: vi.fn((): Promise<BoardAnalysisResult> => Promise.resolve({
        status: 'exact', probabilities: [[0.5]], occupancyCounts: [[1]],
        totalLayouts: 1, visitedNodes: 1,
      })),
      cancel: vi.fn(), dispose: vi.fn(),
    }
    render(<App analysisClientFactory={() => client} analysisDebounceMs={0} storage={new MemoryStorage()} />)
    await createDefaultMap(user)
    await waitFor(() => expect(
      screen.getByRole('heading', { name: '无法生成攻击推荐' }),
    ).toBeInTheDocument())
    expect(screen.getByText('recommendation-matrix-dimension-mismatch')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '声呐网格' })).toBeInTheDocument()
  })

  it('正式证据变化立即移除旧推荐，过期结果不能恢复，新结果会移动推荐', async () => {
    const user = userEvent.setup()
    const runs: Array<ReturnType<typeof deferred<BoardAnalysisResult>>> = []
    let dimensions = { rows: 0, columns: 0 }
    const client: BoardAnalysisClient = {
      analyze: vi.fn((currentConfig: BoardConfig) => {
        dimensions = {
          rows: currentConfig.rows,
          columns: currentConfig.columns,
        }
        const run = deferred<BoardAnalysisResult>()
        runs.push(run)
        return run.promise
      }),
      cancel: vi.fn(), dispose: vi.fn(),
    }
    render(<App analysisClientFactory={() => client} analysisDebounceMs={0} storage={new MemoryStorage()} />)
    await createDefaultMap(user)
    await waitFor(() => expect(client.analyze).toHaveBeenCalledTimes(1))
    const matrix = (first: number, second: number, third: number) =>
      Array.from({ length: dimensions.rows }, (_, row) =>
        Array.from({ length: dimensions.columns }, (_, column) =>
          row === 0 && column === 0
            ? first
            : row === 0 && column === 1
              ? second
              : row === 0 && column === 2
                ? third
                : 0.01,
        ),
      )
    runs[0].resolve({
      status: 'exact', probabilities: matrix(0.9, 0.8, 0.7),
      occupancyCounts: matrix(1, 1, 1), totalLayouts: 10, visitedNodes: 20,
    })
    await waitFor(() => expect(screen.getByLabelText(
      /第 1 行，第 1 列.*推荐攻击目标/,
    )).toBeInTheDocument())

    await user.click(screen.getByLabelText(/第 1 行，第 1 列.*推荐攻击目标/))
    await user.click(screen.getByRole('button', { name: '未命中' }))
    expect(screen.queryByRole('heading', { name: '精确概率推荐' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/推荐攻击目标/)).not.toBeInTheDocument()
    await waitFor(() => expect(client.analyze).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: /第 1 行，第 2 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '命中' }))
    await waitFor(() => expect(client.analyze).toHaveBeenCalledTimes(3))
    runs[1].resolve({
      status: 'exact', probabilities: matrix(0, 0.95, 0.7),
      occupancyCounts: matrix(0, 1, 1), totalLayouts: 10, visitedNodes: 20,
    })
    await Promise.resolve()
    expect(screen.queryByLabelText(/推荐攻击目标/)).not.toBeInTheDocument()

    runs[2].resolve({
      status: 'exact', probabilities: matrix(0, 1, 0.85),
      occupancyCounts: matrix(0, 10, 8), totalLayouts: 10, visitedNodes: 20,
    })
    await waitFor(() => expect(screen.getByLabelText(
      /第 1 行，第 3 列.*推荐攻击目标/,
    )).toBeInTheDocument())
  })
})

describe('App 本地对局持久化', () => {
  const savedConfig: BoardConfig = {
    rows: 3,
    columns: 5,
    adjacencyRule: 'orthogonal-only',
    fleetConfig: { 2: 1, 3: 0, 4: 0, 5: 0 },
  }

  function persistenceClient(): BoardAnalysisClient {
    return {
      analyze: vi.fn(() => new Promise<BoardAnalysisResult>(() => undefined)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
  }

  it('恢复正式证据后重新分析，且旧历史和撤销不会恢复', async () => {
    const storage = new MemoryStorage()
    const board = updateCellState(createBoard(3, 5), { row: 1, column: 2 }, 'hit')
    storage.values.set(
      SAVED_GAME_STORAGE_KEY,
      serializeSavedGame(savedConfig, board, []),
    )
    const client = persistenceClient()
    render(<App analysisClientFactory={() => client} analysisDebounceMs={0} storage={storage} />)
    expect(await screen.findByRole('button', { name: /第 2 行，第 3 列，命中/ })).toBeDisabled()
    expect(screen.getByText('暂无操作记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销上一步' })).toBeDisabled()
    await waitFor(() => expect(client.analyze).toHaveBeenCalledOnce())
  })

  it('hydration 完成和300ms防抖前不写空状态，只保存最后的正式状态', async () => {
    const storage = new MemoryStorage()
    const user = userEvent.setup()
    render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
      persistenceSaveDebounceMs={1_000}
    />)
    expect(storage.setItem).not.toHaveBeenCalled()
    await createDefaultMap(user)
    expect(storage.setItem).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '未命中' }))
    await user.click(screen.getByRole('button', { name: /第 1 行，第 2 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '命中' }))
    expect(storage.setItem).not.toHaveBeenCalled()
    await waitFor(
      () => expect(storage.setItem).toHaveBeenCalledOnce(),
      { timeout: 2_000 },
    )
    const saved = JSON.parse(storage.setItem.mock.calls[0][1]) as {
      observations: string[][]
    }
    expect(saved.observations[0].slice(0, 2)).toEqual(['miss', 'hit'])
  })

  it('preview、长度和方向变化不会保存，正式固定潜艇变化会保存', async () => {
    const storage = new MemoryStorage()
    const user = userEvent.setup()
    render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
      persistenceSaveDebounceMs={20}
    />)
    await createDefaultMap(user)
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: '记录已击沉潜艇' }))
    await user.click(screen.getByRole('button', { name: '垂直' }))
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列.*选择为潜艇起点/ }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(storage.setItem).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '确认记录' }))
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(3))
    await user.click(screen.getByRole('button', { name: '撤销上一步' }))
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(4))
    await user.click(screen.getByRole('button', { name: '重置地图' }))
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(5))
  })

  it('概率和推荐结果变化不会触发额外保存', async () => {
    const storage = new MemoryStorage()
    const analysisRun = deferred<BoardAnalysisResult>()
    const client: BoardAnalysisClient = {
      analyze: vi.fn(() => analysisRun.promise),
      cancel: vi.fn(), dispose: vi.fn(),
    }
    const user = userEvent.setup()
    render(<App
      analysisClientFactory={() => client}
      analysisDebounceMs={0}
      storage={storage}
      persistenceSaveDebounceMs={20}
    />)
    await createDefaultMap(user)
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce())
    analysisRun.resolve({
      status: 'exact',
      probabilities: Array.from({ length: 10 }, () => Array(10).fill(0.2) as number[]),
      occupancyCounts: Array.from({ length: 10 }, () => Array(10).fill(1) as number[]),
      totalLayouts: 5,
      visitedNodes: 10,
    })
    await waitFor(() => expect(
      screen.getByRole('heading', { name: '精确概率推荐' }),
    ).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('结束并清除对局会取消待保存 timer，且删除失败不阻止结束', async () => {
    const storage = new MemoryStorage()
    storage.removeItem.mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    const client = persistenceClient()
    render(<App
      analysisClientFactory={() => client}
      analysisDebounceMs={60_000}
      storage={storage}
      persistenceSaveDebounceMs={1_000}
    />)
    await createDefaultMap(user)
    await user.click(screen.getByRole('button', { name: '结束并清除对局' }))
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    expect(screen.getByRole('heading', { name: '等待创建地图' })).toBeInTheDocument()
    expect(screen.getByText('本地存档可能未成功清除')).toBeInTheDocument()
    expect(client.cancel).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('成功结束会同时清除当前状态和存档，重新挂载不再恢复', async () => {
    const storage = new MemoryStorage()
    const user = userEvent.setup()
    const first = render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
      persistenceSaveDebounceMs={20}
    />)
    await createDefaultMap(user)
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce())
    expect(storage.values.has(SAVED_GAME_STORAGE_KEY)).toBe(true)
    await user.click(screen.getByRole('button', { name: '结束并清除对局' }))
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    expect(storage.removeItem).toHaveBeenCalledWith(SAVED_GAME_STORAGE_KEY)
    expect(storage.values.has(SAVED_GAME_STORAGE_KEY)).toBe(false)
    expect(screen.getByRole('heading', { name: '等待创建地图' })).toBeInTheDocument()
    first.unmount()

    render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
    />)
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: '声呐网格' })).not.toBeInTheDocument()
  })

  it('损坏存档被忽略并移除，未支持版本保留', async () => {
    const corrupt = new MemoryStorage()
    corrupt.values.set(SAVED_GAME_STORAGE_KEY, '{')
    const first = render(<App
      analysisClientFactory={() => persistenceClient()}
      storage={corrupt}
    />)
    expect(await screen.findByText('已忽略损坏的本地对局存档')).toBeInTheDocument()
    expect(corrupt.removeItem).toHaveBeenCalledWith(SAVED_GAME_STORAGE_KEY)
    first.unmount()

    const newer = new MemoryStorage()
    newer.values.set(SAVED_GAME_STORAGE_KEY, JSON.stringify({ schemaVersion: 2 }))
    render(<App analysisClientFactory={() => persistenceClient()} storage={newer} />)
    expect(await screen.findByText('本地对局存档版本暂不受支持，未进行加载')).toBeInTheDocument()
    expect(newer.removeItem).not.toHaveBeenCalled()
  })

  it('保存失败只提示，不影响继续操作', async () => {
    const storage = new MemoryStorage()
    storage.setItem.mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
      persistenceSaveDebounceMs={20}
    />)
    await createDefaultMap(user)
    expect(await screen.findByText('当前对局无法保存到浏览器')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '未命中' }))
    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，未命中/ })).toBeDisabled()
  })

  it('读取存储被浏览器拒绝时仍可正常创建和操作对局', async () => {
    const storage: StorageLike = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    const user = userEvent.setup()
    render(<App
      analysisClientFactory={() => persistenceClient()}
      analysisDebounceMs={60_000}
      storage={storage}
    />)
    expect(await screen.findByText('当前对局无法保存到浏览器')).toBeInTheDocument()
    await createDefaultMap(user)
    expect(screen.getByText('地图与舰队配置（自定义）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /第 1 行，第 1 列，未知/ }))
    await user.click(screen.getByRole('button', { name: '命中' }))
    expect(screen.getByRole('button', { name: /第 1 行，第 1 列，命中/ })).toBeDisabled()
  })
})
