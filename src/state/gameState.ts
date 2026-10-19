import {
  isPositionOccupiedByFixedSubmarine,
  validateFixedSubmarine,
  validateFixedSubmarineInput,
} from '../rules/fixedSubmarines'
import type {
  FixedSubmarine,
  GameAction,
  GameHistoryEntry,
  GameState,
} from '../types/game'
import {
  countCellsByState,
  createBoard,
  getCell,
  updateCellState,
} from '../utils/board'

const observationInteraction = { mode: 'observation' } as const

type NewHistoryEntry = GameHistoryEntry extends infer Entry
  ? Entry extends GameHistoryEntry
    ? Omit<Entry, 'id'>
    : never
  : never

export const initialGameState: GameState = {
  config: null,
  board: [],
  fixedSubmarines: [],
  history: [],
  nextHistoryId: 1,
  interaction: observationInteraction,
  resetUndoSnapshot: null,
}

function appendHistory(
  state: GameState,
  entry: NewHistoryEntry,
): Pick<GameState, 'history' | 'nextHistoryId'> {
  return {
    history: [
      ...state.history,
      { ...entry, id: state.nextHistoryId } as GameHistoryEntry,
    ],
    nextHistoryId: state.nextHistoryId + 1,
  }
}

function insertFixedSubmarine(
  submarines: readonly FixedSubmarine[],
  submarine: FixedSubmarine,
  index: number,
): readonly FixedSubmarine[] {
  return [
    ...submarines.slice(0, index),
    submarine,
    ...submarines.slice(index),
  ]
}

function isBlankState(state: GameState): boolean {
  return (
    state.fixedSubmarines.length === 0 &&
    state.history.length === 0 &&
    countCellsByState(state.board, 'unknown') ===
      state.board.length * (state.board[0]?.length ?? 0)
  )
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'create':
      return {
        config: action.config,
        board: createBoard(action.config.rows, action.config.columns),
        fixedSubmarines: [],
        history: [],
        nextHistoryId: 1,
        interaction: observationInteraction,
        resetUndoSnapshot: null,
      }

    case 'restore-saved-game':
      return {
        config: action.config,
        board: action.board,
        fixedSubmarines: action.fixedSubmarines,
        history: [],
        nextHistoryId: 1,
        interaction: observationInteraction,
        resetUndoSnapshot: null,
      }

    case 'end-game':
      return initialGameState

    case 'mark-observation': {
      if (!state.config || state.interaction.mode !== 'observation') return state
      const cell = getCell(state.board, action.position)
      if (!cell || cell.state !== 'unknown') return state
      if (
        isPositionOccupiedByFixedSubmarine(
          state.config,
          state.fixedSubmarines,
          action.position,
        )
      ) {
        return state
      }
      return {
        ...state,
        board: updateCellState(state.board, action.position, action.observation),
        ...appendHistory(state, {
          type: 'cell-observation-changed',
          position: action.position,
          previousObservation: cell.state,
          nextObservation: action.observation,
        }),
        resetUndoSnapshot: null,
      }
    }

    case 'enter-fixed-submarine-entry':
    case 'configure-fixed-submarine-entry':
      if (!state.config) return state
      return {
        ...state,
        interaction: {
          mode: 'fixed-submarine-entry',
          length: action.length,
          orientation: action.orientation,
          preview: null,
          error: null,
        },
      }

    case 'preview-fixed-submarine': {
      if (!state.config || state.interaction.mode !== 'fixed-submarine-entry') {
        return state
      }
      const result = validateFixedSubmarineInput(
        state.config,
        state.board,
        state.fixedSubmarines,
        {
          length: state.interaction.length,
          orientation: state.interaction.orientation,
          start: action.start,
        },
      )
      return {
        ...state,
        interaction: {
          ...state.interaction,
          preview: result.valid ? result.submarine : null,
          error: result.valid ? null : result.error,
        },
      }
    }

    case 'confirm-fixed-submarine': {
      if (
        !state.config ||
        state.interaction.mode !== 'fixed-submarine-entry' ||
        !state.interaction.preview
      ) {
        return state
      }
      const result = validateFixedSubmarine(
        state.config,
        state.board,
        state.fixedSubmarines,
        state.interaction.preview,
      )
      if (!result.valid) {
        return {
          ...state,
          interaction: {
            ...state.interaction,
            preview: null,
            error: result.error,
          },
        }
      }
      return {
        ...state,
        fixedSubmarines: [...state.fixedSubmarines, result.submarine],
        ...appendHistory(state, {
          type: 'fixed-submarine-added',
          submarine: result.submarine,
        }),
        interaction: observationInteraction,
        resetUndoSnapshot: null,
      }
    }

    case 'cancel-fixed-submarine-entry':
      return state.config
        ? { ...state, interaction: observationInteraction }
        : state

    case 'remove-fixed-submarine': {
      const previousIndex = state.fixedSubmarines.findIndex(
        (submarine) => submarine.id === action.id,
      )
      if (previousIndex < 0) return state
      const submarine = state.fixedSubmarines[previousIndex]
      return {
        ...state,
        fixedSubmarines: state.fixedSubmarines.filter(
          (candidate) => candidate.id !== action.id,
        ),
        ...appendHistory(state, {
          type: 'fixed-submarine-removed',
          submarine,
          previousIndex,
        }),
        interaction: observationInteraction,
        resetUndoSnapshot: null,
      }
    }

    case 'undo': {
      const lastEntry = state.history.at(-1)
      if (!lastEntry) {
        if (!state.resetUndoSnapshot) return state
        return {
          ...state,
          ...state.resetUndoSnapshot,
          interaction: observationInteraction,
          resetUndoSnapshot: null,
        }
      }
      const history = state.history.slice(0, -1)
      if (lastEntry.type === 'cell-observation-changed') {
        return {
          ...state,
          board: updateCellState(
            state.board,
            lastEntry.position,
            lastEntry.previousObservation,
          ),
          history,
          interaction: observationInteraction,
        }
      }
      if (lastEntry.type === 'fixed-submarine-added') {
        return {
          ...state,
          fixedSubmarines: state.fixedSubmarines.filter(
            (submarine) => submarine.id !== lastEntry.submarine.id,
          ),
          history,
          interaction: observationInteraction,
        }
      }
      return {
        ...state,
        fixedSubmarines: insertFixedSubmarine(
          state.fixedSubmarines,
          lastEntry.submarine,
          lastEntry.previousIndex,
        ),
        history,
        interaction: observationInteraction,
      }
    }

    case 'reset':
      if (!state.config || isBlankState(state)) return state
      return {
        ...state,
        board: createBoard(state.config.rows, state.config.columns),
        fixedSubmarines: [],
        history: [],
        nextHistoryId: 1,
        interaction: observationInteraction,
        resetUndoSnapshot: {
          board: state.board,
          fixedSubmarines: state.fixedSubmarines,
          history: state.history,
          nextHistoryId: state.nextHistoryId,
        },
      }
  }
}
