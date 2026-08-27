import {
  AlertDialog,
  Breadcrumbs,
  Button,
  EmptyState,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Count } from "../../components/Count";
import { DatasetOverview } from "../../components/dataset/DatasetOverview";
import { VersionsPanel } from "../../components/dataset/VersionsPanel";
import { PrelabelVersion } from "../../components/dataset/PrelabelVersion";
import { Page } from "../../components/Page";
import { QualityWarnings } from "../../components/QualityWarnings";
import { ImageStateChip, imageStateLabel } from "../../components/ImageState";
import { UploadCard } from "../../components/UploadCard";
import { IMAGE_STATES, type ImageState } from "../../datasets/schema";
import { deleteImage } from "../../server/images";
import { getDatasetOverview } from "../../server/models";

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  loader: ({ params }) =>
    getDatasetOverview({ data: { dataset: params.dataset } }),
  component: DatasetPage,
});

type Filter = ImageState | "all";

function DatasetPage() {
  const { dataset } = Route.useParams();
  const overview = Route.useLoaderData();
  const { images, counts } = overview;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  // Worker presence and training leases are time-derived, so the console
  // refreshes on a fixed interval.
  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const visible =
    filter === "all"
      ? images
      : images.filter((image) => image.state === filter);
  const countOf = (state: Filter) =>
    state === "all" ? images.length : counts[state];

  return (
    <Page
      breadcrumbs={
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Datasets</Breadcrumbs.Item>
          <Breadcrumbs.Item>{dataset}</Breadcrumbs.Item>
        </Breadcrumbs>
      }
      title={dataset}
      titleClassName="truncate font-mono"
    >
      <DatasetOverview overview={overview} />
      <VersionsPanel overview={overview} />
      <UploadCard dataset={dataset} />

      <ToggleButtonGroup
        aria-label="Image state"
        size="sm"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([filter])}
        onSelectionChange={(keys) => setFilter([...keys][0] as Filter)}
      >
        {(["all", ...IMAGE_STATES] as const).map((state) => (
          <ToggleButton key={state} id={state}>
            {state === "all" ? "All" : imageStateLabel(state)}
            <span className="ml-1.5 font-mono tabular-nums text-muted">
              {countOf(state)}
            </span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={`Images in ${dataset}`}>
            <Table.Header>
              <Table.Column isRowHeader>Image</Table.Column>
              <Table.Column>State</Table.Column>
              <Table.Column className="text-right">Detected</Table.Column>
              <Table.Column className="text-right">Boxes</Table.Column>
              <Table.Column>Quality</Table.Column>
              <Table.Column>Model</Table.Column>
              <Table.Column>
                <span className="sr-only">Actions</span>
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">
                    {images.length === 0
                      ? "No images yet"
                      : "No images in this state"}
                  </span>
                  <span className="text-xs text-muted">
                    {images.length === 0
                      ? "Upload images above to start."
                      : "Choose another filter to see images."}
                  </span>
                </EmptyState>
              )}
            >
              {visible.map((image) => (
                <Table.Row
                  key={image.digest}
                  href={`/datasets/${dataset}/${image.digest}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    {image.filename}
                    {image.error && (
                      <span
                        className="mt-1 block max-w-72 truncate font-sans text-xs font-normal text-danger"
                        title={image.error}
                      >
                        {image.error}
                      </span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <ImageStateChip state={image.state} />
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count value={image.detectionCount} />
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <Count value={image.instanceCount} />
                  </Table.Cell>
                  <Table.Cell>
                    {image.quality && image.quality.status !== "ok" ? (
                      <QualityWarnings quality={image.quality} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <PrelabelVersion
                      dataset={overview.dataset}
                      versionId={image.modelVersionId}
                    />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <DeleteImageButton dataset={dataset} image={image} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

function DeleteImageButton({
  dataset,
  image,
}: {
  dataset: string;
  image: { digest: string; filename: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog>
      <Button variant="ghost" size="sm" isDisabled={busy}>
        Remove
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            {({ close }) => (
              <>
                <AlertDialog.Header>
                  <AlertDialog.Icon />
                  <AlertDialog.Heading>
                    Remove {image.filename}?
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  The image leaves {dataset} together with its detections and
                  annotation.
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button variant="tertiary" size="sm" onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => {
                      setBusy(true);
                      void deleteImage({
                        data: { dataset, digest: image.digest },
                      })
                        .then(async () => {
                          close();
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Image not removed", {
                            description:
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                          });
                        })
                        .finally(() => {
                          setBusy(false);
                        });
                    }}
                  >
                    Remove
                  </Button>
                </AlertDialog.Footer>
              </>
            )}
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
