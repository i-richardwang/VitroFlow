export function Count({ value }: { value: number | null }) {
  return value == null ? <span className="text-muted">—</span> : <>{value}</>;
}
