import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { AnnotationDocument } from "../../annotation/schema";
import type { ImageRef } from "../../datasets/schema";
import { isFailure, type Prelabel } from "../../detection/schema";
import { initializeLabel, retryPrelabel } from "../../server/images";
import { NavbarEnd } from "../shell";
import { QualityWarnings } from "../QualityWarnings";
import { AnnotationEditor } from "./AnnotationEditor";

export function ImageWorkbench({
  image,
  filename,
  prelabel,
  label,
}: {
  image: ImageRef;
  filename: string;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
}) {
  if (label && prelabel && !isFailure(prelabel)) {
    return (
      <div className="flex h-full flex-col">
        <AnnotationEditor
          image={image}
          filename={filename}
          result={prelabel}
          label={label}
        />
      </div>
    );
  }

  const quality = prelabel && !isFailure(prelabel) ? prelabel.quality : null;

  return (
    <div className="flex h-full flex-col">
      {quality && (
        <NavbarEnd>
          <QualityWarnings quality={quality} />
        </NavbarEnd>
      )}
      <div className="flex flex-1 items-center justify-center p-6">
        {prelabel === null ? (
          <Notice
            title="Waiting for a worker"
            description="A connected worker will detect seeds in this image."
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
            description={`Start from ${prelabel.instances.length} prelabels, then review each seed.`}
            action={{
              label: "Initialize from prelabels",
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
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Header>
      {action ? (
        <EmptyState.Content>
          <NoticeAction action={action} />
        </EmptyState.Content>
      ) : null}
    </EmptyState>
  );
}

function NoticeAction({
  action,
}: {
  action: { label: string; run: () => Promise<unknown> };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="primary"
      size="sm"
      isDisabled={busy}
      onPress={async () => {
        setBusy(true);
        try {
          await action.run();
          await router.invalidate();
        } catch (cause) {
          toast.danger(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      {action.label}
    </Button>
  );
}
