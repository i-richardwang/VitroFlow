import { Chip } from "@heroui/react";

import type { ReviewState } from "../annotation/schema";
import { m } from "../paraglide/messages";

type Tone = "accent" | "success";

const DISPLAY: Record<ReviewState, { label: () => string; tone: Tone }> = {
  unreviewed: { label: m.review_state_unreviewed, tone: "accent" },
  reviewed: { label: m.review_state_reviewed, tone: "success" },
};

export function reviewStateLabel(state: ReviewState): string {
  return DISPLAY[state].label();
}

export function ReviewStateChip({ state }: { state: ReviewState }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label()}
    </Chip>
  );
}
