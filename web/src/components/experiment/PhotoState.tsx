import { Chip } from "@heroui/react";

import type { PhotoState } from "../../experiments/schema";

const DISPLAY: Record<
  PhotoState,
  { label: string; tone: "default" | "danger" | "success" }
> = {
  pending: { label: "Pending", tone: "default" },
  failed: { label: "Failed", tone: "danger" },
  counted: { label: "Counted", tone: "success" },
};

export function PhotoStateChip({ state }: { state: PhotoState }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}
