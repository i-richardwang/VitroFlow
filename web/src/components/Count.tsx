/** A tabular figure that shows a dash when the count does not exist. */
export function Count({ value }: { value: number | null }) {
  return value == null ? <span className="text-muted">—</span> : <>{value}</>;
}
