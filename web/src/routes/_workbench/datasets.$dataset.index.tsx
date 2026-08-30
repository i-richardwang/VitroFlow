import { EmptyState } from "@heroui-pro/react/empty-state";
import { Segment } from "@heroui-pro/react/segment";
import { AlertDialog, Button, Table, toast } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Count } from "../../components/Count";
import { DatasetOverview } from "../../components/dataset/DatasetOverview";
import { UploadDialog } from "../../components/dataset/UploadDialog";
import { VersionsDialog } from "../../components/dataset/VersionsDialog";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import { QualityWarnings } from "../../components/QualityWarnings";
import { imageStateLabel, ImageStateChip } from "../../components/ImageState";
import { IMAGE_STATES, type ImageState } from "../../datasets/schema";
import { deleteImage } from "../../server/images";
import { getDatasetOverview } from "../../server/models";

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  loader: async ({ params }) => {
    const overview = await getDatasetOverview({
      data: { dataset: params.dataset },
    });
    if (!overview) throw notFound();
    return overview;
  },
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

  const filters = (["all", ...IMAGE_STATES] as const).filter(
    (state) => state === "all" || state === filter || countOf(state) > 0,
  );

  return (
    <Page
      title={<span className="block truncate font-mono">{dataset}</span>}
      actions={
        <>
          <UploadDialog dataset={dataset} />
          <VersionsDialog overview={overview} />
          <Button
            variant="ghost"
            onPress={() => {
              void router.navigate({
                to: "/datasets/$dataset/training",
                params: { dataset },
              });
            }}
          >
            Training
          </Button>
        </>
      }
    >
      <DatasetOverview overview={overview} />

      <Segment
        aria-label="Image state"
        selectedKey={filter}
        onSelectionChange={(key) => {
          if (key != null) setFilter(String(key) as Filter);
        }}
      >
        {filters.map((state) => (
          <Segment.Item key={state} id={state}>
            {state === "all" ? "All" : imageStateLabel(state)}
          </Segment.Item>
        ))}
      </Segment>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={`Images in ${dataset}`}>
            <Table.Header>
              <Table.Column isRowHeader>Image</Table.Column>
              <Table.Column>State</Table.Column>
              <Table.Column className="text-right">Detected</Table.Column>
              <Table.Column className="text-right">Boxes</Table.Column>
              <Table.Column>Quality</Table.Column>
              <Table.Column>
                <span className="sr-only">Actions</span>
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>
                      {images.length === 0
                        ? "No images yet"
                        : "No images in this state"}
                    </EmptyState.Title>
                    {images.length > 0 ? (
                      <EmptyState.Description>
                        Choose another filter to see images.
                      </EmptyState.Description>
                    ) : null}
                  </EmptyState.Header>
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
                    <span className="truncate">{image.filename}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Hint text={image.error}>
                      <ImageStateChip state={image.state} />
                    </Hint>
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
                    variant="danger-soft"
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
