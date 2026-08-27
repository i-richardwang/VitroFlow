/** A metric in [0, 1] to three places, or a dash before one exists. */
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
