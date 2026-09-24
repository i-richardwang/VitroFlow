import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";

export const sourceLabels: Record<ReviewSource, () => string> = {
  review: m.workbench_source_review,
  proposal: m.workbench_source_proposal,
  detection: m.workbench_source_detected,
};
