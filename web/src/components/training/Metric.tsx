export function Metric({
  value,
  digits = 3,
}: {
  value: number | null;
  digits?: number;
}) {
  return value === null ? (
    <span className="text-muted">—</span>
  ) : (
    <>{value.toFixed(digits)}</>
  );
}
