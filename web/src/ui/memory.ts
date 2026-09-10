import { getLocale } from "../paraglide/runtime";

const GIBIBYTE = 1024 ** 3;

/** Training-memory capacity in binary gigabytes, with one useful decimal. */
export function formatGibibytes(bytes: number): string {
  const amount = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: 1,
  }).format(bytes / GIBIBYTE);
  return `${amount} GiB`;
}
