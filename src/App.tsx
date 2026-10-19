import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import {
  getProbabilityRecommendation,
  ProbabilityRecommendationError,
} from './algorithms/recommendation'
import { AnalysisPanel } from './components/AnalysisPanel'
import { CellActionMenu } from './components/CellActionMenu'
import { FixedSubmarineRecorder } from './components/FixedSubmarineRecorder'
import { HistoryList } from './components/HistoryList'
import {
  RecommendationPanel,
  type RecommendationDisplayState,
} from './components/RecommendationPanel'
import { SetupForm } from './components/SetupForm'
import { SonarGrid } from './components/SonarGrid'
import { StatusPanel } from './components/StatusPanel'
import {
  useBoardAnalysis,
  type BoardAnalysisClientFactory,
} from './hooks/useBoardAnalysis'
import {
  clearSavedGame,
  loadSavedGame,
  saveGame,
  SavedGameError,
  type StorageLike,
} from './persistence/savedGame'
import { resolveFixedSubmarinePlacements } from './rules/fixedSubmarines'
import { gameReducer, initialGameState } from './state/gameState'
import type {
  BoardConfig,
  MarkObservation,
  Orientation,
  Position,
  SubmarineLength,
} from './types/game'
import { getRemainingFleetConfig } from './utils/fleet'

interface AppProps {
  readonly analysisClientFactory?: BoardAnalysisClientFactory
  readonly analysisDebounceMs?: number
  readonly storage?: StorageLike
  readonly persistenceSaveDebounceMs?: number
}

type PersistenceStatus = 'loading' | 'ready' | 'error'

const SAVE_DEBOUNCE_MS = 300

