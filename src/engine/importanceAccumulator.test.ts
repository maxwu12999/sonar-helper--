import { describe, expect, it } from 'vitest'
import { ImportanceAccumulator } from './importanceAccumulator'

describe('importance accumulator', () => {
  it('出现新最大 logWeight 时正确重缩放', () => {
    const accumulator = new ImportanceAccumulator(2)
    accumulator.add(0, 0b01n)
    accumulator.add(Math.log(3), 0b10n)
    const summary = accumulator.summarize()

    expect(summary).not.toBeNull()
    expect(summary?.probabilities[0]).toBeCloseTo(0.25, 12)
    expect(summary?.probabilities[1]).toBeCloseTo(0.75, 12)
    expect(summary?.effectiveSampleSize).toBeCloseTo(1.6, 12)
    expect(summary?.maxWeightFraction).toBeCloseTo(0.75, 12)
  })

  it('等权样本的 ESS 等于样本数', () => {
    const accumulator = new ImportanceAccumulator(2)
    for (let index = 0; index < 4; index += 1) {
      accumulator.add(10_000, index % 2 === 0 ? 0b01n : 0b10n)
    }
    const summary = accumulator.summarize()

    expect(summary?.effectiveSampleSize).toBeCloseTo(4, 12)
    expect(summary?.maxWeightFraction).toBeCloseTo(0.25, 12)
    expect(summary?.probabilities).toEqual([0.5, 0.5])
  })

  it('极端权重集中会降低 ESS 且不产生 NaN 或 Infinity', () => {
    const accumulator = new ImportanceAccumulator(3)
    accumulator.add(-10_000, 0b001n)
    accumulator.add(10_000, 0b110n)
    const summary = accumulator.summarize()

    expect(summary).not.toBeNull()
    expect(summary?.effectiveSampleSize).toBeCloseTo(1, 12)
    expect(summary?.maxWeightFraction).toBeCloseTo(1, 12)
    for (const probability of summary?.probabilities ?? []) {
      expect(Number.isFinite(probability)).toBe(true)
      expect(probability).toBeGreaterThanOrEqual(0)
      expect(probability).toBeLessThanOrEqual(1)
    }
  })

  it('没有样本时返回 null', () => {
    expect(new ImportanceAccumulator(1).summarize()).toBeNull()
  })
})
