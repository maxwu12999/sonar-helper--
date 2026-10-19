import type { MarkObservation, Position } from '../types/game'
import { formatPosition } from '../utils/board'

interface CellActionMenuProps {
  readonly position: Position
  readonly onChoose: (observation: MarkObservation) => void
  readonly onCancel: () => void
}

export function CellActionMenu({
  position,
  onChoose,
  onCancel,
}: CellActionMenuProps) {
  return (
    <div className="action-menu" role="dialog" aria-labelledby="action-title">
      <div>
        <p className="eyebrow">记录探测结果</p>
        <h3 id="action-title">{formatPosition(position)}</h3>
      </div>
      <div className="action-buttons">
        <button type="button" onClick={() => onChoose('miss')}>未命中</button>
        <button type="button" onClick={() => onChoose('hit')}>命中</button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}
