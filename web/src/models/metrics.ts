import { z } from "zod";

const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Use lower_snake_case");

/** The category a model assigns to each instance it finds. */
export const classNameSchema = identifierSchema;

const metricIdentity = {
  id: identifierSchema,
  name: z.string().min(1),
};

/**
 * A metric is the value an experiment derives from one observation image: a
 * declared reduction of the instances found in it. A model declares the
 * metrics its classes support, so the workbench shows a germination rate
 * for a model that separates germinated seeds and a plain count for one that
 * does not, from the same definitions.
 */
export const classListSchema = z
  .array(classNameSchema)
  .min(1)
  .superRefine((classes, context) => {
    if (new Set(classes).size !== classes.length) {
      context.addIssue({ code: "custom", message: "Classes must be unique" });
    }
  });

export const derivedMetricSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...metricIdentity,
      kind: z.literal("count"),
      classes: classListSchema,
    }),
    z.strictObject({
      ...metricIdentity,
      kind: z.literal("proportion"),
      of: classListSchema,
      among: classListSchema,
    }),
  ])
  .superRefine((metric, context) => {
    if (metric.kind !== "proportion") return;
    const population = new Set(metric.among);
    metric.of.forEach((name, index) => {
      if (!population.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["of", index],
          message: `Numerator class ${name} is not in the population`,
        });
      }
    });
  });

export type DerivedMetric = z.infer<typeof derivedMetricSchema>;

/** Instances per class in one observation image. */
export const tallySchema = z.record(z.string(), z.number().int().min(0));

export type Tally = z.infer<typeof tallySchema>;

export function metricClasses(metric: DerivedMetric): string[] {
  return metric.kind === "count"
    ? metric.classes
    : [...metric.of, ...metric.among];
}

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

function total(counts: Tally, classes: readonly string[]): number {
  return classes.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
}

/** A proportion of nothing has no value. */
export function computeMetric(
  metric: DerivedMetric,
  counts: Tally,
): number | null {
  if (metric.kind === "count") return total(counts, metric.classes);
  const among = total(counts, metric.among);
  return among === 0 ? null : total(counts, metric.of) / among;
}

/**
 * The metric over replicates: the typical observation-unit value and its
 * spread. Observation units without a value are absent. The spread is the
 * sample standard deviation, which a single replicate does not have.
 */
export interface MetricSummary {
  value: number | null;
  deviation: number | null;
  sampleSize: number;
}

export function summarizeMetric(
  metric: DerivedMetric,
  tallies: readonly Tally[],
): MetricSummary {
  const values = tallies.flatMap(
    (counts) => computeMetric(metric, counts) ?? [],
  );
  if (values.length === 0) {
    return { value: null, deviation: null, sampleSize: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread =
    values.length < 2
      ? null
      : Math.sqrt(
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            (values.length - 1),
        );
  return { value: mean, deviation: spread, sampleSize: values.length };
}

export function formatMetric(
  metric: DerivedMetric,
  value: number | null,
): string {
  if (value === null) return "—";
  if (metric.kind === "proportion") return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatMetricSummary(
  metric: DerivedMetric,
  summary: MetricSummary,
): string {
  if (summary.sampleSize === 0) return "—";
  const value = formatMetric(metric, summary.value);
  const spread =
    summary.deviation === null
      ? value
      : `${value} ± ${formatMetric(metric, summary.deviation)}`;
  return `${spread} (n = ${summary.sampleSize})`;
}
