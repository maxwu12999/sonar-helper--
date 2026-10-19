import { describe, expect, it } from 'vitest'
import { buildBoardEvidence } from '../adapters/boardEvidence'
import type { BoardConfig, GameState } from '../types/game'
import { gameReducer, initialGameState } from './gameState'

const config: BoardConfig = {
  rows: 3,
  columns: 5,
  adjacencyRule: 'orthogonal-only',
  fleetConfig: { 2: 2, 3: 0, 4: 0, 5: 0 },
}

function created(): GameState {
  return gameReducer(initialGameState, { type: 'create', config })
}

function mark(
  state: GameState,
  row: number,
  column: number,
  observation: 'miss' | 'hit',
): GameState {
  return gameReducer(state, {
    type: 'mark-observation',
    position: { row, column },
    observation,
  })
}

function addFixed(
  state: GameState,
  row = 0,
  column = 0,
): GameState {
  let next = gameReducer(state, {
    type: 'enter-fixed-submarine-entry',
    length: 2,
    orientation: 'horizontal',
  })
  next = gameReducer(next, {
    type: 'preview-fixed-submarine',
    start: { row, column },
  })
  return gameReducer(next, { type: 'confirm-fixed-submarine' })
}

describe('game reducer observations and fixed submarines', () => {
  it('恢复存档完全替换状态且不能撤销恢复前内容', () => {
    const previous = mark(created(), 0, 0, 'miss')
    const restoredBoard = mark(created(), 1, 1, 'hit').board
    const restored = gameReducer(previous, {
      type: 'restore-saved-game',
      config,
      board: restoredBoard,
      fixedSubmarines: [],
    })
    expect(restored.board[1][1].state).toBe('hit')
    expect(restored.history).toEqual([])
    expect(restored.nextHistoryId).toBe(1)
    expect(restored.interaction).toEqual({ mode: 'observation' })
    expect(restored.resetUndoSnapshot).toBeNull()
    expect(gameReducer(restored, { type: 'undo' })).toBe(restored)

    const changed = mark(restored, 2, 4, 'miss')
    expect(gameReducer(changed, { type: 'undo' }).board[2][4].state).toBe('unknown')
  })

  it('结束对局清空全部正式和临时状态', () => {
    const state = addFixed(mark(created(), 2, 4, 'miss'))
    expect(gameReducer(state, { type: 'end-game' })).toEqual(initialGameState)
  })

  it('miss、hit、撤销和重置继续工作', () => {
    const hit = mark(created(), 0, 0, 'hit')
    const miss = mark(hit, 2, 4, 'miss')
    expect(miss.history).toHaveLength(2)
    const undone = gameReducer(miss, { type: 'undo' })
    expect(undone.board[2][4].state).toBe('unknown')
    const reset = gameReducer(undone, { type: 'reset' })
    expect(reset.history).toEqual([])
    expect(reset.board.flat().every((cell) => cell.state === 'unknown')).toBe(true)
  })

  it('添加和删除固定潜艇均以整艘为单位撤销', () => {
    const added = addFixed(created())
    expect(added.fixedSubmarines).toHaveLength(1)
    expect(gameReducer(added, { type: 'undo' }).fixedSubmarines).toEqual([])

    const removed = gameReducer(added, {
      type: 'remove-fixed-submarine',
      id: added.fixedSubmarines[0].id,
    })
    expect(removed.fixedSubmarines).toEqual([])
    const restored = gameReducer(removed, { type: 'undo' })
    expect(restored.fixedSubmarines).toEqual(added.fixedSubmarines)
    expect(gameReducer(restored, { type: 'undo' }).fixedSubmarines).toEqual([])
  })

  it('确认保留底层 hit，固定格普通模式不可重新标记，删除后 hit 重现', () => {
    const hit = mark(created(), 0, 0, 'hit')
    const added = addFixed(hit)
    expect(added.board[0][0].state).toBe('hit')
    const blocked = gameReducer(added, {
      type: 'mark-observation',
      position: { row: 0, column: 1 },
      observation: 'miss',
    })
    expect(blocked).toBe(added)

    const removed = gameReducer(added, {
      type: 'remove-fixed-submarine',
      id: added.fixedSubmarines[0].id,
    })
    expect(removed.board[0][0].state).toBe('hit')
    expect(buildBoardEvidence(config, removed.board, removed.fixedSubmarines).occupied).toContainEqual({ row: 0, column: 0 })
  })

  it('confirm 会重新校验 preview，不信任过期候选', () => {
    let previewed = gameReducer(created(), {
      type: 'enter-fixed-submarine-entry',
      length: 2,
      orientation: 'horizontal',
    })
    previewed = gameReducer(previewed, {
      type: 'preview-fixed-submarine',
      start: { row: 0, column: 0 },
    })
    expect(previewed.interaction.mode === 'fixed-submarine-entry' && previewed.interaction.preview).toBeTruthy()
    const changedBehindPreview = {
      ...previewed,
      board: previewed.board.map((row, rowIndex) =>
        row.map((cell, columnIndex) =>
          rowIndex === 0 && columnIndex === 0 ? { ...cell, state: 'miss' as const } : cell,
        ),
      ),
    }
    const confirmed = gameReducer(changedBehindPreview, {
      type: 'confirm-fixed-submarine',
    })
    expect(confirmed.fixedSubmarines).toEqual([])
    expect(confirmed.interaction).toMatchObject({
      mode: 'fixed-submarine-entry',
      error: { code: 'fixed-submarine-miss-conflict' },
    })
  })
})

