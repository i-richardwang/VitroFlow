import { Chip } from "@heroui/react";

import type { ModelArtifact } from "../../models/schema";

const KIND_LABELS: Record<ModelArtifact["kind"], string> = {
  traditional: "Traditional",
  ultralytics: "YOLO",
};

export function ModelKindChip({ kind }: { kind: ModelArtifact["kind"] }) {
  return (
    <Chip color={kind === "ultralytics" ? "accent" : "default"} variant="soft" size="sm">
      {KIND_LABELS[kind]}
    </Chip>
  );
}
