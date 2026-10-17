import type { CountAccuracy } from "../../domain/models/comparison";
import { formatDecimal } from "../../ui/numbers";

/** Mean count error per image, all classes together. */
export function totalError(accuracy: CountAccuracy): number {
  return Object.values(accuracy.meanError).reduce(
    (sum, error) => sum + error,
    0,
  );
}

/** A mean count error, to two decimals so a small gain still shows. */
export function formatError(error: number): string {
  return formatDecimal(error, 2);
}
