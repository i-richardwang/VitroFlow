import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { Review } from "../../annotation/review";
import { initializeLabel } from "../../functions/review";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { QualityWarnings } from "../QualityWarnings";
import { Workbench } from "../Workbench";
import { AnnotationEditor } from "./AnnotationEditor";

export function ImageWorkbench({ review }: { review: Review }) {
  const { ref, filename } = review;

  if (review.state === "started") {
    return (
      <AnnotationEditor
        subject={ref}
        model={review.model}
        filename={filename}
        result={review.detection}
        label={review.label}
      />
    );
  }

  return (
    <Workbench
      title={`Review ${filename} for ${review.model.name}`}
      actions={
        review.state === "detected" ? (
          <QualityWarnings quality={review.detection.quality} />
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
        {review.state === "detected" ? (
          <Notice
            title="No review yet"
            description={`Start from the ${review.detection.instances.length} ${review.detection.instances.length === 1 ? "box" : "boxes"} this version found.`}
            action={{
              label: "Start review",
              run: () =>
                initializeLabel({
                  data: {
                    ...ref,
                    versionId: review.detection.producer.model_version_id,
                  },
                }),
            }}
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
  const mutation = useAsyncAction();

  return (
    <Button
      variant="primary"
      isDisabled={mutation.busy}
      onPress={async () => {
        const result = await mutation.run(action.run, "Could not start review");
        if (result.ok) await router.invalidate();
      }}
    >
      {action.label}
    </Button>
  );
}
