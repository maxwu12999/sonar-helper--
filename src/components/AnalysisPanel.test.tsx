import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisPanel } from './AnalysisPanel'

const actions = { onCancel: vi.fn(), onRecalculate: vi.fn() }

describe('AnalysisPanel', () => {
  it('显示精确结果', () => {
    render(<AnalysisPanel {...actions} state={{ status: 'exact', result: {
      status: 'exact', probabilities: [[1]], occupancyCounts: [[1]],
      totalLayouts: 12, visitedNodes: 31,
    } }} />)
    expect(screen.getByText('精确分析完成')).toBeInTheDocument()
    expect(screen.getByText('合法布局：12')).toBeInTheDocument()
    expect(screen.getByText('技术详情')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
  })

  it('明确显示近似质量与精确回退诊断', () => {
    render(<AnalysisPanel {...actions} state={{ status: 'estimated', result: {
      status: 'estimated', origin: 'exact-limit-fallback',
      fallbackReason: 'exact-limit-reached', exactLimitReason: 'max-layouts',
      exactVisitedNodes: 90, exactPartialLayouts: 25, probabilities: [[0.5]],
      seed: 1, attemptedSamples: 20, acceptedSamples: 10, failedAttempts: 10,
      targetReached: true, effectiveSampleSize: 8, maxWeightFraction: 0.2,
    } }} />)
    expect(screen.getByText('近似概率估计')).toBeInTheDocument()
    expect(screen.getByText(/不是精确枚举/)).toBeInTheDocument()
    expect(screen.getByText('20.0%')).toBeInTheDocument()
    expect(screen.getByText(/合法布局数量上限/)).toBeInTheDocument()
    expect(screen.getByText(/精确阶段节点：90；停止前布局：25/)).toBeInTheDocument()
  })

  it('区分严格无解、精确超限和采样不可用', () => {
    const { rerender } = render(<AnalysisPanel {...actions} state={{
      status: 'proven-no-layouts',
      result: { status: 'proven-no-layouts', probabilities: null, visitedNodes: 4 },
    }} />)
    expect(screen.getByText('当前地图配置与记录下不存在合法完整舰队布局')).toBeInTheDocument()
    expect(screen.getByText(/严格分析结果/)).toBeInTheDocument()

    rerender(<AnalysisPanel {...actions} state={{ status: 'exact-limit-reached', result: {
      status: 'exact-limit-reached', probabilities: null,
      exactLimitReason: 'max-visited-nodes', visitedNodes: 10, partialLayouts: 2,
    } }} />)
    expect(screen.getByText(/搜索节点数量上限/)).toBeInTheDocument()
    expect(screen.getByText(/停止前发现布局：2/)).toBeInTheDocument()

    rerender(<AnalysisPanel {...actions} state={{ status: 'unavailable', result: {
      status: 'unavailable', origin: 'direct', reason: 'sampling-no-samples',
      probabilities: null, seed: 1, attemptedSamples: 3, acceptedSamples: 0,
      failedAttempts: 3, targetReached: false, effectiveSampleSize: 0,
      maxWeightFraction: null,
    } }} />)
    expect(screen.getByText('暂时无法生成有效估计')).toBeInTheDocument()
    expect(screen.getByText(/不代表不存在合法布局/)).toBeInTheDocument()
  })
})
