import type { ReviewSource } from "../../domain/annotation/review";
import type { AnnotationRuntimeName } from "../../domain/annotation-runs/schema";
import { m } from "../../paraglide/messages";

/** The readings of an image, named as every page names them. */
export const sourceLabels: Record<ReviewSource, () => string> = {
  review: m.workbench_source_review,
  proposal: m.workbench_source_proposal,
  detection: m.workbench_source_detected,
};

export const agentLabels: Record<AnnotationRuntimeName, () => string> = {
  pi: m.ai_agent_pi,
  antigravity: m.ai_agent_antigravity,
};
