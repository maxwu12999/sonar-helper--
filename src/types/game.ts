export type CellObservation = 'unknown' | 'miss' | 'hit'

export type MarkObservation = Exclude<CellObservation, 'unknown'>

export const SUBMARINE_LENGTHS = [2, 3, 4, 5] as const

export type SubmarineLength = (typeof SUBMARINE_LENGTHS)[number]

export type Orientation = 'horizontal' | 'vertical'

export type AdjacencyRule =
  | 'orthogonal-only'
  | 'orthogonal-and-diagonal'

export interface Position {
  readonly row: number
  readonly column: number
}

export interface BoardDimensions {
  readonly rows: number
  readonly columns: number
}

export interface SubmarineSpec {
  readonly length: SubmarineLength
}

export type FleetConfig = Readonly<Record<SubmarineLength, number>>

export interface Placement {
  readonly id: string
  readonly spec: SubmarineSpec
  readonly orientation: Orientation
  readonly start: Position
  readonly occupiedCells: readonly Position[]
  readonly forbiddenCells: readonly Position[]
}

export type PlacementCatalog = Readonly<
  Partial<Record<SubmarineLength, readonly Placement[]>>
>

export interface SeaPreset {
  readonly id: string
  readonly name: string
  readonly config: BoardConfig
}

export interface Cell {
  readonly position: Position
  readonly state: CellObservation
}

export type Board = readonly (readonly Cell[])[]

export interface BoardConfig extends BoardDimensions {
  readonly fleetConfig: FleetConfig
  readonly adjacencyRule: AdjacencyRule
}

export interface FixedSubmarine {
  readonly id: string
  readonly length: SubmarineLength
  readonly orientation: Orientation
  readonly start: Position
}

interface HistoryEntryBase {
  readonly id: number
}

export interface CellObservationHistoryEntry extends HistoryEntryBase {
  readonly type: 'cell-observation-changed'
  readonly position: Position
  readonly previousObservation: CellObservation
  readonly nextObservation: MarkObservation
}

export interface FixedSubmarineAddedHistoryEntry extends HistoryEntryBase {
  readonly type: 'fixed-submarine-added'
  readonly submarine: FixedSubmarine
}

export interface FixedSubmarineRemovedHistoryEntry extends HistoryEntryBase {
  readonly type: 'fixed-submarine-removed'
  readonly submarine: FixedSubmarine
  readonly previousIndex: number
}

export type GameHistoryEntry =
  | CellObservationHistoryEntry
  | FixedSubmarineAddedHistoryEntry
  | FixedSubmarineRemovedHistoryEntry

export type FixedSubmarineValidationErrorCode =
  | 'invalid-fixed-submarine-spec'
  | 'fixed-submarine-out-of-bounds'
  | 'fixed-submarine-placement-not-found'
  | 'duplicate-fixed-submarine'
  | 'fixed-submarine-count-exceeded'
  | 'fixed-submarine-miss-conflict'
  | 'fixed-submarine-hit-conflict'
  | 'fixed-submarine-overlap'
  | 'fixed-submarine-adjacency-conflict'

export interface FixedSubmarineValidationError {
  readonly code: FixedSubmarineValidationErrorCode
  readonly message: string
}

export type GameInteraction =
  | { readonly mode: 'observation' }
  | {
      readonly mode: 'fixed-submarine-entry'
      readonly length: SubmarineLength
      readonly orientation: Orientation
      readonly preview: FixedSubmarine | null
      readonly error: FixedSubmarineValidationError | null
    }

export interface ResetUndoSnapshot {
  readonly board: Board
  readonly fixedSubmarines: readonly FixedSubmarine[]
  readonly history: readonly GameHistoryEntry[]
  readonly nextHistoryId: number
}

export interface GameState {
  readonly config: BoardConfig | null
  readonly board: Board
  readonly fixedSubmarines: readonly FixedSubmarine[]
  readonly history: readonly GameHistoryEntry[]
  readonly nextHistoryId: number
  readonly interaction: GameInteraction
  readonly resetUndoSnapshot: ResetUndoSnapshot | null
}

export type GameAction =
  | { readonly type: 'create'; readonly config: BoardConfig }
  | {
      readonly type: 'restore-saved-game'
      readonly config: BoardConfig
      readonly board: Board
      readonly fixedSubmarines: readonly FixedSubmarine[]
    }
  | { readonly type: 'end-game' }
  | { readonly type: 'mark-observation'; readonly position: Position; readonly observation: MarkObservation }
  | { readonly type: 'enter-fixed-submarine-entry'; readonly length: SubmarineLength; readonly orientation: Orientation }
  | { readonly type: 'configure-fixed-submarine-entry'; readonly length: SubmarineLength; readonly orientation: Orientation }
  | { readonly type: 'preview-fixed-submarine'; readonly start: Position }
  | { readonly type: 'confirm-fixed-submarine' }
  | { readonly type: 'cancel-fixed-submarine-entry' }
  | { readonly type: 'remove-fixed-submarine'; readonly id: string }
  | { readonly type: 'undo' }
  | { readonly type: 'reset' }
