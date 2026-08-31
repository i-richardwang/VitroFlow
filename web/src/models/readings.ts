import { z } from "zod";

const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Use lower_snake_case");

/** The category a model assigns to each instance it finds. */
export const classNameSchema = identifierSchema;

const readingIdentity = {
  id: identifierSchema,
  name: z.string().min(1),
};

/**
 * A reading is the number an experiment records for one photograph: a
 * declared reduction of the instances found in it. A model declares the
 * readings its classes support, so the workbench shows a germination rate
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

export const readingSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...readingIdentity,
      kind: z.literal("count"),
      classes: classListSchema,
    }),
    z.strictObject({
      ...readingIdentity,
      kind: z.literal("proportion"),
      of: classListSchema,
      among: classListSchema,
    }),
  ])
  .superRefine((reading, context) => {
    if (reading.kind !== "proportion") return;
    const population = new Set(reading.among);
    reading.of.forEach((name, index) => {
      if (!population.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["of", index],
          message: `Numerator class ${name} is not in the population`,
        });
      }
    });
  });

export type Reading = z.infer<typeof readingSchema>;

/** Instances per class in one photograph. */
export type Tally = Record<string, number>;

export function readingClasses(reading: Reading): string[] {
  return reading.kind === "count"
    ? reading.classes
    : [...reading.of, ...reading.among];
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
export function read(reading: Reading, counts: Tally): number | null {
  if (reading.kind === "count") return total(counts, reading.classes);
  const among = total(counts, reading.among);
  return among === 0 ? null : total(counts, reading.of) / among;
}

/**
 * The mean reading over replicates: what one dish of the treatment showed,
 * typically. Dishes without a value are not replicates of it.
 */
export interface ReadingSummary {
  value: number | null;
  sampleSize: number;
}

export function summarize(
  reading: Reading,
  tallies: readonly Tally[],
): ReadingSummary {
  const values = tallies.flatMap((counts) => read(reading, counts) ?? []);
  return {
    value:
      values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length,
    sampleSize: values.length,
  };
}

export function formatReading(reading: Reading, value: number | null): string {
  if (value === null) return "—";
  if (reading.kind === "proportion") return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
