import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, toast } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PhotoStateChip } from "../../components/experiment/PhotoState";
import { PhotoView } from "../../components/experiment/PhotoView";
import { Page } from "../../components/Page";
import { QualityWarnings } from "../../components/QualityWarnings";
import { Timestamp } from "../../components/Timestamp";
import { photoRefSchema, type PhotoRef } from "../../experiments/schema";
import {
  getExperimentPhoto,
  retryPhotoDetection,
} from "../../server/experiment-views";

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$dish/$round",
)({
  loader: async ({ params }) => {
    const ref = photoRefSchema.safeParse(params);
    if (!ref.success) throw notFound();
    const photo = await getExperimentPhoto({ data: ref.data });
    if (!photo) throw notFound();
    return photo;
  },
  component: PhotoPage,
});

function PhotoPage() {
  const photo = Route.useLoaderData();
  const router = useRouter();
  const { detection, failure } = photo;

  const waiting = detection === null && failure === null;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  const state = detection ? "counted" : failure ? "failed" : "pending";

  return (
    <Page
      title={
        <span>
          <span className="font-mono">{photo.ref.dish}</span>,{" "}
          {photo.round.label}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Timestamp value={photo.round.capturedAt} />
          <span aria-hidden>·</span>
          <PhotoStateChip state={state} />
          {detection ? (
            <>
              <span>
                {detection.instances.length}{" "}
                {detection.instances.length === 1 ? "seed" : "seeds"}
              </span>
              <QualityWarnings quality={detection.quality} />
            </>
          ) : null}
        </span>
      }
      actions={failure ? <RetryButton photo={photo.ref} /> : undefined}
    >
      {failure ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>Detection failed</EmptyState.Title>
            <EmptyState.Description>{failure.error}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : null}
      <PhotoView
        digest={photo.digest}
        filename={photo.filename}
        width={photo.width}
        height={photo.height}
        detection={detection}
      />
    </Page>
  );
}

function RetryButton({ photo }: { photo: PhotoRef }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      isDisabled={busy}
      onPress={async () => {
        setBusy(true);
        try {
          await retryPhotoDetection({ data: photo });
          await router.invalidate();
        } catch (cause) {
          toast.danger(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      Try again
    </Button>
  );
}
