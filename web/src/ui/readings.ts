import type { Summary } from "../domain/experiments/readings";

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatCountSummary(summary: Summary): string {
  if (summary.sampleSize === 0) return "—";
  const value = formatCount(summary.value);
  const spread =
    summary.deviation === null
      ? value
      : `${value} ± ${formatCount(summary.deviation)}`;
  return `${spread} (n = ${summary.sampleSize})`;
}
