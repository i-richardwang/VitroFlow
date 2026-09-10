import { Chip } from "@heroui/react";

import type { ModelArtifact } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";

const KIND_LABELS: Record<ModelArtifact["kind"], () => string> = {
  traditional: m.model_kind_traditional,
  ultralytics: m.model_kind_ultralytics,
};

export function ModelKindChip({ kind }: { kind: ModelArtifact["kind"] }) {
  return (
    <Chip
      color={kind === "ultralytics" ? "accent" : "default"}
      variant="soft"
      size="sm"
    >
      {KIND_LABELS[kind]()}
    </Chip>
  );
}
