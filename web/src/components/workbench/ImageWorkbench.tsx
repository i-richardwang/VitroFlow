import { Button, Card } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { AnnotationDocument } from "../../annotation/schema";
import type { ImageRef } from "../../datasets/schema";
import { isFailure, type Prelabel } from "../../detection/schema";
import { initializeLabel, retryPrelabel } from "../../server/images";
import { AnnotationEditor } from "./AnnotationEditor";
import { WorkbenchTopBar } from "./WorkbenchTopBar";

export function ImageWorkbench({
  image,
  prelabel,
  label,
}: {
  image: ImageRef;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
}) {
  if (label && prelabel && !isFailure(prelabel)) {
    return (
      <div className="flex h-full flex-col">
        <AnnotationEditor image={image} result={prelabel} label={label} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <WorkbenchTopBar
        image={image}
        quality={prelabel && !isFailure(prelabel) ? prelabel.quality : null}
      />
      <div className="flex flex-1 items-center justify-center p-6">
        {prelabel === null ? (
          <Notice
            title="Waiting for a worker"
            description="A connected worker will detect seeds in this image; the page refreshes on its own."
          />
        ) : isFailure(prelabel) ? (
          <Notice
            title="Detection failed"
            description={prelabel.error}
            action={{
              label: "Try again",
              run: () => retryPrelabel({ data: image }),
            }}
          />
        ) : (
          <Notice
            title="No annotation yet"
            description={`Initialize boxes from the ${prelabel.count} detections, then review every seed before marking the image complete.`}
            action={{
              label: "Initialize from detections",
              run: () => initializeLabel({ data: image }),
            }}
          />
        )}
      </div>
    </div>
  );
}

function Notice({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; run: () => Promise<unknown> };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const perform = async () => {
    if (!action) {
      return;
    }
    setBusy(true);
    try {
      await action.run();
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-md">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      {action && (
        <Card.Footer className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            isDisabled={busy}
            onPress={perform}
          >
            {action.label}
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </Card.Footer>
      )}
    </Card>
  );
}
