import { Button } from "@heroui/react";

import type { SaveState } from "../../hooks/useAnnotation";
import { Hint } from "../Hint";

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
        <Hint text={error}>
          <span className="text-danger">Save failed</span>
        </Hint>
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
