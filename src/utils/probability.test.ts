import { describe, expect, it } from 'vitest'
import { formatProbability } from './probability'

describe('formatProbability', () => {
  it('按约定显示零、百分之百和一位小数', () => {
    expect(formatProbability(0)).toBe('0%')
    expect(formatProbability(1)).toBe('100%')
    expect(formatProbability(0.374)).toBe('37.4%')
  })
})
