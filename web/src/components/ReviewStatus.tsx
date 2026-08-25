import { Chip } from "@heroui/react";

import type { ReviewState } from "../annotation/schema";

type Tone = "default" | "warning" | "success";

const DISPLAY: Record<ReviewState, { label: string; tone: Tone }> = {
  uninitialized: { label: "Not started", tone: "default" },
  in_progress: { label: "In progress", tone: "warning" },
  complete: { label: "Complete", tone: "success" },
  excluded: { label: "Excluded", tone: "default" },
};

const DOT_COLORS: Record<Tone, string> = {
  default: "bg-muted",
  warning: "bg-warning",
  success: "bg-success",
};

export function reviewStateLabel(state: ReviewState): string {
  return DISPLAY[state].label;
}

export function ReviewStatusChip({ state }: { state: ReviewState }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}

export function ReviewStatusDot({ state }: { state: ReviewState }) {
  return (
    <span
      className={`size-1.5 rounded-full ${DOT_COLORS[DISPLAY[state].tone]}`}
    />
  );
}
