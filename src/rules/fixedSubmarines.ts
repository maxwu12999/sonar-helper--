import {
  SUBMARINE_LENGTHS,
  type Board,
  type BoardConfig,
  type FixedSubmarine,
  type FixedSubmarineValidationError,
  type FixedSubmarineValidationErrorCode,
  type Orientation,
  type Placement,
  type PlacementCatalog,
  type Position,
  type SubmarineLength,
} from '../types/game'
import {
  buildPlacementCatalog,
  doPlacementsConflict,
  isPlacementInBounds,
} from './placements'

export class FixedSubmarineDomainError extends Error {
  readonly code: FixedSubmarineValidationErrorCode

  constructor(code: FixedSubmarineValidationErrorCode, message: string) {
    super(message)
    this.name = 'FixedSubmarineDomainError'
    this.code = code
  }
}

export interface FixedSubmarineInput {
  readonly length: SubmarineLength
  readonly orientation: Orientation
  readonly start: Position
}

export type FixedSubmarineValidationResult =
  | {
      readonly valid: true
      readonly submarine: FixedSubmarine
      readonly placement: Placement
    }
  | {
      readonly valid: false
      readonly error: FixedSubmarineValidationError
    }

function positionKey(position: Position): string {
  return `${position.row}:${position.column}`
}

function error(
  code: FixedSubmarineValidationErrorCode,
  message: string,
): FixedSubmarineValidationResult {
  return { valid: false, error: { code, message } }
}

function isValidInput(input: FixedSubmarineInput): boolean {
  return (
    SUBMARINE_LENGTHS.includes(input.length) &&
    (input.orientation === 'horizontal' || input.orientation === 'vertical') &&
    Number.isSafeInteger(input.start.row) &&
    Number.isSafeInteger(input.start.column)
  )
}

export function createFixedSubmarineFromPlacement(
  placement: Placement,
): FixedSubmarine {
  return {
    id: placement.id,
    length: placement.spec.length,
    orientation: placement.orientation,
    start: placement.start,
  }
}

export function findPlacementForFixedSubmarine(
  catalog: PlacementCatalog,
  submarine: FixedSubmarine,
): Placement | null {
  return (
    (catalog[submarine.length] ?? []).find(
      (placement) =>
        placement.id === submarine.id &&
        placement.orientation === submarine.orientation &&
        placement.start.row === submarine.start.row &&
        placement.start.column === submarine.start.column,
    ) ?? null
  )
}

export function findPlacementForInput(
  catalog: PlacementCatalog,
  input: FixedSubmarineInput,
): Placement | null {
  return (
    (catalog[input.length] ?? []).find(
      (placement) =>
        placement.orientation === input.orientation &&
        placement.start.row === input.start.row &&
        placement.start.column === input.start.column,
    ) ?? null
  )
}