describe('reset snapshot semantics', () => {
  it('reset 后立即撤销恢复 board、fixed、history 和 nextHistoryId', () => {
    const before = addFixed(mark(created(), 0, 0, 'hit'))
    const reset = gameReducer(before, { type: 'reset' })
    expect(reset.fixedSubmarines).toEqual([])
    expect(reset.history).toEqual([])
    expect(reset.nextHistoryId).toBe(1)
    const restored = gameReducer(reset, { type: 'undo' })
    expect(restored.board).toEqual(before.board)
    expect(restored.fixedSubmarines).toEqual(before.fixedSubmarines)
    expect(restored.history).toEqual(before.history)
    expect(restored.nextHistoryId).toBe(before.nextHistoryId)
  })

  it('reset 后仅切换模式和 preview，undo 仍恢复重置', () => {
    const before = mark(created(), 2, 4, 'hit')
    let reset = gameReducer(before, { type: 'reset' })
    reset = gameReducer(reset, {
      type: 'enter-fixed-submarine-entry',
      length: 2,
      orientation: 'horizontal',
    })
    reset = gameReducer(reset, {
      type: 'preview-fixed-submarine',
      start: { row: 0, column: 0 },
    })
    expect(reset.resetUndoSnapshot).not.toBeNull()
    expect(gameReducer(reset, { type: 'undo' }).board).toEqual(before.board)
  })

  it('reset 后正式 mark、add 或 remove 会使旧快照失效', () => {
    const previous = mark(created(), 2, 4, 'hit')
    const resetForMark = gameReducer(previous, { type: 'reset' })
    const marked = mark(resetForMark, 1, 4, 'miss')
    expect(marked.resetUndoSnapshot).toBeNull()

    const resetForAdd = gameReducer(previous, { type: 'reset' })
    const added = addFixed(resetForAdd)
    expect(added.resetUndoSnapshot).toBeNull()
    const removed = gameReducer(added, {
      type: 'remove-fixed-submarine',
      id: added.fixedSubmarines[0].id,
    })
    expect(removed.resetUndoSnapshot).toBeNull()
  })

  it('空白地图 reset 为 no-op，create 永久丢弃旧快照', () => {
    const blank = created()
    expect(gameReducer(blank, { type: 'reset' })).toBe(blank)

    const previous = mark(blank, 0, 0, 'hit')
    const reset = gameReducer(previous, { type: 'reset' })
    const recreated = gameReducer(reset, { type: 'create', config })
    expect(recreated.resetUndoSnapshot).toBeNull()
    expect(gameReducer(recreated, { type: 'undo' })).toBe(recreated)
  })
})
