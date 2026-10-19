import type { AnalysisUiState } from '../hooks/useBoardAnalysis'
import { formatProbability } from '../utils/probability'

interface AnalysisPanelProps {
  readonly state: AnalysisUiState
  readonly onCancel: () => void
  readonly onRecalculate: () => void
}

function limitReasonLabel(reason: 'max-visited-nodes' | 'max-layouts'): string {
  return reason === 'max-visited-nodes' ? '搜索节点数量上限' : '合法布局数量上限'
}

export function AnalysisPanel({
  state,
  onCancel,
  onRecalculate,
}: AnalysisPanelProps) {
  return (
    <section className="analysis-panel" aria-labelledby="analysis-title">
      <p className="eyebrow">概率分析</p>
      <h2 id="analysis-title">分析状态</h2>

      <div className="analysis-content" aria-live="polite">
        {state.status === 'idle' ? <p>尚未运行分析。</p> : null}

        {state.status === 'debouncing' ? (
          <>
            <strong>正在准备分析</strong>
            <p>等待本轮记录稳定后开始计算。</p>
          </>
        ) : null}

        {state.status === 'analyzing' ? (
          <>
            <strong>正在分析</strong>
            <p>计算在独立 Worker 中运行，页面仍可继续操作。</p>
          </>
        ) : null}

        {state.status === 'exact' ? (
          <>
            <strong>精确分析完成</strong>
            <p>合法布局：{state.result.totalLayouts}</p>
            <details className="analysis-details">
              <summary>技术详情</summary>
              <dl>
                <div><dt>搜索节点</dt><dd>{state.result.visitedNodes}</dd></div>
              </dl>
            </details>
          </>
        ) : null}

        {state.status === 'estimated' ? (
          <>
            <strong>近似概率估计</strong>
            <p>这是重要性采样估计，不是精确枚举结果。</p>
            <details className="analysis-details">
              <summary>技术详情</summary>
              <dl>
                <div><dt>接受 / 尝试</dt><dd>{state.result.acceptedSamples} / {state.result.attemptedSamples}</dd></div>
                <div><dt>有效样本量</dt><dd>{state.result.effectiveSampleSize.toFixed(1)}</dd></div>
                <div><dt>最大权重占比</dt><dd>{formatProbability(state.result.maxWeightFraction)}</dd></div>
                <div><dt>达到目标</dt><dd>{state.result.targetReached ? '是' : '否'}</dd></div>
              </dl>
              {state.result.origin === 'exact-limit-fallback' ? (
                <div className="analysis-note">
                  <p>精确搜索达到{limitReasonLabel(state.result.exactLimitReason)}后回退到采样。</p>
                  <p>精确阶段节点：{state.result.exactVisitedNodes}；停止前布局：{state.result.exactPartialLayouts}</p>
                </div>
              ) : null}
            </details>
          </>
        ) : null}

        {state.status === 'proven-no-layouts' ? (
          <>
            <strong>当前地图配置与记录下不存在合法完整舰队布局</strong>
            <p>这是精确搜索得出的严格分析结果。</p>
          </>
        ) : null}

        {state.status === 'exact-limit-reached' ? (
          <>
            <strong>精确搜索达到限制</strong>
            <p>限制原因：{limitReasonLabel(state.result.exactLimitReason)}</p>
            <details className="analysis-details">
              <summary>技术详情</summary>
              <p>搜索节点：{state.result.visitedNodes}</p>
              <p>停止前发现布局：{state.result.partialLayouts}</p>
            </details>
          </>
        ) : null}

        {state.status === 'unavailable' ? (
          <>
            <strong>暂时无法生成有效估计</strong>
            <p>本次采样没有成功样本；这不代表不存在合法布局。</p>
            <details className="analysis-details">
              <summary>技术详情</summary>
              <p>已尝试 {state.result.attemptedSamples} 次，失败 {state.result.failedAttempts} 次。</p>
            </details>
          </>
        ) : null}

        {state.status === 'error' ? (
          <>
            <strong>分析失败</strong>
            <p>{state.message}</p>
            {state.code ? <code>{state.code}</code> : null}
          </>
        ) : null}
      </div>

      <div className="analysis-actions">
        {state.status === 'debouncing' || state.status === 'analyzing' ? (
          <button type="button" onClick={onCancel}>取消分析</button>
        ) : (
          <button type="button" onClick={onRecalculate}>重新计算</button>
        )}
      </div>
    </section>
  )
}
