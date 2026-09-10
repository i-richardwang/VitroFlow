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

/**
 * Instances per class in one observation image, keyed by whatever a model calls
 * its classes. A tally holds nothing but the classes counted, and a class
 * absent from it was counted zero times, whatever that class is named.
 */
export const tallySchema = z.record(z.string(), z.number().int().min(0));

export type Tally = z.infer<typeof tallySchema>;

/** How many instances of one class a reading found. */
export function classCount(counts: Tally, name: string): number {
  return Object.hasOwn(counts, name) ? counts[name] : 0;
}

export function tally(instances: readonly { class: string }[]): Tally {
  const counts: Tally = Object.create(null);
  for (const instance of instances) {
    counts[instance.class] = classCount(counts, instance.class) + 1;
  }
  return counts;
}

/** How many individuals a reading found, across every class it recognizes. */
export function count(counts: Tally): number {
  return Object.values(counts).reduce((sum, found) => sum + found, 0);
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
