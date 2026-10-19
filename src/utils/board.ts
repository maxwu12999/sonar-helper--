import type { Board, Cell, CellObservation, Position } from '../types/game'

export function createBoard(rows: number, columns: number): Board {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column): Cell => ({
      position: { row, column },
      state: 'unknown',
    })),
  )
}

export function getCell(board: Board, position: Position): Cell | undefined {
  return board[position.row]?.[position.column]
}

export function updateCellState(
  board: Board,
  position: Position,
  state: CellObservation,
): Board {
  if (!getCell(board, position)) return board
  return board.map((row, rowIndex) =>
    rowIndex === position.row
      ? row.map((cell, columnIndex) =>
          columnIndex === position.column ? { ...cell, state } : cell,
        )
      : row,
  )
}

export function countCellsByState(
  board: Board,
  state: CellObservation,
): number {
  return board.reduce(
    (total, row) =>
      total + row.filter((cell) => cell.state === state).length,
    0,
  )
}

export function formatPosition(position: Position): string {
  return `第 ${position.row + 1} 行，第 ${position.column + 1} 列`
}
