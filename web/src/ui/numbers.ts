import { getLocale } from "../paraglide/runtime";

/*
 * Every number on screen is written by the reader's locale: its digit
 * grouping, decimal mark and percent sign.
 */

function format(value: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

/** A count or a mean of counts: whole numbers as they are, others to one decimal. */
export function formatCount(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 1;
  return format(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A measured value to a fixed number of decimals, such as a metric. */
export function formatDecimal(value: number, digits: number): string {
  return format(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A value entered or configured elsewhere, to every decimal it carries. */
export function formatNumber(value: number): string {
  return format(value, { maximumFractionDigits: 20 });
}

/** A ratio, where 1 is whole, as a percent without decimals. */
export function formatPercent(ratio: number): string {
  return format(ratio, { style: "percent", maximumFractionDigits: 0 });
}
