export function formatProbability(probability: number): string {
  if (probability === 0) return '0%'
  if (probability === 1) return '100%'
  return `${(probability * 100).toFixed(1)}%`
}
