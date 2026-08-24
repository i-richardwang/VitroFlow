export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}
