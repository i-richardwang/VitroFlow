import { Button, Card } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { initializeLabel } from "../../server/runs";

export function InitializeLabelCard({
  runId,
  stem,
  detectionCount,
}: {
  runId: string;
  stem: string;
  detectionCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initialize = async () => {
    setBusy(true);
    try {
      await initializeLabel({ data: { runId, stem } });
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="max-w-md">
        <Card.Header>
          <Card.Title>No annotation yet</Card.Title>
          <Card.Description>
            Initialize boxes from the {detectionCount} algorithm detections,
            then review every seed before marking the image complete.
          </Card.Description>
        </Card.Header>
        <Card.Footer className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            isDisabled={busy}
            onPress={initialize}
          >
            Initialize from detections
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </Card.Footer>
      </Card>
    </div>
  );
}
