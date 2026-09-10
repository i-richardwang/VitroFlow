import { Chip } from "@heroui/react";

import type { ImageAnalysisState } from "../../domain/experiments/schema";
import { m } from "../../paraglide/messages";

const DISPLAY: Record<
  ImageAnalysisState,
  { label: () => string; tone: "default" | "success" | "danger" }
> = {
  pending: { label: m.image_analysis_pending, tone: "default" },
  analyzed: { label: m.image_analysis_analyzed, tone: "success" },
  failed: { label: m.image_analysis_failed, tone: "danger" },
};

export function ImageAnalysisStateChip({
  state,
}: {
  state: ImageAnalysisState;
}) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label()}
    </Chip>
  );
}

export function summarizedImageAnalysis(
  counts: Record<ImageAnalysisState, number>,
): ImageAnalysisState | null {
  if (counts.failed > 0) return "failed";
  if (counts.pending > 0) return "pending";
  if (counts.analyzed > 0) return "analyzed";
  return null;
}
