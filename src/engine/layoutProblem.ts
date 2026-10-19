import {
  buildPlacementCatalog,
  isPlacementInBounds,
} from '../rules/placements'
import {
  SUBMARINE_LENGTHS,
  type BoardConfig,
  type FleetConfig,
  type Placement,
  type PlacementCatalog,
  type SubmarineLength,
} from '../types/game'
import {
  getFleetOccupiedCellCount,
  getFleetSubmarineCount,
} from '../utils/fleet'
import {
  cellIndexToMask,
  countMaskBits,
  positionToMask,
  positionsToMask,
} from './bitboard'
import {
  LayoutAnalysisError,
  type BoardEvidence,
  type FixedPlacementEvidence,
} from './types'

export interface EngineCandidate {
  readonly placementIndex: number
  readonly occupiedMask: bigint
  readonly blockedMask: bigint
}

export interface PreparedShipGroup {
  readonly length: SubmarineLength
  readonly count: number
  readonly candidates: readonly EngineCandidate[]
}

export interface PreparedLayoutProblem {
  readonly config: BoardConfig
  readonly groups: readonly PreparedShipGroup[]
  readonly requiredOccupiedMask: bigint
  readonly initialOccupiedMask: bigint
  readonly initialBlockedMask: bigint
  readonly cellCount: number
  readonly cellMasks: readonly bigint[]
  readonly totalFleetOccupiedCells: number
}

interface NormalizedEvidence {
  readonly missMask: bigint
  readonly requiredOccupiedMask: bigint
  readonly fixedOccupiedMask: bigint
  readonly fixedBlockedMask: bigint
  readonly fixedCounts: FleetConfig
}

export function createNumberMatrix(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, () => Array<number>(columns).fill(0))
}

function validateConfig(config: BoardConfig): void {
  if (config === null || typeof config !== 'object') {
    throw new LayoutAnalysisError(
      'invalid-board-dimensions',
      '地图配置必须是有效对象',
    )
  }
  if (
    !Number.isSafeInteger(config.rows) ||
    !Number.isSafeInteger(config.columns) ||
    config.rows < 1 ||
    config.rows > 10 ||
    config.columns < 1 ||
    config.columns > 10
  ) {
    throw new LayoutAnalysisError(
      'invalid-board-dimensions',
      '地图行数和列数必须是 1～10 的整数',
    )
  }
  if (
    config.adjacencyRule !== 'orthogonal-only' &&
    config.adjacencyRule !== 'orthogonal-and-diagonal'
  ) {
    throw new LayoutAnalysisError(
      'invalid-adjacency-rule',
      '潜艇邻接规则无效',
    )
  }
  if (
    config.fleetConfig === null ||
    typeof config.fleetConfig !== 'object'
  ) {
    throw new LayoutAnalysisError(
      'invalid-fleet-count',
      '舰队配置必须包含长度 2～5 的潜艇数量',
    )
  }
  for (const length of SUBMARINE_LENGTHS) {
    const count = config.fleetConfig[length]
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new LayoutAnalysisError(
        'invalid-fleet-count',
        `长度 ${length} 的潜艇数量必须是非负安全整数`,
      )
    }
  }
  if (getFleetSubmarineCount(config.fleetConfig) === 0) {
    throw new LayoutAnalysisError('empty-fleet', '舰队至少需要一艘潜艇')
  }
  if (
    getFleetOccupiedCellCount(config.fleetConfig) >
    config.rows * config.columns
  ) {
    throw new LayoutAnalysisError(
      'fleet-exceeds-board',
      '舰队占用格数不能超过地图格数',
    )
  }
  const longestSide = Math.max(config.rows, config.columns)
  const oversizedLength = SUBMARINE_LENGTHS.find(
    (length) =>
      config.fleetConfig[length] > 0 && length > longestSide,
  )
  if (oversizedLength !== undefined) {
    throw new LayoutAnalysisError(
      'submarine-does-not-fit',
      `长度 ${oversizedLength} 的潜艇无法放入当前地图`,
    )
  }
}

function validateEvidencePosition(
  config: BoardConfig,
  position: { readonly row: number; readonly column: number },
): void {
  if (position === null || typeof position !== 'object') {
    throw new LayoutAnalysisError('invalid-evidence', '证据坐标必须是有效对象')
  }
  if (!Number.isSafeInteger(position.row) || !Number.isSafeInteger(position.column)) {
    throw new LayoutAnalysisError(
      'invalid-evidence',
      '证据坐标的行列必须是整数',
    )
  }
  if (
    position.row < 0 ||
    position.row >= config.rows ||
    position.column < 0 ||
    position.column >= config.columns
  ) {
    throw new LayoutAnalysisError(
      'evidence-out-of-bounds',
      `证据坐标第 ${position.row + 1} 行，第 ${position.column + 1} 列超出地图范围`,
    )
  }
}

