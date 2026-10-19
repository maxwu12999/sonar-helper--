import { SUBMARINE_LENGTHS, type FleetConfig } from '../types/game'

interface StatusPanelProps {
  readonly remainingFleet: FleetConfig
  readonly initialFleet: FleetConfig
  readonly canUndo: boolean
  readonly undoIsReset: boolean
  readonly onUndo: () => void
  readonly onReset: () => void
  readonly confirmEndGame: boolean
  readonly onRequestEndGame: () => void
  readonly onCancelEndGame: () => void
  readonly onConfirmEndGame: () => void
}

export function StatusPanel({
  remainingFleet,
  initialFleet,
  canUndo,
  undoIsReset,
  onUndo,
  onReset,
  confirmEndGame,
  onRequestEndGame,
  onCancelEndGame,
  onConfirmEndGame,
}: StatusPanelProps) {
  return (
    <section className="status-panel" aria-labelledby="status-title">
      <p className="eyebrow">对局状态</p>
      <h2 id="status-title">剩余舰队</h2>

      <div className="fleet-status-list" aria-live="polite">
        {SUBMARINE_LENGTHS.filter((length) => initialFleet[length] > 0).map(
          (length) => (
            <div key={length} className="fleet-status-row">
              <span>{length} 格潜艇</span>
              <strong>剩余 {remainingFleet[length]} / {initialFleet[length]}</strong>
            </div>
          ),
        )}
      </div>

      <div className="status-actions">
        <button type="button" disabled={!canUndo} onClick={onUndo}>
          {undoIsReset ? '撤销重置' : '撤销上一步'}
        </button>
        <button type="button" className="ghost-button" onClick={onReset}>
          重置地图
        </button>
      </div>
      {confirmEndGame ? (
        <div className="end-game-confirmation" role="alert">
          <p>结束后将清除当前对局和本地存档，确定继续吗？</p>
          <div>
            <button type="button" className="danger-button" onClick={onConfirmEndGame}>
              确认结束
            </button>
            <button type="button" className="ghost-button" onClick={onCancelEndGame}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="danger-button end-game-button" onClick={onRequestEndGame}>
          结束并清除对局
        </button>
      )}
    </section>
  )
}
