import { Absent } from "./Absent";
import { formatDecimal } from "./numbers";

/** A validation metric to three places; a missing one is `Absent`. */
export function Metric({
  value,
  digits = 3,
}: {
  value: number | null;
  digits?: number;
}) {
  return value === null ? <Absent /> : formatDecimal(value, digits);
}