function validatePlacementAgainstState(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
  placement: Placement,
  catalog: PlacementCatalog,
): FixedSubmarineValidationResult {
  const submarine = createFixedSubmarineFromPlacement(placement)
  if (fixedSubmarines.some((fixed) => fixed.id === submarine.id)) {
    return error('duplicate-fixed-submarine', '该已击沉潜艇已经记录')
  }
  const fixedOfLength = fixedSubmarines.filter(
    (fixed) => fixed.length === submarine.length,
  ).length
  if (fixedOfLength >= config.fleetConfig[submarine.length]) {
    return error(
      'fixed-submarine-count-exceeded',
      `长度 ${submarine.length} 的已击沉潜艇数量已达到舰队配置上限`,
    )
  }

  const missKeys = new Set<string>()
  const hitKeys = new Set<string>()
  for (const row of board) {
    for (const cell of row) {
      if (cell.state === 'miss') missKeys.add(positionKey(cell.position))
      if (cell.state === 'hit') hitKeys.add(positionKey(cell.position))
    }
  }
  if (placement.occupiedCells.some((cell) => missKeys.has(positionKey(cell)))) {
    return error(
      'fixed-submarine-miss-conflict',
      '已击沉潜艇不能覆盖标记为未命中的格子',
    )
  }
  if (placement.forbiddenCells.some((cell) => hitKeys.has(positionKey(cell)))) {
    return error(
      'fixed-submarine-hit-conflict',
      '候选潜艇的禁止邻接区域内存在尚未归属的命中格',
    )
  }

  for (const fixed of fixedSubmarines) {
    const existingPlacement = findPlacementForFixedSubmarine(catalog, fixed)
    if (!existingPlacement) {
      return error(
        'fixed-submarine-placement-not-found',
        '已有固定潜艇无法映射到当前规则候选',
      )
    }
    if (!doPlacementsConflict(placement, existingPlacement, config.adjacencyRule)) {
      continue
    }
    const occupiedKeys = new Set(
      existingPlacement.occupiedCells.map(positionKey),
    )
    if (placement.occupiedCells.some((cell) => occupiedKeys.has(positionKey(cell)))) {
      return error('fixed-submarine-overlap', '已击沉潜艇不能相互重叠')
    }
    return error(
      'fixed-submarine-adjacency-conflict',
      '已击沉潜艇之间的间隔不符合当前邻接规则',
    )
  }

  return { valid: true, submarine, placement }
}

export function validateFixedSubmarineInput(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
  input: FixedSubmarineInput,
): FixedSubmarineValidationResult {
  if (!isValidInput(input)) {
    return error('invalid-fixed-submarine-spec', '潜艇长度、方向或起点无效')
  }
  if (!isPlacementInBounds(config, input.start, input.orientation, input.length)) {
    return error('fixed-submarine-out-of-bounds', '候选潜艇超出地图范围')
  }
  const catalog = buildPlacementCatalog(
    config,
    config.fleetConfig,
    config.adjacencyRule,
  )
  const placement = findPlacementForInput(catalog, input)
  if (!placement) {
    return error(
      'fixed-submarine-placement-not-found',
      '候选潜艇无法映射到当前规则生成的位置',
    )
  }
  return validatePlacementAgainstState(
    config,
    board,
    fixedSubmarines,
    placement,
    catalog,
  )
}

export function validateFixedSubmarine(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
  submarine: FixedSubmarine,
): FixedSubmarineValidationResult {
  const catalog = buildPlacementCatalog(
    config,
    config.fleetConfig,
    config.adjacencyRule,
  )
  const placement = findPlacementForFixedSubmarine(catalog, submarine)
  if (!placement) {
    return error(
      'fixed-submarine-placement-not-found',
      '固定潜艇无法映射到当前规则生成的位置',
    )
  }
  return validatePlacementAgainstState(
    config,
    board,
    fixedSubmarines,
    placement,
    catalog,
  )
}

export function resolveFixedSubmarinePlacements(
  config: BoardConfig,
  fixedSubmarines: readonly FixedSubmarine[],
): readonly Placement[] {
  const catalog = buildPlacementCatalog(
    config,
    config.fleetConfig,
    config.adjacencyRule,
  )
  return fixedSubmarines.map((submarine) => {
    const placement = findPlacementForFixedSubmarine(catalog, submarine)
    if (!placement) {
      throw new FixedSubmarineDomainError(
        'fixed-submarine-placement-not-found',
        `固定潜艇 ${submarine.id} 无法映射到当前规则候选`,
      )
    }
    return placement
  })
}

export function isPositionOccupiedByFixedSubmarine(
  config: BoardConfig,
  fixedSubmarines: readonly FixedSubmarine[],
  position: Position,
): boolean {
  return resolveFixedSubmarinePlacements(config, fixedSubmarines).some(
    (placement) =>
      placement.occupiedCells.some(
        (cell) => cell.row === position.row && cell.column === position.column,
      ),
  )
}
