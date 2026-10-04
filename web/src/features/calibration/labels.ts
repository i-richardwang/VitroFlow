import type { ReviewSource } from "../../domain/annotation/schema";
import { m } from "../../paraglide/messages";

export const sourceLabels: Record<ReviewSource, () => string> = {
  review: m.calibration_source_review,
  proposal: m.calibration_source_proposal,
  detection: m.calibration_source_detected,
};
