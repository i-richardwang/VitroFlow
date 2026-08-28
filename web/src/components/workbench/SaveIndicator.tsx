import { Button } from "@heroui/react";

import type { SaveState } from "../../hooks/useAnnotation";

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
        <Button variant="danger-soft" onPress={onRetry}>
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
