import type { ExperimentDish } from "./contracts";
import type { Treatment } from "./schema";

export function designIssues(
  treatments: readonly Treatment[],
  dishes: readonly Pick<ExperimentDish, "treatment">[],
): string[] {
  const issues: string[] = [];
  if (treatments.length === 0) issues.push("Add at least one treatment");
  if (dishes.length === 0) issues.push("Add at least one dish");
  if (dishes.some((dish) => dish.treatment === null)) {
    issues.push("Assign every dish to a treatment");
  }
  const represented = new Set(dishes.map((dish) => dish.treatment));
  if (treatments.some((treatment) => !represented.has(treatment.id))) {
    issues.push("Give every treatment at least one dish");
  }
  return issues;
}
