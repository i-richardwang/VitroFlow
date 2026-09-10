import type { Summary } from "../domain/experiments/readings";

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatSummary(
  summary: Summary,
  format: (value: number | null) => string,
): string {
  if (summary.sampleSize === 0) return "—";
  const value = format(summary.value);
  const spread =
    summary.deviation === null
      ? value
      : `${value} ± ${format(summary.deviation)}`;
  return `${spread} (n = ${summary.sampleSize})`;
}

export function formatCountSummary(summary: Summary): string {
  return formatSummary(summary, formatCount);
}

export function formatRateSummary(summary: Summary): string {
  return formatSummary(summary, formatRate);
}
