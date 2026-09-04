import { Chip } from "@heroui/react";

import type { ReviewState } from "../annotation/schema";

type Tone = "accent" | "warning" | "success";

const DISPLAY: Record<ReviewState, { label: string; tone: Tone }> = {
  unreviewed: { label: "To review", tone: "accent" },
  in_progress: { label: "In progress", tone: "warning" },
  complete: { label: "Complete", tone: "success" },
};

export function reviewStateLabel(state: ReviewState): string {
  return DISPLAY[state].label;
}

export function ReviewStateChip({ state }: { state: ReviewState }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}
