import { describe, expect, it } from 'vitest'
import { createSeededRandom } from './seededRandom'

describe('seeded random', () => {
  it('相同 seed 产生固定且可复现的 uint32 序列', () => {
    const first = createSeededRandom(123_456_789)
    const second = createSeededRandom(123_456_789)
    const expected = [
      1_107_202_814,
      4_169_434_471,
      3_372_958_138,
      885_470_128,
      1_301_683_845,
    ]

    expect(expected.map(() => first.nextUint32())).toEqual(expected)
    expect(expected.map(() => second.nextUint32())).toEqual(expected)
  })

  it('nextFloat 和无偏 nextInt 始终落在指定范围', () => {
    const random = createSeededRandom(0)
    for (let index = 0; index < 1_000; index += 1) {
      const float = random.nextFloat()
      const integer = random.nextInt(7)
      expect(float).toBeGreaterThanOrEqual(0)
      expect(float).toBeLessThan(1)
      expect(integer).toBeGreaterThanOrEqual(0)
      expect(integer).toBeLessThan(7)
    }
  })

  it('拒绝无效的 nextInt 上界', () => {
    const random = createSeededRandom(1)
    expect(() => random.nextInt(0)).toThrow(RangeError)
    expect(() => random.nextInt(1.5)).toThrow(RangeError)
  })
})
