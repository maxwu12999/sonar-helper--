import {
  SUBMARINE_LENGTHS,
  type FixedSubmarine,
  type FleetConfig,
} from '../types/game'

export function getFleetSubmarineCount(fleetConfig: FleetConfig): number {
  return SUBMARINE_LENGTHS.reduce(
    (total, length) => total + fleetConfig[length],
    0,
  )
}

export function getFleetOccupiedCellCount(fleetConfig: FleetConfig): number {
  return SUBMARINE_LENGTHS.reduce(
    (total, length) => total + length * fleetConfig[length],
    0,
  )
}

export function getRemainingFleetConfig(
  fleetConfig: FleetConfig,
  fixedSubmarines: readonly FixedSubmarine[],
): FleetConfig {
  const fixedCounts = { 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const submarine of fixedSubmarines) fixedCounts[submarine.length] += 1
  return {
    2: Math.max(0, fleetConfig[2] - fixedCounts[2]),
    3: Math.max(0, fleetConfig[3] - fixedCounts[3]),
    4: Math.max(0, fleetConfig[4] - fixedCounts[4]),
    5: Math.max(0, fleetConfig[5] - fixedCounts[5]),
  }
}

export function getRemainingSubmarineCount(
  fleetConfig: FleetConfig,
  fixedSubmarines: readonly FixedSubmarine[],
): number {
  return getFleetSubmarineCount(
    getRemainingFleetConfig(fleetConfig, fixedSubmarines),
  )
}
