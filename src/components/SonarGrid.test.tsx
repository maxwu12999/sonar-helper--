import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createBoard, updateCellState } from '../utils/board'
import { SonarGrid } from './SonarGrid'

describe('SonarGrid 概率显示', () => {
  it('显示概率并把 fixed 与 miss 的 aria-label 固定为 100% 和 0%', () => {
    const board = updateCellState(
      updateCellState(createBoard(1, 3), { row: 0, column: 1 }, 'miss'),
      { row: 0, column: 2 },
      'hit',
    )
    render(<SonarGrid
      board={board}
      selectedPosition={null}
      probabilities={[[0.374, 0.8, 1]]}
      recommendedPosition={null}
      fixedPositions={[{ row: 0, column: 0 }]}
      previewPositions={[]}
      fixedEntryMode={false}
      onSelect={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: /第 1 行，第 1 列.*100%/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /第 1 行，第 2 列.*0%/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /第 1 行，第 3 列.*100%/ })).toBeDisabled()
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('没有结果时不残留概率文本或 aria 信息', () => {
    render(<SonarGrid
      board={createBoard(1, 1)} selectedPosition={null} probabilities={null}
      recommendedPosition={null}
      fixedPositions={[]} previewPositions={[]} fixedEntryMode={false}
      onSelect={vi.fn()}
    />)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第 1 行，第 1 列，未知' })).toBeInTheDocument()
  })

  it('推荐格具有独立 class、aria 语义并保持可点击', async () => {
    const onSelect = vi.fn()
    const board = createBoard(1, 2)
    const { rerender } = render(<SonarGrid
      board={board} selectedPosition={null} probabilities={[[0.8, 0.2]]}
      recommendedPosition={{ row: 0, column: 0 }} fixedPositions={[]}
      previewPositions={[]} fixedEntryMode={false} onSelect={onSelect}
    />)
    const recommended = screen.getByRole('button', {
      name: /第 1 行，第 1 列.*推荐攻击目标/,
    })
    expect(recommended).toHaveClass('recommended-target')
    expect(recommended).not.toBeDisabled()
    recommended.click()
    expect(onSelect).toHaveBeenCalledWith({ row: 0, column: 0 })
    expect(screen.getByRole('button', { name: /第 1 行，第 2 列/ })).not.toHaveAccessibleName(/推荐攻击目标/)

    rerender(<SonarGrid
      board={board} selectedPosition={null} probabilities={null}
      recommendedPosition={null} fixedPositions={[]} previewPositions={[]}
      fixedEntryMode={false} onSelect={onSelect}
    />)
    expect(screen.queryByLabelText(/推荐攻击目标/)).not.toBeInTheDocument()
  })

  it('固定潜艇录入模式隐藏推荐高亮', () => {
    render(<SonarGrid
      board={createBoard(1, 1)} selectedPosition={null} probabilities={[[1]]}
      recommendedPosition={{ row: 0, column: 0 }} fixedPositions={[]}
      previewPositions={[]} fixedEntryMode onSelect={vi.fn()}
    />)
    expect(screen.queryByLabelText(/推荐攻击目标/)).not.toBeInTheDocument()
  })
})
