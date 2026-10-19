export interface ImportanceSummary {
  readonly probabilities: readonly number[]
  readonly effectiveSampleSize: number
  readonly maxWeightFraction: number
}

export class ImportanceAccumulator {
  readonly #weightedOccupancy: Float64Array
  #logScale: number | null = null
  #scaledWeightSum = 0
  #scaledSquaredWeightSum = 0
  #sampleCount = 0

  constructor(cellCount: number) {
    if (!Number.isSafeInteger(cellCount) || cellCount < 1) {
      throw new RangeError('cellCount 必须是正安全整数')
    }
    this.#weightedOccupancy = new Float64Array(cellCount)
  }

  get sampleCount(): number {
    return this.#sampleCount
  }

  add(logWeight: number, occupiedMask: bigint): void {
    if (!Number.isFinite(logWeight)) {
      throw new RangeError('logWeight 必须是有限数值')
    }

    let scaledWeight: number
    if (this.#logScale === null) {
      this.#logScale = logWeight
      scaledWeight = 1
    } else if (logWeight > this.#logScale) {
      const factor = Math.exp(this.#logScale - logWeight)
      this.#scaledWeightSum *= factor
      this.#scaledSquaredWeightSum *= factor * factor
      for (let index = 0; index < this.#weightedOccupancy.length; index += 1) {
        this.#weightedOccupancy[index] *= factor
      }
      this.#logScale = logWeight
      scaledWeight = 1
    } else {
      scaledWeight = Math.exp(logWeight - this.#logScale)
    }

    this.#scaledWeightSum += scaledWeight
    this.#scaledSquaredWeightSum += scaledWeight * scaledWeight
    for (let index = 0; index < this.#weightedOccupancy.length; index += 1) {
      if ((occupiedMask & (1n << BigInt(index))) !== 0n) {
        this.#weightedOccupancy[index] += scaledWeight
      }
    }
    this.#sampleCount += 1
  }

  summarize(): ImportanceSummary | null {
    if (this.#sampleCount === 0) return null
    const probabilities = Array.from(this.#weightedOccupancy, (value) =>
      Math.min(1, Math.max(0, value / this.#scaledWeightSum)),
    )
    return {
      probabilities,
      effectiveSampleSize:
        (this.#scaledWeightSum * this.#scaledWeightSum) /
        this.#scaledSquaredWeightSum,
      maxWeightFraction: 1 / this.#scaledWeightSum,
    }
  }
}
