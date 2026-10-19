export interface SeededRandom {
  nextUint32(): number
  nextFloat(): number
  nextInt(maxExclusive: number): number
}

const UINT32_RANGE = 0x1_0000_0000

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0

  function nextUint32(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (value ^ (value >>> 14)) >>> 0
  }

  return {
    nextUint32,
    nextFloat(): number {
      return nextUint32() / UINT32_RANGE
    },
    nextInt(maxExclusive: number): number {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
        throw new RangeError('maxExclusive 必须是正安全整数')
      }
      const acceptanceLimit =
        Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive
      let value = nextUint32()
      while (value >= acceptanceLimit) value = nextUint32()
      return value % maxExclusive
    },
  }
}
