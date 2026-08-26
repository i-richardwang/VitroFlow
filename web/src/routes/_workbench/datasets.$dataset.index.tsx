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
import { Page } from "../../components/Page";
import { QualityWarnings } from "../../components/QualityWarnings";
import { ImageStateChip, imageStateLabel } from "../../components/ImageState";
import { UploadCard } from "../../components/UploadCard";
import { IMAGE_STATES, type ImageState } from "../../datasets/schema";
import { deleteImage, getDataset } from "../../server/images";

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  loader: ({ params }) => getDataset({ data: { dataset: params.dataset } }),
  component: DatasetPage,
});

type Filter = ImageState | "all";

function DatasetPage() {
  const { dataset } = Route.useParams();
  const images = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const awaitingWorker = images.some((image) => image.state === "pending");
  useEffect(() => {
    if (!awaitingWorker) {
      return;
    }
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [awaitingWorker, router]);

  const visible =
    filter === "all"
      ? images
      : images.filter((image) => image.state === filter);
  const countOf = (state: Filter) =>
    state === "all"
      ? images.length
      : images.filter((image) => image.state === state).length;

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
                  key={image.stem}
                  href={`/datasets/${dataset}/${image.stem}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    {image.stem}
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
                  <Table.Cell className="text-right">
                    <DeleteImageButton dataset={dataset} stem={image.stem} />
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
  stem,
}: {
  dataset: string;
  stem: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog>
      <Button variant="ghost" size="sm" isDisabled={busy}>
        Delete
      </Button>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            {({ close }) => (
              <>
                <AlertDialog.Header>
                  <AlertDialog.Icon />
                  <AlertDialog.Heading>Delete {stem}?</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  The photograph, its detections, and its annotation are removed
                  from {dataset}.
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
                      void deleteImage({ data: { dataset, stem } })
                        .then(async () => {
                          close();
                          await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                          toast.danger("Image not deleted", {
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
                    Delete
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
