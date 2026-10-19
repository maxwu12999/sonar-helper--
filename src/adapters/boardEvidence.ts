import type { BoardEvidence } from '../engine/types'
import {
  FixedSubmarineDomainError,
  findPlacementForFixedSubmarine,
} from '../rules/fixedSubmarines'
import { buildPlacementCatalog } from '../rules/placements'
import type {
  Board,
  BoardConfig,
  FixedSubmarine,
  Position,
} from '../types/game'

function positionKey(position: Position): string {
  return `${position.row}:${position.column}`
}

export function buildBoardEvidence(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
): BoardEvidence {
  const catalog = buildPlacementCatalog(
    config,
    config.fleetConfig,
    config.adjacencyRule,
  )
  const resolved = fixedSubmarines
    .map((submarine, index) => {
      const placement = findPlacementForFixedSubmarine(catalog, submarine)
      if (!placement) {
        throw new FixedSubmarineDomainError(
          'fixed-submarine-placement-not-found',
          `固定潜艇 ${submarine.id} 无法映射到当前规则候选`,
        )
      }
      return { submarine, placement, index }
    })
    .sort(
      (first, second) =>
        first.placement.id.localeCompare(second.placement.id) ||
        first.index - second.index,
    )
  const fixedOccupiedKeys = new Set(
    resolved.flatMap(({ placement }) =>
      placement.occupiedCells.map(positionKey),
    ),
  )
  const misses: Position[] = []
  const occupied: Position[] = []
  for (const row of board) {
    for (const cell of row) {
      if (cell.state === 'miss') {
        misses.push({ ...cell.position })
      } else if (
        cell.state === 'hit' &&
        !fixedOccupiedKeys.has(positionKey(cell.position))
      ) {
        occupied.push({ ...cell.position })
      }
    }
  }
  return {
    misses,
    occupied,
    fixedPlacements: resolved.map(({ submarine }) => ({
      length: submarine.length,
      orientation: submarine.orientation,
      start: { ...submarine.start },
    })),
  }
}
