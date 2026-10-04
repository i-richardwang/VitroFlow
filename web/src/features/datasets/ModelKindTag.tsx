import type { ModelArtifact } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { Tag } from "../../ui/kit/Tag";

const KIND_LABELS: Record<ModelArtifact["kind"], () => string> = {
  traditional: m.model_kind_traditional,
  ultralytics: m.model_kind_ultralytics,
};

export function ModelKindTag({ kind }: { kind: ModelArtifact["kind"] }) {
  return (
    <Tag color={kind === "ultralytics" ? "info" : undefined}>
      {KIND_LABELS[kind]()}
    </Tag>
  );
}