function toEngineCandidate(
  config: BoardConfig,
  placement: Placement,
  placementIndex: number,
): EngineCandidate {
  const occupiedMask = positionsToMask(config, placement.occupiedCells)
  const forbiddenMask = positionsToMask(config, placement.forbiddenCells)
  return {
    placementIndex,
    occupiedMask,
    blockedMask: occupiedMask | forbiddenMask,
  }
}

function normalizeEvidence(
  config: BoardConfig,
  evidence: BoardEvidence,
  catalog: PlacementCatalog,
): NormalizedEvidence {
  if (
    evidence === null ||
    typeof evidence !== 'object' ||
    !Array.isArray(evidence.misses) ||
    !Array.isArray(evidence.occupied)
  ) {
    throw new LayoutAnalysisError(
      'invalid-evidence',
      'misses 和 occupied 必须是坐标数组',
    )
  }

  let missMask = 0n
  for (const position of evidence.misses) {
    validateEvidencePosition(config, position)
    missMask |= positionToMask(config, position)
  }
  let requiredOccupiedMask = 0n
  for (const position of evidence.occupied) {
    validateEvidencePosition(config, position)
    requiredOccupiedMask |= positionToMask(config, position)
  }
  if ((missMask & requiredOccupiedMask) !== 0n) {
    throw new LayoutAnalysisError(
      'evidence-conflict',
      '同一格不能同时标记为已知为空和已知有潜艇',
    )
  }
  if (
    evidence.fixedPlacements !== undefined &&
    !Array.isArray(evidence.fixedPlacements)
  ) {
    throw new LayoutAnalysisError(
      'invalid-fixed-placement',
      'fixedPlacements 必须是固定潜艇数组',
    )
  }

  const uniqueFixedPlacements: FixedPlacementEvidence[] = []
  const fixedKeys = new Set<string>()
  for (const fixed of evidence.fixedPlacements ?? []) {
    if (
      fixed === null ||
      typeof fixed !== 'object' ||
      !SUBMARINE_LENGTHS.includes(fixed.length) ||
      (fixed.orientation !== 'horizontal' && fixed.orientation !== 'vertical') ||
      fixed.start === null ||
      typeof fixed.start !== 'object' ||
      !Number.isSafeInteger(fixed.start.row) ||
      !Number.isSafeInteger(fixed.start.column)
    ) {
      throw new LayoutAnalysisError(
        'invalid-fixed-placement',
        '固定潜艇必须包含有效的长度、方向和整数起点',
      )
    }
    if (
      !isPlacementInBounds(
        config,
        fixed.start,
        fixed.orientation,
        fixed.length,
      )
    ) {
      throw new LayoutAnalysisError(
        'fixed-placement-out-of-bounds',
        '固定潜艇超出地图范围',
      )
    }
    const key = `${fixed.length}:${fixed.orientation}:${fixed.start.row}:${fixed.start.column}`
    if (!fixedKeys.has(key)) {
      fixedKeys.add(key)
      uniqueFixedPlacements.push(fixed)
    }
  }

  const mutableFixedCounts: Record<SubmarineLength, number> = {
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  }
  for (const fixed of uniqueFixedPlacements) {
    mutableFixedCounts[fixed.length] += 1
  }
  for (const length of SUBMARINE_LENGTHS) {
    if (mutableFixedCounts[length] > config.fleetConfig[length]) {
      throw new LayoutAnalysisError(
        'fixed-placement-count-exceeded',
        `固定的长度 ${length} 潜艇数量超过舰队配置`,
      )
    }
  }

  let fixedOccupiedMask = 0n
  let fixedBlockedMask = 0n
  for (const fixed of uniqueFixedPlacements) {
    const placement = (catalog[fixed.length] ?? []).find(
      (candidate) =>
        candidate.orientation === fixed.orientation &&
        candidate.start.row === fixed.start.row &&
        candidate.start.column === fixed.start.column,
    )
    if (!placement) {
      throw new LayoutAnalysisError(
        'invalid-fixed-placement',
        '固定潜艇无法转换为规则生成的候选位置',
      )
    }
    const candidate = toEngineCandidate(config, placement, 0)
    if ((candidate.occupiedMask & fixedBlockedMask) !== 0n) {
      throw new LayoutAnalysisError(
        'fixed-placement-conflict',
        '固定潜艇之间存在重叠或非法邻接',
      )
    }
    fixedOccupiedMask |= candidate.occupiedMask
    fixedBlockedMask |= candidate.blockedMask
  }
  if ((missMask & fixedOccupiedMask) !== 0n) {
    throw new LayoutAnalysisError(
      'fixed-placement-miss-conflict',
      '已知为空的格子不能属于固定潜艇',
    )
  }

  return {
    missMask,
    requiredOccupiedMask,
    fixedOccupiedMask,
    fixedBlockedMask,
    fixedCounts: mutableFixedCounts,
  }
}

