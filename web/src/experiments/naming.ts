import { compareDishLabels, treatmentNameSchema } from "./schema";

/**
 * Notebook dish names encode the treatment and the replicate: `T1-2` is the
 * second dish of treatment `T1`. A name groups when it ends in a replicate
 * number separated by `-`, `_`, or a space, and the prefix fits a treatment
 * name.
 */
const GROUPED_LABEL = /^(.*\S)[-_ ](\d+)$/;

/** The treatment a dish name spells, or null when the name does not group. */
export function treatmentOfDish(label: string): string | null {
  const match = GROUPED_LABEL.exec(label);
  if (!match) return null;
  const name = treatmentNameSchema.safeParse(match[1]);
  return name.success ? name.data : null;
}

export interface InferredTreatment {
  name: string;
  dishes: string[];
}

export function inferTreatments(
  labels: readonly string[],
): InferredTreatment[] {
  const groups = new Map<string, string[]>();
  for (const label of labels) {
    const name = treatmentOfDish(label);
    if (name === null) continue;
    const dishes = groups.get(name) ?? [];
    dishes.push(label);
    groups.set(name, dishes);
  }
  if (groups.size < 2) return [];
  return [...groups]
    .map(([name, dishes]) => ({ name, dishes }))
    .sort((left, right) => compareDishLabels(left.name, right.name));
}
