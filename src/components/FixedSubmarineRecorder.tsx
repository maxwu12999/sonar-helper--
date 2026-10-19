import {
  SUBMARINE_LENGTHS,
  type FixedSubmarine,
  type FleetConfig,
  type GameInteraction,
  type Orientation,
  type SubmarineLength,
} from '../types/game'
import { formatPosition } from '../utils/board'

interface FixedSubmarineRecorderProps {
  readonly interaction: GameInteraction
  readonly fixedSubmarines: readonly FixedSubmarine[]
  readonly remainingFleet: FleetConfig
  readonly onEnter: (length: SubmarineLength, orientation: Orientation) => void
  readonly onConfigure: (length: SubmarineLength, orientation: Orientation) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
  readonly onRemove: (id: string) => void
}

export function FixedSubmarineRecorder({
  interaction,
  fixedSubmarines,
  remainingFleet,
  onEnter,
  onConfigure,
  onConfirm,
  onCancel,
  onRemove,
}: FixedSubmarineRecorderProps) {
  const firstAvailable = SUBMARINE_LENGTHS.find(
    (length) => remainingFleet[length] > 0,
  )

  return (
    <section className="fixed-recorder" aria-labelledby="fixed-recorder-title">
      <div className="fixed-recorder-heading">
        <div>
          <p className="eyebrow">完整潜艇证据</p>
          <h2 id="fixed-recorder-title">已击沉潜艇</h2>
        </div>
        {interaction.mode === 'observation' ? (
          <button
            type="button"
            disabled={firstAvailable === undefined}
            onClick={() => firstAvailable && onEnter(firstAvailable, 'horizontal')}
          >
            记录已击沉潜艇
          </button>
        ) : (
          <span className="entry-mode-badge">正在选择潜艇起点</span>
        )}
      </div>

      {interaction.mode === 'fixed-submarine-entry' ? (
        <div className="fixed-entry-controls" role="group" aria-label="已击沉潜艇录入设置">
          <label>
            潜艇长度
            <select
              value={interaction.length}
              onChange={(event) =>
                onConfigure(
                  Number(event.target.value) as SubmarineLength,
                  interaction.orientation,
                )
              }
            >
              {SUBMARINE_LENGTHS.map((length) => (
                <option key={length} value={length} disabled={remainingFleet[length] === 0}>
                  {length} 格
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>方向</legend>
            {(['horizontal', 'vertical'] as const).map((orientation) => (
              <button
                key={orientation}
                type="button"
                className={interaction.orientation === orientation ? 'active-choice' : ''}
                aria-pressed={interaction.orientation === orientation}
                onClick={() => onConfigure(interaction.length, orientation)}
              >
                {orientation === 'horizontal' ? '水平' : '垂直'}
              </button>
            ))}
          </fieldset>
          <p className="entry-instruction">
            {interaction.orientation === 'horizontal'
              ? '请点击潜艇最左侧格作为起点。'
              : '请点击潜艇最上侧格作为起点。'}
          </p>
          {interaction.error ? (
            <p className="fixed-entry-error" role="alert">{interaction.error.message}</p>
          ) : null}
          {interaction.preview ? (
            <div className="preview-summary" aria-live="polite">
              <span>待确认：{interaction.preview.length} 格，{formatPosition(interaction.preview.start)}起</span>
              <button type="button" onClick={onConfirm}>确认记录</button>
            </div>
          ) : null}
          <button type="button" className="ghost-button" onClick={onCancel}>
            取消录入
          </button>
        </div>
      ) : null}

      {fixedSubmarines.length > 0 ? (
        <ul className="fixed-submarine-list">
          {fixedSubmarines.map((submarine) => (
            <li key={submarine.id}>
              <span>
                {submarine.length} 格，
                {submarine.orientation === 'horizontal' ? '水平' : '垂直'}，
                {formatPosition(submarine.start)}起
              </span>
              <button type="button" className="ghost-button" onClick={() => onRemove(submarine.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-fixed-list">尚未记录已击沉潜艇</p>
      )}
    </section>
  )
}
