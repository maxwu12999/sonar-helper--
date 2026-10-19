import type { BoardDimensions, Position } from '../types/game'

export function positionToCellIndex(
  dimensions: BoardDimensions,
  position: Position,
): number {
  return position.row * dimensions.columns + position.column
}

export function cellIndexToPosition(
  dimensions: BoardDimensions,
  index: number,
): Position {
  return {
    row: Math.floor(index / dimensions.columns),
    column: index % dimensions.columns,
  }
}

export function cellIndexToMask(index: number): bigint {
  return 1n << BigInt(index)
}

export function positionToMask(
  dimensions: BoardDimensions,
  position: Position,
): bigint {
  return cellIndexToMask(positionToCellIndex(dimensions, position))
}

export function positionsToMask(
  dimensions: BoardDimensions,
  positions: readonly Position[],
): bigint {
  let mask = 0n
  for (const position of positions) {
    mask |= positionToMask(dimensions, position)
  }
  return mask
}

export function countMaskBits(mask: bigint): number {
  let remaining = mask
  let count = 0
  while (remaining !== 0n) {
    remaining &= remaining - 1n
    count += 1
  }
  return count
}
