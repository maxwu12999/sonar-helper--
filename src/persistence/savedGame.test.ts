import { describe, expect, it } from 'vitest'
import { createFixedSubmarineFromPlacement } from '../rules/fixedSubmarines'
import { buildPlacementCatalog } from '../rules/placements'
import type { BoardConfig, GameState } from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import {
  clearSavedGame,
  loadSavedGame,
  parseSavedGame,
  SAVED_GAME_STORAGE_KEY,
  saveGame,
  SavedGameError,
  serializeSavedGame,
  type StorageLike,
} from './savedGame'

const config: BoardConfig = {
  rows: 3,
  columns: 5,
  adjacencyRule: 'orthogonal-only',
  fleetConfig: { 2: 1, 3: 0, 4: 0, 5: 0 },
}

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(SavedGameError)
  try {
    action()
  } catch (error: unknown) {
    expect(error).toMatchObject({ code })
  }
}

function validSavedGame() {
  return {
    schemaVersion: 1,
    config,
    observations: [
      ['hit', 'unknown', 'unknown', 'unknown', 'unknown'],
      ['unknown', 'unknown', 'unknown', 'unknown', 'unknown'],
      ['unknown', 'unknown', 'unknown', 'unknown', 'miss'],
    ],
    fixedSubmarines: [],
  }
}

describe('SavedGameV1', () => {
  it('序列化并恢复正式事实，重新生成 Board 坐标', () => {
    let board = createBoard(3, 5)
    board = updateCellState(board, { row: 0, column: 0 }, 'hit')
    board = updateCellState(board, { row: 2, column: 4 }, 'miss')
    const restored = parseSavedGame(JSON.parse(serializeSavedGame(config, board, [])) as unknown)
    expect(restored.config).toEqual(config)
    expect(restored.board[0][0]).toEqual({ position: { row: 0, column: 0 }, state: 'hit' })
    expect(restored.board[2][4]).toEqual({ position: { row: 2, column: 4 }, state: 'miss' })
    expect(restored.fixedSubmarines).toEqual([])
    const serialized = serializeSavedGame(config, board, [])
    expect(serialized).not.toContain('history')
    expect(serialized).not.toContain('interaction')
    expect(serialized).not.toContain('resetUndoSnapshot')
    expect(serialized).not.toContain('probabilities')
  })

  it('通过现有规则恢复合法固定潜艇', () => {
    const placement = buildPlacementCatalog(
      config,
      config.fleetConfig,
      config.adjacencyRule,
    )[2]?.[0]
    if (!placement) throw new Error('测试候选缺失')
    const saved = validSavedGame()
    expect(parseSavedGame({
      ...saved,
      fixedSubmarines: [createFixedSubmarineFromPlacement(placement)],
    }).fixedSubmarines).toHaveLength(1)
  })

  it.each([
    ['saved-game-invalid-schema', null],
    ['saved-game-invalid-schema', { config }],
    ['saved-game-unsupported-version', { ...validSavedGame(), schemaVersion: 0 }],
    ['saved-game-unsupported-version', { ...validSavedGame(), schemaVersion: 2 }],
    ['saved-game-invalid-config', { ...validSavedGame(), config: { ...config, rows: 0 } }],
    ['saved-game-invalid-observations', { ...validSavedGame(), observations: [['unknown']] }],
    ['saved-game-invalid-observations', {
      ...validSavedGame(),
      observations: validSavedGame().observations.map((row, index) =>
        index === 0 ? ['invalid', ...row.slice(1)] : row,
      ),
    }],
  ])('按稳定错误码拒绝 %s', (code, value) => {
    expectCode(() => parseSavedGame(value), code as string)
  })

  it('拒绝伪造、冲突或与 observation 冲突的固定潜艇', () => {
    const forged = {
      id: 'forged', length: 2, orientation: 'horizontal', start: { row: 0, column: 0 },
    }
    expectCode(
      () => parseSavedGame({ ...validSavedGame(), fixedSubmarines: [forged] }),
      'saved-game-invalid-fixed-submarine',
    )
    const placement = buildPlacementCatalog(
      config,
      config.fleetConfig,
      config.adjacencyRule,
    )[2]?.[0]
    if (!placement) throw new Error('测试候选缺失')
    const fixed = createFixedSubmarineFromPlacement(placement)
    expectCode(
      () => parseSavedGame({ ...validSavedGame(), fixedSubmarines: [fixed, fixed] }),
      'saved-game-invalid-fixed-submarine',
    )
    const missConflict = validSavedGame()
    missConflict.observations[0][0] = 'miss'
    expectCode(
      () => parseSavedGame({ ...missConflict, fixedSubmarines: [fixed] }),
      'saved-game-invalid-fixed-submarine',
    )
  })

  it('区分损坏 JSON 与存储不可用', () => {
    const storage = new MemoryStorage()
    storage.values.set(SAVED_GAME_STORAGE_KEY, '{')
    expectCode(() => loadSavedGame(storage), 'saved-game-invalid-json')
    const throwing: StorageLike = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    expectCode(() => loadSavedGame(throwing), 'saved-game-storage-unavailable')
    expectCode(
      () => saveGame(throwing, { config, board: createBoard(3, 5), fixedSubmarines: [] }),
      'saved-game-storage-unavailable',
    )
    expectCode(() => clearSavedGame(throwing), 'saved-game-storage-unavailable')
  })

  it('save/load/clear 使用固定键且 config null 不写空存档', () => {
    const storage = new MemoryStorage()
    const empty: Pick<GameState, 'config' | 'board' | 'fixedSubmarines'> = {
      config: null, board: [], fixedSubmarines: [],
    }
    saveGame(storage, empty)
    expect(storage.values.size).toBe(0)
    saveGame(storage, { config, board: createBoard(3, 5), fixedSubmarines: [] })
    expect(storage.values.has(SAVED_GAME_STORAGE_KEY)).toBe(true)
    expect(loadSavedGame(storage)?.config).toEqual(config)
    clearSavedGame(storage)
    expect(loadSavedGame(storage)).toBeNull()
  })

  it('冻结输入不会被修改', () => {
    const saved = validSavedGame()
    Object.freeze(saved.config.fleetConfig)
    Object.freeze(saved.config)
    saved.observations.forEach(Object.freeze)
    Object.freeze(saved.observations)
    Object.freeze(saved.fixedSubmarines)
    Object.freeze(saved)
    expect(parseSavedGame(saved).board[0][0].state).toBe('hit')
  })
})
