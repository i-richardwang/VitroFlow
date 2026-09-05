import { m } from "../paraglide/messages";
import type { ObservationUnit } from "./contracts";
import type { Treatment } from "./schema";

export function designIssues(
  treatments: readonly Treatment[],
  observationUnits: readonly Pick<ObservationUnit, "treatment">[],
): string[] {
  const issues: string[] = [];
  if (treatments.length === 0) issues.push(m.experiment_design_add_treatment());
  if (observationUnits.length === 0)
    issues.push(m.experiment_design_add_unit());
  if (
    observationUnits.some(
      (observationUnit) => observationUnit.treatment === null,
    )
  ) {
    issues.push(m.experiment_design_assign_units());
  }
  const represented = new Set(
    observationUnits.map((observationUnit) => observationUnit.treatment),
  );
  if (treatments.some((treatment) => !represented.has(treatment.id))) {
    issues.push(m.experiment_design_fill_treatments());
  }
  return issues;
}
