import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import type { Review } from "../../server/review";
import { initializeLabel } from "../../functions/review";
import { EmptyStateHeading } from "../EmptyStateHeading";
import { NavbarEnd } from "../shell";
import { QualityWarnings } from "../QualityWarnings";
import { AnnotationEditor } from "./AnnotationEditor";

/**
 * The review of one image for one model. Once the review has started, the
 * editor owns it; before that, the page offers to start from what the
 * model's version found.
 */
export function ImageWorkbench({ review }: { review: Review }) {
  const { ref, filename, detection, label } = review;
  const heading = (
    <h1 className="sr-only">
      Review {filename} for {review.model.name}
    </h1>
  );

  if (label && detection) {
    return (
      <div className="flex h-full flex-col">
        {heading}
        <AnnotationEditor
          subject={ref}
          filename={filename}
          result={detection}
          label={label}
        />
      </div>
    );
  }

  const quality = detection?.quality ?? null;

  return (
    <div className="flex h-full flex-col">
      {heading}
      {quality && (
        <NavbarEnd>
          <QualityWarnings quality={quality} />
        </NavbarEnd>
      )}
      <div className="flex flex-1 items-center justify-center p-6">
        {detection ? (
          <Notice
            title="No review yet"
            description={`Start from the ${detection.instances.length} ${detection.instances.length === 1 ? "box" : "boxes"} ${detection.producer.model_version_id} found, then correct each one.`}
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
            description={`No version of ${review.model.name} has detected this photograph. A connected worker detects it for the experiment it belongs to.`}
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
        <EmptyStateHeading>{title}</EmptyStateHeading>
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
