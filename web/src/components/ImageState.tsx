import { Chip } from "@heroui/react";

import type { ImageState } from "../datasets/schema";

type Tone = "default" | "warning" | "success" | "danger" | "accent";

const DISPLAY: Record<ImageState, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "default" },
  failed: { label: "Failed", tone: "danger" },
  prelabeled: { label: "To review", tone: "accent" },
  in_progress: { label: "In progress", tone: "warning" },
  complete: { label: "Complete", tone: "success" },
  excluded: { label: "Excluded", tone: "default" },
};

export function imageStateLabel(state: ImageState): string {
  return DISPLAY[state].label;
}

export function ImageStateChip({ state }: { state: ImageState }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}

const DOT_COLORS: Record<Tone, string> = {
  default: "bg-muted",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
  accent: "bg-accent",
};

export function ImageStateDot({ state }: { state: ImageState }) {
  return (
    <span
      className={`size-1.5 rounded-full ${DOT_COLORS[DISPLAY[state].tone]}`}
    />
  );
}
