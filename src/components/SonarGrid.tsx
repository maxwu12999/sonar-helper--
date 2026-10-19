import type { ProbabilityMatrix } from '../engine/types'
import type { Board, CellObservation, Position } from '../types/game'
import { formatPosition } from '../utils/board'
import { formatProbability } from '../utils/probability'

interface SonarGridProps {
  readonly board: Board
  readonly selectedPosition: Position | null
  readonly probabilities: ProbabilityMatrix | null
  readonly recommendedPosition: Position | null
  readonly fixedPositions: readonly Position[]
  readonly previewPositions: readonly Position[]
  readonly fixedEntryMode: boolean
  readonly onSelect: (position: Position) => void
}

const stateLabels: Record<CellObservation, string> = {
  unknown: '未知',
  miss: '未命中',
  hit: '命中',
}

function positionKey(position: Position): string {
  return `${position.row}:${position.column}`
}

function positionsMatch(first: Position | null, second: Position): boolean {
  return first?.row === second.row && first.column === second.column
}

export function SonarGrid({
  board,
  selectedPosition,
  probabilities,
  recommendedPosition,
  fixedPositions,
  previewPositions,
  fixedEntryMode,
  onSelect,
}: SonarGridProps) {
  const columns = board[0]?.length ?? 0
  const fixedKeys = new Set(fixedPositions.map(positionKey))
  const previewKeys = new Set(previewPositions.map(positionKey))

  return (
    <section className="board-panel" aria-labelledby="board-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">战术记录</p>
          <h2 id="board-title">声呐网格</h2>
        </div>
        <div className="legend" aria-label="格子状态图例">
          <span><i className="legend-dot miss" />未命中</span>
          <span><i className="legend-dot hit" />命中</span>
          <span><i className="legend-dot fixed" />已击沉潜艇</span>
          <span><i className="legend-dot preview" />待确认</span>
        </div>
      </div>

      <div className="board-scroll" tabIndex={0} aria-label="可滚动的声呐地图">
        <div
          className="sonar-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, 44px)` }}
          aria-label={`${board.length} 行 ${columns} 列声呐网格`}
        >
          {board.flat().map((cell) => {
            const coordinate = formatPosition(cell.position)
            const fixed = fixedKeys.has(positionKey(cell.position))
            const preview = previewKeys.has(positionKey(cell.position))
            const selected = positionsMatch(selectedPosition, cell.position)
            const recommended =
              !fixedEntryMode && positionsMatch(recommendedPosition, cell.position)
            const displayState = fixed ? '已击沉潜艇格' : stateLabels[cell.state]
            const probability = probabilities
              ? fixed
                ? 1
                : cell.state === 'miss'
                  ? 0
                  : probabilities[cell.position.row]?.[cell.position.column]
              : undefined
            const probabilityLabel =
              probability === undefined ? null : formatProbability(probability)
            const disabled = fixedEntryMode
              ? false
              : fixed || cell.state !== 'unknown'

            return (
              <button
                key={positionKey(cell.position)}
                type="button"
                className={`sonar-cell ${cell.state}${fixed ? ' fixed' : ''}${preview ? ' preview' : ''}${recommended ? ' recommended-target' : ''}${selected ? ' selected' : ''}`}
                aria-label={`${coordinate}，${displayState}${probabilityLabel ? `，占用概率 ${probabilityLabel}` : ''}${recommended ? '，推荐攻击目标' : ''}${fixedEntryMode ? '，选择为潜艇起点' : ''}`}
                aria-pressed={selected || preview}
                disabled={disabled}
                onClick={() => onSelect(cell.position)}
              >
                <span className="cell-marker" aria-hidden="true">
                  {fixed ? '◆' : null}
                  {!fixed && cell.state === 'miss' ? '×' : null}
                  {!fixed && cell.state === 'hit' ? '●' : null}
                </span>
                {probabilityLabel ? (
                  <span className="cell-probability" aria-hidden="true">
                    {probabilityLabel}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
