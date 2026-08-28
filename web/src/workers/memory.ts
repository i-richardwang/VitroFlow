const GIBIBYTE = 1024 ** 3;
const GIBIBYTE_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

/** Training-memory capacity in binary gigabytes, with one useful decimal. */
export function formatGibibytes(bytes: number): string {
  return `${GIBIBYTE_FORMAT.format(bytes / GIBIBYTE)} GiB`;
}
