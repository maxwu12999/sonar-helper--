import {
  SUBMARINE_LENGTHS,
  type AdjacencyRule,
  type BoardDimensions,
  type FleetConfig,
  type Orientation,
  type Placement,
  type PlacementCatalog,
  type Position,
  type SubmarineLength,
  type SubmarineSpec,
} from '../types/game'

const ORIENTATIONS: readonly Orientation[] = ['horizontal', 'vertical']

const ORTHOGONAL_OFFSETS: readonly Position[] = [
  { row: -1, column: 0 },
  { row: 0, column: -1 },
  { row: 0, column: 1 },
  { row: 1, column: 0 },
]

const DIAGONAL_OFFSETS: readonly Position[] = [
  { row: -1, column: -1 },
  { row: -1, column: 1 },
  { row: 1, column: -1 },
  { row: 1, column: 1 },
]

function positionKey(position: Position): string {
  return `${position.row}:${position.column}`
}

function getAdjacencyOffsets(rule: AdjacencyRule): readonly Position[] {
  return rule === 'orthogonal-and-diagonal'
    ? [...ORTHOGONAL_OFFSETS, ...DIAGONAL_OFFSETS]
    : ORTHOGONAL_OFFSETS
}

export function isPositionInBounds(
  dimensions: BoardDimensions,
  position: Position,
): boolean {
  return (
    position.row >= 0 &&
    position.row < dimensions.rows &&
    position.column >= 0 &&
    position.column < dimensions.columns
  )
}

export function getOccupiedCells(
  start: Position,
  orientation: Orientation,
  length: SubmarineLength,
): readonly Position[] {
  return Array.from({ length }, (_, offset) => ({
    row: start.row + (orientation === 'vertical' ? offset : 0),
    column: start.column + (orientation === 'horizontal' ? offset : 0),
  }))
}

export function getForbiddenCells(
  dimensions: BoardDimensions,
  occupiedCells: readonly Position[],
  adjacencyRule: AdjacencyRule,
): readonly Position[] {
  const occupiedKeys = new Set(occupiedCells.map(positionKey))
  const forbiddenByKey = new Map<string, Position>()

  for (const cell of occupiedCells) {
    for (const offset of getAdjacencyOffsets(adjacencyRule)) {
      const adjacent = {
        row: cell.row + offset.row,
        column: cell.column + offset.column,
      }
      const key = positionKey(adjacent)

      if (
        isPositionInBounds(dimensions, adjacent) &&
        !occupiedKeys.has(key)
      ) {
        forbiddenByKey.set(key, adjacent)
      }
    }
  }

  return [...forbiddenByKey.values()].sort(
    (first, second) =>
      first.row - second.row || first.column - second.column,
  )
}

export function isPlacementInBounds(
  dimensions: BoardDimensions,
  start: Position,
  orientation: Orientation,
  length: SubmarineLength,
): boolean {
  return getOccupiedCells(start, orientation, length).every((position) =>
    isPositionInBounds(dimensions, position),
  )
}

export function generatePlacements(
  dimensions: BoardDimensions,
  length: SubmarineLength,
  adjacencyRule: AdjacencyRule,
): readonly Placement[] {
  const spec: SubmarineSpec = { length }
  const placements: Placement[] = []

  for (const orientation of ORIENTATIONS) {
    for (let row = 0; row < dimensions.rows; row += 1) {
      for (let column = 0; column < dimensions.columns; column += 1) {
        const start = { row, column }
        if (!isPlacementInBounds(dimensions, start, orientation, length)) {
          continue
        }

        const occupiedCells = getOccupiedCells(start, orientation, length)
        placements.push({
          id: `length-${length}-${orientation}-row-${row}-column-${column}`,
          spec,
          orientation,
          start,
          occupiedCells,
          forbiddenCells: getForbiddenCells(
            dimensions,
            occupiedCells,
            adjacencyRule,
          ),
        })
      }
    }
  }

  return placements
}

export function buildPlacementCatalog(
  dimensions: BoardDimensions,
  fleetConfig: FleetConfig,
  adjacencyRule: AdjacencyRule,
): PlacementCatalog {
  const catalog: Partial<Record<SubmarineLength, readonly Placement[]>> = {}

  for (const length of SUBMARINE_LENGTHS) {
    if (fleetConfig[length] > 0) {
      catalog[length] = generatePlacements(
        dimensions,
        length,
        adjacencyRule,
      )
    }
  }

  return catalog
}

export function doPlacementsConflict(
  first: Placement,
  second: Placement,
  adjacencyRule: AdjacencyRule,
): boolean {
  for (const firstCell of first.occupiedCells) {
    for (const secondCell of second.occupiedCells) {
      const rowDistance = Math.abs(firstCell.row - secondCell.row)
      const columnDistance = Math.abs(firstCell.column - secondCell.column)

      if (rowDistance === 0 && columnDistance === 0) {
        return true
      }

      const orthogonallyAdjacent = rowDistance + columnDistance === 1
      const diagonallyAdjacent = rowDistance === 1 && columnDistance === 1

      if (
        orthogonallyAdjacent ||
        (adjacencyRule === 'orthogonal-and-diagonal' && diagonallyAdjacent)
      ) {
        return true
      }
    }
  }

  return false
}
