import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Review } from "../../server/review";
import { initializeLabel } from "../../functions/review";
import { QualityWarnings } from "../QualityWarnings";
import { Workbench } from "../Workbench";
import { AnnotationEditor } from "./AnnotationEditor";

/**
 * The review of one image for one model. Once the review has started, the
 * editor owns it; before that, the page offers to start from what the
 * model's version found.
 */
export function ImageWorkbench({ review }: { review: Review }) {
  const { ref, filename, detection, label } = review;

  if (label && detection) {
    return (
      <AnnotationEditor
        subject={ref}
        model={review.model}
        filename={filename}
        result={detection}
        label={label}
      />
    );
  }

  return (
    <Workbench
      title={`Review ${filename} for ${review.model.name}`}
      actions={detection && <QualityWarnings quality={detection.quality} />}
    >
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
        {detection ? (
          <Notice
            title="No review yet"
            description={`Start from the ${detection.instances.length} ${detection.instances.length === 1 ? "box" : "boxes"} this version found.`}
            action={{
              label: "Start review",
              run: () =>
                initializeLabel({
                  data: {
                    ...ref,
                    versionId: detection.producer.model_version_id,
                  },
                }),
            }}
          />
        ) : label ? (
          <Notice
            title="Detection unavailable"
            description="The detection this review started from is no longer stored."
          />
        ) : (
          <Notice
            title="Nothing to review yet"
            description={`No version of ${review.model.name} has detected this photograph yet.`}
          />
        )}
      </div>
    </Workbench>
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
