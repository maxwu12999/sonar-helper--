import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecommendationPanel } from './RecommendationPanel'

const recommendation = {
  position: { row: 3, column: 6 },
  probability: 0.632,
  tiedCandidateCount: 1,
} as const

describe('RecommendationPanel', () => {
  it('显示精确推荐、1开始坐标和复用后的概率格式', () => {
    render(<RecommendationPanel state={{
      status: 'available', source: { kind: 'exact' }, recommendation,
    }} />)
    expect(screen.getByRole('heading', { name: '精确概率推荐' })).toBeInTheDocument()
    expect(screen.getByText('第 4 行，第 7 列')).toBeInTheDocument()
    expect(screen.getByText('命中概率：63.2%')).toBeInTheDocument()
    expect(screen.getByText(/全部合法布局/)).toBeInTheDocument()
    expect(screen.queryByText(/并列最高/)).not.toBeInTheDocument()
  })

  it('近似推荐明确采样语义、目标不足和并列规则', () => {
    render(<RecommendationPanel state={{
      status: 'available',
      source: { kind: 'estimated', targetReached: false },
      recommendation: { ...recommendation, tiedCandidateCount: 3 },
    }} />)
    expect(screen.getByRole('heading', { name: '近似概率推荐' })).toBeInTheDocument()
    expect(screen.getByText(/基于采样概率估计/)).toBeInTheDocument()
    expect(screen.getByText(/不是精确结果或必然最优/)).toBeInTheDocument()
    expect(screen.getByText('本次采样未达到目标样本数。')).toBeInTheDocument()
    expect(screen.getByText(/共有 3 个格子并列最高/)).toBeInTheDocument()
  })

  it('显示无目标和受控推荐错误', () => {
    const { rerender } = render(<RecommendationPanel state={{
      status: 'no-target', source: { kind: 'exact' },
    }} />)
    expect(screen.getByText('当前没有概率大于0的可攻击未知格。')).toBeInTheDocument()

    rerender(<RecommendationPanel state={{
      status: 'error', message: '无法生成攻击推荐',
      code: 'recommendation-invalid-probability',
    }} />)
    expect(screen.getByRole('heading', { name: '无法生成攻击推荐' })).toBeInTheDocument()
    expect(screen.getByText('recommendation-invalid-probability')).toBeInTheDocument()
  })

  it('hidden 不渲染推荐面板', () => {
    const { container } = render(<RecommendationPanel state={{ status: 'hidden' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
