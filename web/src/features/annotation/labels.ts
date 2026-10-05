import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";

export const sourceLabels: Record<ReviewSource, () => string> = {
  review: m.annotation_source_review,
  proposal: m.annotation_source_proposal,
  detection: m.annotation_source_detected,
};