function App({
  analysisClientFactory,
  analysisDebounceMs,
  storage,
  persistenceSaveDebounceMs = SAVE_DEBOUNCE_MS,
}: AppProps) {
  const [game, dispatch] = useReducer(gameReducer, initialGameState)
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null)
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>('loading')
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null)
  const [confirmEndGame, setConfirmEndGame] = useState(false)
  const storageRef = useRef<StorageLike | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      let currentStorage: StorageLike
      try {
        currentStorage = storage ?? window.localStorage
        storageRef.current = currentStorage
        const restored = loadSavedGame(currentStorage)
        if (restored) {
          dispatch({ type: 'restore-saved-game', ...restored })
        }
        setPersistenceStatus('ready')
      } catch (error: unknown) {
        if (!active) return
        if (
          error instanceof SavedGameError &&
          error.code !== 'saved-game-unsupported-version' &&
          error.code !== 'saved-game-storage-unavailable' &&
          storageRef.current
        ) {
          try {
            clearSavedGame(storageRef.current)
          } catch {
            // 损坏存档已被忽略；删除失败由后续保存提示统一处理。
          }
          setPersistenceStatus('ready')
          setPersistenceNotice('已忽略损坏的本地对局存档')
        } else {
          setPersistenceStatus('error')
          setPersistenceNotice(
            error instanceof SavedGameError &&
                error.code === 'saved-game-unsupported-version'
              ? '本地对局存档版本暂不受支持，未进行加载'
              : '当前对局无法保存到浏览器',
          )
        }
      }
    })
    return () => {
      active = false
      storageRef.current = null
    }
  }, [storage])

  useEffect(() => {
    if (persistenceStatus !== 'ready' || !game.config || !storageRef.current) {
      return
    }
    const currentStorage = storageRef.current
    const savedFacts = {
      config: game.config,
      board: game.board,
      fixedSubmarines: game.fixedSubmarines,
    }
    const timer = setTimeout(() => {
      if (saveTimerRef.current === timer) saveTimerRef.current = null
      try {
        saveGame(currentStorage, savedFacts)
      } catch {
        setPersistenceNotice('当前对局无法保存到浏览器')
      }
    }, persistenceSaveDebounceMs)
    saveTimerRef.current = timer
    return () => {
      if (saveTimerRef.current === timer) {
        clearTimeout(timer)
        saveTimerRef.current = null
      }
    }
  }, [
    game.board,
    game.config,
    game.fixedSubmarines,
    persistenceSaveDebounceMs,
    persistenceStatus,
  ])

  const fixedPlacements = useMemo(
    () =>
      game.config
        ? resolveFixedSubmarinePlacements(game.config, game.fixedSubmarines)
        : [],
    [game.config, game.fixedSubmarines],
  )
  const fixedPositions = useMemo(
    () => fixedPlacements.flatMap((placement) => placement.occupiedCells),
    [fixedPlacements],
  )
  const previewPositions = useMemo(() => {
    if (
      !game.config ||
      game.interaction.mode !== 'fixed-submarine-entry' ||
      !game.interaction.preview
    ) {
      return []
    }
    return resolveFixedSubmarinePlacements(game.config, [game.interaction.preview])[0]
      .occupiedCells
  }, [game.config, game.interaction])
  const analysis = useBoardAnalysis(
    {
      config: game.config,
      board: game.board,
      fixedSubmarines: game.fixedSubmarines,
    },
    {
      ...(analysisClientFactory
        ? { clientFactory: analysisClientFactory }
        : {}),
      ...(analysisDebounceMs === undefined
        ? {}
        : { debounceMs: analysisDebounceMs }),
    },
  )
  const recommendationState = useMemo<RecommendationDisplayState>(() => {
    if (
      game.interaction.mode === 'fixed-submarine-entry' ||
      !game.config ||
      (analysis.state.status !== 'exact' &&
        analysis.state.status !== 'estimated') ||
      !analysis.probabilities
    ) {
      return { status: 'hidden' }
    }

    const source = analysis.state.status === 'exact'
      ? { kind: 'exact' } as const
      : {
          kind: 'estimated' as const,
          targetReached: analysis.state.result.targetReached,
        }
    try {
      const recommendation = getProbabilityRecommendation(
        game.config,
        game.board,
        game.fixedSubmarines,
        analysis.probabilities,
      )
      return recommendation
        ? { status: 'available', source, recommendation }
        : { status: 'no-target', source }
    } catch (error: unknown) {
      if (error instanceof ProbabilityRecommendationError) {
        return {
          status: 'error',
          message: '无法生成攻击推荐',
          code: error.code,
        }
      }
      return {
        status: 'error',
        message: '推荐计算失败，请稍后重试。',
      }
    }
  }, [
    analysis.probabilities,
    analysis.state,
    game.board,
    game.config,
    game.fixedSubmarines,
    game.interaction.mode,
  ])
  const recommendedPosition = recommendationState.status === 'available'
    ? recommendationState.recommendation.position
    : null
  const remainingFleet = game.config
    ? getRemainingFleetConfig(game.config.fleetConfig, game.fixedSubmarines)
    : { 2: 0, 3: 0, 4: 0, 5: 0 }

  function createMap(config: BoardConfig) {
    dispatch({ type: 'create', config })
    setSelectedPosition(null)
  }

  function markSelected(observation: MarkObservation) {
    if (!selectedPosition) return
    dispatch({ type: 'mark-observation', position: selectedPosition, observation })
    setSelectedPosition(null)
  }

  function selectGridPosition(position: Position) {
    if (game.interaction.mode === 'fixed-submarine-entry') {
      dispatch({ type: 'preview-fixed-submarine', start: position })
    } else {
      setSelectedPosition(position)
    }
  }

  function enterFixedEntry(length: SubmarineLength, orientation: Orientation) {
    setSelectedPosition(null)
    dispatch({ type: 'enter-fixed-submarine-entry', length, orientation })
  }

  function configureFixedEntry(
    length: SubmarineLength,
    orientation: Orientation,
  ) {
    dispatch({ type: 'configure-fixed-submarine-entry', length, orientation })
  }

  function undo() {
    dispatch({ type: 'undo' })
    setSelectedPosition(null)
  }

  function reset() {
    dispatch({ type: 'reset' })
    setSelectedPosition(null)
  }

  function endAndClearGame() {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    analysis.cancel()
    const currentStorage = storageRef.current
    if (currentStorage) {
      try {
        clearSavedGame(currentStorage)
      } catch {
        setPersistenceNotice('本地存档可能未成功清除')
      }
    }
    dispatch({ type: 'end-game' })
    setSelectedPosition(null)
    setConfirmEndGame(false)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <p>独立概率分析工具</p>
          <h1>声呐战辅助器</h1>
        </div>
        <span className="privacy-badge">离线运行 · 不连接游戏</span>
      </header>

      <main>
        {persistenceNotice ? (
          <p className="persistence-notice" role="status">
            {persistenceNotice}
          </p>
        ) : null}
        <details className="setup-disclosure" open={!game.config}>
          <summary>
            {game.config ? '地图与舰队配置（自定义）' : '创建自定义地图'}
          </summary>
          <SetupForm onCreate={createMap} />
        </details>

        {game.config ? (
          <>
            <FixedSubmarineRecorder
              interaction={game.interaction}
              fixedSubmarines={game.fixedSubmarines}
              remainingFleet={remainingFleet}
              onEnter={enterFixedEntry}
              onConfigure={configureFixedEntry}
              onConfirm={() => dispatch({ type: 'confirm-fixed-submarine' })}
              onCancel={() => dispatch({ type: 'cancel-fixed-submarine-entry' })}
              onRemove={(id) => dispatch({ type: 'remove-fixed-submarine', id })}
            />
            <div className="workspace">
              <div className="board-column">
                {selectedPosition && game.interaction.mode === 'observation' ? (
                  <CellActionMenu
                    position={selectedPosition}
                    onChoose={markSelected}
                    onCancel={() => setSelectedPosition(null)}
                  />
                ) : null}
                <SonarGrid
                  board={game.board}
                  selectedPosition={selectedPosition}
                  probabilities={analysis.probabilities}
                  recommendedPosition={recommendedPosition}
                  fixedPositions={fixedPositions}
                  previewPositions={previewPositions}
                  fixedEntryMode={game.interaction.mode === 'fixed-submarine-entry'}
                  onSelect={selectGridPosition}
                />
              </div>

              <aside className="sidebar">
                <RecommendationPanel state={recommendationState} />
                <StatusPanel
                  remainingFleet={remainingFleet}
                  initialFleet={game.config.fleetConfig}
                  canUndo={
                    game.history.length > 0 || game.resetUndoSnapshot !== null
                  }
                  undoIsReset={
                    game.history.length === 0 && game.resetUndoSnapshot !== null
                  }
                  onUndo={undo}
                  onReset={reset}
                  confirmEndGame={confirmEndGame}
                  onRequestEndGame={() => setConfirmEndGame(true)}
                  onCancelEndGame={() => setConfirmEndGame(false)}
                  onConfirmEndGame={endAndClearGame}
                />
                <AnalysisPanel
                  state={analysis.state}
                  onCancel={analysis.cancel}
                  onRecalculate={analysis.recalculate}
                />
                <HistoryList entries={game.history} />
              </aside>
            </div>
          </>
        ) : (
          <section className="empty-state">
            <div className="sonar-rings" aria-hidden="true"><span /></div>
            <h2>等待创建地图</h2>
            <p>设置地图尺寸和潜艇数量，开始记录探测结果。</p>
          </section>
        )}
      </main>

      <footer>
        本工具仅根据手动输入的数据分析，不读取内存、不自动点击、不控制游戏。
      </footer>
    </div>
  )
}

export default App
