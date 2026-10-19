import { buildBoardEvidence } from '../adapters/boardEvidence'
import { validateFixedSubmarine } from '../rules/fixedSubmarines'
import type {
  Board,
  BoardConfig,
  CellObservation,
  FixedSubmarine,
  GameState,
} from '../types/game'
import { createBoard, updateCellState } from '../utils/board'
import { validateSetup } from '../utils/validation'

export const SAVED_GAME_STORAGE_KEY = 'sonar-helper.saved-game'

export interface SavedGameV1 {
  readonly schemaVersion: 1
  readonly config: BoardConfig
  readonly observations: readonly (readonly CellObservation[])[]
  readonly fixedSubmarines: readonly FixedSubmarine[]
}

export interface RestoredSavedGame {
  readonly config: BoardConfig
  readonly board: Board
  readonly fixedSubmarines: readonly FixedSubmarine[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SavedGameErrorCode =
  | 'saved-game-invalid-json'
  | 'saved-game-invalid-schema'
  | 'saved-game-unsupported-version'
  | 'saved-game-invalid-config'
  | 'saved-game-invalid-observations'
  | 'saved-game-invalid-fixed-submarine'
  | 'saved-game-storage-unavailable'

export class SavedGameError extends Error {
  readonly code: SavedGameErrorCode

  constructor(code: SavedGameErrorCode, message: string) {
    super(message)
    this.name = 'SavedGameError'
    this.code = code
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function parseConfig(value: unknown): BoardConfig {
  if (!isPlainObject(value) || !isPlainObject(value.fleetConfig)) {
    throw new SavedGameError('saved-game-invalid-config', '本地存档中的地图配置无效')
  }
  const fleet = value.fleetConfig
  if (
    typeof value.rows !== 'number' ||
    typeof value.columns !== 'number' ||
    typeof value.adjacencyRule !== 'string' ||
    typeof fleet[2] !== 'number' ||
    typeof fleet[3] !== 'number' ||
    typeof fleet[4] !== 'number' ||
    typeof fleet[5] !== 'number'
  ) {
    throw new SavedGameError('saved-game-invalid-config', '本地存档中的地图配置无效')
  }
  const result = validateSetup({
    rows: String(value.rows),
    columns: String(value.columns),
    adjacencyRule: value.adjacencyRule,
    length2Count: String(fleet[2]),
    length3Count: String(fleet[3]),
    length4Count: String(fleet[4]),
    length5Count: String(fleet[5]),
  })
  if (!result.config) {
    throw new SavedGameError('saved-game-invalid-config', '本地存档中的地图配置无效')
  }
  return result.config
}

function parseObservations(
  value: unknown,
  config: BoardConfig,
): readonly (readonly CellObservation[])[] {
  if (
    !Array.isArray(value) ||
    value.length !== config.rows ||
    value.some((row) => !Array.isArray(row) || row.length !== config.columns)
  ) {
    throw new SavedGameError(
      'saved-game-invalid-observations',
      '本地存档中的格子记录尺寸无效',
    )
  }
  return value.map((row) => {
    if (!Array.isArray(row)) {
      throw new SavedGameError(
        'saved-game-invalid-observations',
        '本地存档中的格子记录无效',
      )
    }
    return row.map((observation) => {
      if (
        observation !== 'unknown' &&
        observation !== 'miss' &&
        observation !== 'hit'
      ) {
        throw new SavedGameError(
          'saved-game-invalid-observations',
          '本地存档包含无效格子状态',
        )
      }
      return observation
    })
  })
}

function rebuildBoard(
  config: BoardConfig,
  observations: readonly (readonly CellObservation[])[],
): Board {
  let board = createBoard(config.rows, config.columns)
  for (let row = 0; row < config.rows; row += 1) {
    for (let column = 0; column < config.columns; column += 1) {
      const observation = observations[row][column]
      if (observation !== 'unknown') {
        board = updateCellState(board, { row, column }, observation)
      }
    }
  }
  return board
}

function parseFixedSubmarine(value: unknown): FixedSubmarine {
  if (
    !isPlainObject(value) ||
    typeof value.id !== 'string' ||
    (value.length !== 2 && value.length !== 3 && value.length !== 4 && value.length !== 5) ||
    (value.orientation !== 'horizontal' && value.orientation !== 'vertical') ||
    !isPlainObject(value.start) ||
    typeof value.start.row !== 'number' ||
    typeof value.start.column !== 'number' ||
    !Number.isSafeInteger(value.start.row) ||
    !Number.isSafeInteger(value.start.column)
  ) {
    throw new SavedGameError(
      'saved-game-invalid-fixed-submarine',
      '本地存档中的已击沉潜艇无效',
    )
  }
  return {
    id: value.id,
    length: value.length,
    orientation: value.orientation,
    start: { row: value.start.row, column: value.start.column },
  }
}

function parseFixedSubmarines(
  value: unknown,
  config: BoardConfig,
  board: Board,
): readonly FixedSubmarine[] {
  if (!Array.isArray(value)) {
    throw new SavedGameError(
      'saved-game-invalid-fixed-submarine',
      '本地存档中的已击沉潜艇列表无效',
    )
  }
  const accepted: FixedSubmarine[] = []
  for (const item of value) {
    const submarine = parseFixedSubmarine(item)
    const result = validateFixedSubmarine(config, board, accepted, submarine)
    if (!result.valid) {
      throw new SavedGameError(
        'saved-game-invalid-fixed-submarine',
        '本地存档中的已击沉潜艇不符合当前规则',
      )
    }
    accepted.push(result.submarine)
  }
  return accepted
}

export function parseSavedGame(input: unknown): RestoredSavedGame {
  if (!isPlainObject(input)) {
    throw new SavedGameError('saved-game-invalid-schema', '本地存档结构无效')
  }
  if (!Number.isSafeInteger(input.schemaVersion)) {
    throw new SavedGameError('saved-game-invalid-schema', '本地存档版本字段无效')
  }
  if (input.schemaVersion !== 1) {
    throw new SavedGameError(
      'saved-game-unsupported-version',
      '本地存档版本暂不受支持',
    )
  }
  const config = parseConfig(input.config)
  const observations = parseObservations(input.observations, config)
  const board = rebuildBoard(config, observations)
  const fixedSubmarines = parseFixedSubmarines(
    input.fixedSubmarines,
    config,
    board,
  )
  try {
    buildBoardEvidence(config, board, fixedSubmarines)
  } catch {
    throw new SavedGameError(
      'saved-game-invalid-fixed-submarine',
      '本地存档中的对局证据不一致',
    )
  }
  return { config, board, fixedSubmarines }
}

export function serializeSavedGame(
  config: BoardConfig,
  board: Board,
  fixedSubmarines: readonly FixedSubmarine[],
): string {
  const saved: SavedGameV1 = {
    schemaVersion: 1,
    config,
    observations: board.map((row) => row.map((cell) => cell.state)),
    fixedSubmarines,
  }
  const restored = parseSavedGame(saved)
  return JSON.stringify({
    schemaVersion: 1,
    config: restored.config,
    observations: restored.board.map((row) => row.map((cell) => cell.state)),
    fixedSubmarines: restored.fixedSubmarines,
  } satisfies SavedGameV1)
}

export function loadSavedGame(storage: StorageLike): RestoredSavedGame | null {
  let serialized: string | null
  try {
    serialized = storage.getItem(SAVED_GAME_STORAGE_KEY)
  } catch {
    throw new SavedGameError(
      'saved-game-storage-unavailable',
      '无法读取浏览器本地存档',
    )
  }
  if (serialized === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch {
    throw new SavedGameError('saved-game-invalid-json', '本地存档不是有效 JSON')
  }
  return parseSavedGame(parsed)
}

export function saveGame(
  storage: StorageLike,
  game: Pick<GameState, 'config' | 'board' | 'fixedSubmarines'>,
): void {
  if (!game.config) return
  const serialized = serializeSavedGame(
    game.config,
    game.board,
    game.fixedSubmarines,
  )
  try {
    storage.setItem(SAVED_GAME_STORAGE_KEY, serialized)
  } catch {
    throw new SavedGameError(
      'saved-game-storage-unavailable',
      '无法写入浏览器本地存档',
    )
  }
}

export function clearSavedGame(storage: StorageLike): void {
  try {
    storage.removeItem(SAVED_GAME_STORAGE_KEY)
  } catch {
    throw new SavedGameError(
      'saved-game-storage-unavailable',
      '无法清除浏览器本地存档',
    )
  }
}
