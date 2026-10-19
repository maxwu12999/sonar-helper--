import type { GameHistoryEntry } from '../types/game'
import { formatPosition } from '../utils/board'

interface HistoryListProps {
  readonly entries: readonly GameHistoryEntry[]
}

function historyText(entry: GameHistoryEntry): {
  readonly title: string
  readonly detail: string
  readonly marker: string
} {
  if (entry.type === 'cell-observation-changed') {
    return {
      title: formatPosition(entry.position),
      detail: entry.nextObservation === 'miss' ? '标记为未命中' : '标记为命中',
      marker: entry.nextObservation,
    }
  }
  const direction = entry.submarine.orientation === 'horizontal' ? '水平' : '垂直'
  return {
    title: `${entry.submarine.length} 格潜艇，${direction}`,
    detail: `${entry.type === 'fixed-submarine-added' ? '记录已击沉' : '删除已击沉记录'}，${formatPosition(entry.submarine.start)}起`,
    marker: entry.type === 'fixed-submarine-added' ? 'fixed-added' : 'fixed-removed',
  }
}

export function HistoryList({ entries }: HistoryListProps) {
  return (
    <details className="history-panel">
      <summary className="history-heading">
        <div>
          <p className="eyebrow">行动日志</p>
          <h2 id="history-title">操作历史</h2>
        </div>
        <span className="history-count">{entries.length} 条</span>
      </summary>

      {entries.length === 0 ? (
        <p className="empty-history">暂无操作记录</p>
      ) : (
        <ol className="history-list" reversed>
          {[...entries].reverse().map((entry) => {
            const text = historyText(entry)
            return (
              <li key={entry.id}>
                <span className={`history-marker ${text.marker}`} />
                <div>
                  <strong>{text.title}</strong>
                  <span>{text.detail}</span>
                </div>
                <small>#{entry.id}</small>
              </li>
            )
          })}
        </ol>
      )}
    </details>
  )
}
