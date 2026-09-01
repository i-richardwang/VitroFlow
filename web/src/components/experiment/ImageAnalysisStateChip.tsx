import { Chip } from "@heroui/react";

const DISPLAY: Record<
  "pending" | "analyzed",
  { label: string; tone: "default" | "success" }
> = {
  pending: { label: "Pending", tone: "default" },
  analyzed: { label: "Analyzed", tone: "success" },
};

export function ImageAnalysisStateChip({
  state,
}: {
  state: "pending" | "analyzed";
}) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}
