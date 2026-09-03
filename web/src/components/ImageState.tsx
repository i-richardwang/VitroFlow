import { Chip } from "@heroui/react";

import type { ImageState } from "../datasets/schema";

type Tone = "default" | "warning" | "success" | "danger" | "accent";

const DISPLAY: Record<ImageState, { label: string; tone: Tone }> = {
  unreviewed: { label: "To review", tone: "accent" },
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
