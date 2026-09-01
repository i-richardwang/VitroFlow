import type { ObservationUnit } from "./contracts";
import type { Treatment } from "./schema";

export function designIssues(
  treatments: readonly Treatment[],
  observationUnits: readonly Pick<ObservationUnit, "treatment">[],
): string[] {
  const issues: string[] = [];
  if (treatments.length === 0) issues.push("Add at least one treatment");
  if (observationUnits.length === 0)
    issues.push("Add at least one observation unit");
  if (
    observationUnits.some(
      (observationUnit) => observationUnit.treatment === null,
    )
  ) {
    issues.push("Assign every observation unit to a treatment");
  }
  const represented = new Set(
    observationUnits.map((observationUnit) => observationUnit.treatment),
  );
  if (treatments.some((treatment) => !represented.has(treatment.id))) {
    issues.push("Give every treatment at least one observation unit");
  }
  return issues;
}
