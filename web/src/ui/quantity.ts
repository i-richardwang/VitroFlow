import { getLocale } from "../paraglide/runtime";

/** A whole count with the reader's digit grouping. */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: 0,
  }).format(value);
}
