import { Chip } from "@heroui/react";

const DISPLAY: Record<
  "pending" | "observed",
  { label: string; tone: "default" | "success" }
> = {
  pending: { label: "Pending", tone: "default" },
  observed: { label: "Observed", tone: "success" },
};

export function PhotoStateChip({ state }: { state: "pending" | "observed" }) {
  const { label, tone } = DISPLAY[state];
  return (
    <Chip color={tone} variant="soft" size="sm">
      {label}
    </Chip>
  );
}
