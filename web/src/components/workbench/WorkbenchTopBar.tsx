import { Breadcrumbs, Button } from "@heroui/react";

import type { ImageRef } from "../../datasets/schema";
import type { SeedQuality } from "../../detection/schema";
import type { SaveState } from "../../hooks/useAnnotation";
import { QualityWarnings } from "../QualityWarnings";

export function WorkbenchTopBar({
  image,
  quality,
  trailing,
}: {
  image: ImageRef;
  quality: SeedQuality | null;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator bg-surface px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Breadcrumbs className="font-mono">
          <Breadcrumbs.Item href="/">Datasets</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/datasets/${image.dataset}`}>
            {image.dataset}
          </Breadcrumbs.Item>
          <Breadcrumbs.Item>{image.stem}</Breadcrumbs.Item>
        </Breadcrumbs>
        {quality && <QualityWarnings quality={quality} />}
      </div>
      <div className="flex items-center justify-end gap-3">{trailing}</div>
    </div>
  );
}

export function SaveIndicator({
  state,
  error,
  onRetry,
}: {
  state: SaveState;
  error: string | null;
  onRetry: () => void;
}) {
  if (state === "failed") {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-danger" title={error ?? undefined}>
          Save failed
        </span>
        <Button variant="danger-soft" size="sm" onPress={onRetry}>
          Retry
        </Button>
      </span>
    );
  }
  return (
    <span className="text-xs text-muted">
      {state === "saved" ? "Saved" : "Saving…"}
    </span>
  );
}