function buildShipGroups(
  config: BoardConfig,
  fleetConfig: FleetConfig,
  catalog: PlacementCatalog,
  missMask: bigint,
  initialBlockedMask: bigint,
): readonly PreparedShipGroup[] {
  const groups: PreparedShipGroup[] = []
  for (const length of SUBMARINE_LENGTHS) {
    const count = fleetConfig[length]
    if (count === 0) continue
    const candidates = (catalog[length] ?? [])
      .map((placement, placementIndex) =>
        toEngineCandidate(config, placement, placementIndex),
      )
      .filter((candidate) => (candidate.occupiedMask & missMask) === 0n)
      .filter(
        (candidate) =>
          (candidate.occupiedMask & initialBlockedMask) === 0n,
      )
    groups.push({ length, count, candidates })
  }
  return groups.sort(
    (first, second) =>
      first.candidates.length - second.candidates.length ||
      second.length - first.length,
  )
}

export function prepareLayoutProblem(
  config: BoardConfig,
  evidence: BoardEvidence,
): PreparedLayoutProblem {
  validateConfig(config)
  const catalog = buildPlacementCatalog(
    config,
    config.fleetConfig,
    config.adjacencyRule,
  )
  const normalized = normalizeEvidence(config, evidence, catalog)
  const remainingFleetConfig: FleetConfig = {
    2: config.fleetConfig[2] - normalized.fixedCounts[2],
    3: config.fleetConfig[3] - normalized.fixedCounts[3],
    4: config.fleetConfig[4] - normalized.fixedCounts[4],
    5: config.fleetConfig[5] - normalized.fixedCounts[5],
  }
  const groups = buildShipGroups(
    config,
    remainingFleetConfig,
    catalog,
    normalized.missMask,
    normalized.fixedBlockedMask,
  )
  const cellCount = config.rows * config.columns
  return {
    config,
    groups,
    requiredOccupiedMask: normalized.requiredOccupiedMask,
    initialOccupiedMask: normalized.fixedOccupiedMask,
    initialBlockedMask: normalized.fixedBlockedMask,
    cellCount,
    cellMasks: Array.from({ length: cellCount }, (_, index) =>
      cellIndexToMask(index),
    ),
    totalFleetOccupiedCells: getFleetOccupiedCellCount(config.fleetConfig),
  }
}

export function canRemainingShipsCoverEvidence(
  problem: PreparedLayoutProblem,
  groupIndex: number,
  remainingInGroup: number,
  nextCandidateIndex: number,
  occupiedMask: bigint,
  currentBlockedMask: bigint,
): boolean {
  const uncoveredMask = problem.requiredOccupiedMask & ~occupiedMask
  if (uncoveredMask === 0n) return true
  if ((uncoveredMask & currentBlockedMask) !== 0n) return false

  let remainingCapacity = 0
  let coverableMask = 0n
  for (let index = groupIndex; index < problem.groups.length; index += 1) {
    const group = problem.groups[index]
    const remainingCount =
      index === groupIndex ? remainingInGroup : group.count
    const candidateStart = index === groupIndex ? nextCandidateIndex : 0
    let compatibleCandidates = 0
    remainingCapacity += remainingCount * group.length
    for (
      let candidateIndex = candidateStart;
      candidateIndex < group.candidates.length;
      candidateIndex += 1
    ) {
      const candidate = group.candidates[candidateIndex]
      if ((candidate.occupiedMask & currentBlockedMask) === 0n) {
        compatibleCandidates += 1
        coverableMask |= candidate.occupiedMask
      }
    }
    if (compatibleCandidates < remainingCount) return false
  }
  return (
    countMaskBits(uncoveredMask) <= remainingCapacity &&
    (uncoveredMask & ~coverableMask) === 0n
  )
}
