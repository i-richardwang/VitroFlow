/** A count or a mean of counts: whole numbers as they are, others to one decimal. */
export function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
