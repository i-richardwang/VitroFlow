import { Absent } from "./Absent";
import { formatDecimal } from "./numbers";

/** A validation metric to three decimals; a missing one is `Absent`. */
export function Metric({ value }: { value: number | null }) {
  return value === null ? <Absent /> : formatDecimal(value, 3);
}
