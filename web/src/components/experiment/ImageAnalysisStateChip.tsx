import { Chip } from "@heroui/react";

import type { ImageAnalysisState } from "../../experiments/schema";

const DISPLAY: Record<
  ImageAnalysisState,
  { label: string; tone: "default" | "success" | "danger" }
> = {
  pending: { label: "Pending", tone: "default" },
  analyzed: { label: "Analyzed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function ImageAnalysisStateChip({
  state,
}: {
  state: ImageAnalysisState;
}) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
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
