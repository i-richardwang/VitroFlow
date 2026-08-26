/** A tabular figure that shows a dash for nothing to count. */
export function Count({ value }: { value: number | null }) {
  return value ? <>{value}</> : <span className="text-muted">—</span>;
}
