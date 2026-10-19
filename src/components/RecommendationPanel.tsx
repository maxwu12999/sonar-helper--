import type {
  ProbabilityRecommendation,
  ProbabilityRecommendationErrorCode,
} from '../algorithms/recommendation'
import { formatPosition } from '../utils/board'
import { formatProbability } from '../utils/probability'

type RecommendationSource =
  | { readonly kind: 'exact' }
  | { readonly kind: 'estimated'; readonly targetReached: boolean }

export type RecommendationDisplayState =
  | { readonly status: 'hidden' }
  | {
      readonly status: 'available'
      readonly source: RecommendationSource
      readonly recommendation: ProbabilityRecommendation
    }
  | {
      readonly status: 'no-target'
      readonly source: RecommendationSource
    }
  | {
      readonly status: 'error'
      readonly message: string
      readonly code?: ProbabilityRecommendationErrorCode
    }

interface RecommendationPanelProps {
  readonly state: RecommendationDisplayState
}

function sourceTitle(source: RecommendationSource): string {
  return source.kind === 'exact' ? '精确概率推荐' : '近似概率推荐'
}

export function RecommendationPanel({ state }: RecommendationPanelProps) {
  if (state.status === 'hidden') return null

  return (
    <section className="recommendation-panel" aria-labelledby="recommendation-title">
      <p className="eyebrow">攻击建议</p>
      {state.status === 'error' ? (
        <>
          <h2 id="recommendation-title">无法生成攻击推荐</h2>
          <div className="recommendation-content" role="alert">
            <p>{state.message}</p>
            {state.code ? <code>{state.code}</code> : null}
          </div>
        </>
      ) : (
        <>
          <h2 id="recommendation-title">{sourceTitle(state.source)}</h2>
          <div className="recommendation-content" aria-live="polite">
            {state.source.kind === 'exact' ? (
              <p>依据全部合法布局中的最高潜艇占用概率。</p>
            ) : (
              <p>此推荐基于采样概率估计，不是精确结果或必然最优选择。</p>
            )}
            {state.source.kind === 'estimated' && !state.source.targetReached ? (
              <p className="recommendation-warning">本次采样未达到目标样本数。</p>
            ) : null}
            {state.status === 'available' ? (
              <>
                <strong className="recommendation-coordinate">
                  {formatPosition(state.recommendation.position)}
                </strong>
                <p>命中概率：{formatProbability(state.recommendation.probability)}</p>
                {state.recommendation.tiedCandidateCount > 1 ? (
                  <p>
                    共有 {state.recommendation.tiedCandidateCount} 个格子并列最高，
                    已按行列顺序选择第一个。
                  </p>
                ) : null}
              </>
            ) : (
              <p>当前没有概率大于0的可攻击未知格。</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
