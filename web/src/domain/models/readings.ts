import { z } from "zod";

const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Use lower_snake_case");

/** The category a model assigns to each instance it finds. */
export const classNameSchema = identifierSchema;

export const classListSchema = z
  .array(classNameSchema)
  .min(1)
  .superRefine((classes, context) => {
    if (new Set(classes).size !== classes.length) {
      context.addIssue({ code: "custom", message: "Classes must be unique" });
    }
  });

/** Instances per class in one observation image. */
export const tallySchema = z.record(z.string(), z.number().int().min(0));

export type Tally = z.infer<typeof tallySchema>;

export function tally(instances: readonly { class: string }[]): Tally {
  const counts: Tally = {};
  for (const instance of instances) {
    counts[instance.class] = (counts[instance.class] ?? 0) + 1;
  }
  return counts;
}

/** Rejects instances that cannot belong to this model's detection task. */
export function assertInstanceClasses(
  classes: readonly string[],
  instances: readonly { class: string }[],
  context: string,
): void {
  const known = new Set(classes);
  const unknown = [
    ...new Set(instances.map((instance) => instance.class)),
  ].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `${context} uses unknown ${unknown.length === 1 ? "class" : "classes"}: ${unknown.join(", ")}`,
    );
  }
}

/** How many individuals a reading found, across every class it recognizes. */
export function count(counts: Tally): number {
  return Object.values(counts).reduce((sum, found) => sum + found, 0);
}

/**
 * The share of the unit's starting population this count represents. A unit
 * whose baseline was never counted has no share, and neither has one whose
 * baseline found nothing.
 */
export function rate(found: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0) return null;
  return found / baseline;
}

/**
 * A quantity over the replicates of one treatment: the typical value and its
 * spread. Units without a value are absent. The spread is the sample standard
 * deviation, which a single replicate does not have.
 */
export interface Summary {
  value: number | null;
  deviation: number | null;
  sampleSize: number;
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) {
    return { value: null, deviation: null, sampleSize: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation =
    values.length < 2
      ? null
      : Math.sqrt(
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            (values.length - 1),
        );
  return { value: mean, deviation, sampleSize: values.length };
}

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
