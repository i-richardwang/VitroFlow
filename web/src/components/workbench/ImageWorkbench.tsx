import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { Review } from "../../annotation/review";
import { startAnnotation } from "../../functions/review";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { Workbench } from "../Workbench";
import { AnnotationEditor } from "./AnnotationEditor";

export function ImageWorkbench({ review }: { review: Review }) {
  const { ref, filename } = review;
  const router = useRouter();

  if (review.state === "started") {
    const detection = review.detection;
    return (
      <AnnotationEditor
        key={review.annotation.revision}
        subject={ref}
        model={review.model}
        filename={filename}
        detection={detection}
        annotation={review.annotation}
        onRestartFromDetection={
          detection
            ? async () => {
                await startAnnotation({
                  data: {
                    ...ref,
                    versionId: detection.producer.modelVersionId,
                  },
                });
                await router.invalidate();
              }
            : undefined
        }
      />
    );
  }

  return (
    <Workbench title={`Review ${filename} for ${review.model.name}`}>
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
        {review.state === "detected" ? (
          <Notice
            title="No review yet"
            action={{
              label: "Start review",
              run: () =>
                startAnnotation({
                  data: {
                    ...ref,
                    versionId: review.detection.producer.modelVersionId,
                  },
                }),
            }}
          />
        ) : (
          <Notice title="Nothing to review yet" />
        )}
      </div>
    </Workbench>
  );
}

function Notice({
  title,
  action,
}: {
  title: string;
  action?: { label: string; run: () => Promise<unknown> };
}) {
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>{title}</EmptyState.Title>
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
