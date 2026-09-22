import type { ReviewSource } from "../../domain/annotation/review";
import type {
  AnnotationRuntimeName,
  AnnotationExecutor,
} from "../../domain/annotation-runs/schema";
import { m } from "../../paraglide/messages";

export const sourceLabels: Record<ReviewSource, () => string> = {
  review: m.workbench_source_review,
  proposal: m.workbench_source_proposal,
  detection: m.workbench_source_detected,
};

export const agentLabels: Record<AnnotationRuntimeName, () => string> = {
  pi: m.ai_agent_pi,
  antigravity: m.ai_agent_antigravity,
};

export const executorLabel = (executor: AnnotationExecutor) =>
  executor.kind === "interactive"
    ? m.ai_executor_interactive()
    : agentLabels[executor.runtime]();
