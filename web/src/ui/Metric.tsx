import { Absent } from "./Absent";

/** A validation metric to three places; a missing one is `Absent`. */
export function Metric({
  value,
  digits = 3,
}: {
  value: number | null;
  digits?: number;
}) {
  return value === null ? <Absent /> : <>{value.toFixed(digits)}</>;
}
