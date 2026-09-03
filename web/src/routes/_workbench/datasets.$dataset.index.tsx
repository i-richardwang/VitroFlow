import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Segment } from "@heroui-pro/react/segment";
import { Button, Dropdown, Label, Link, Table } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Count } from "../../components/Count";
import { DestructiveActionDialog } from "../../components/DestructiveActionDialog";
import { QualityChips } from "../../components/DetectionQuality";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import { MoreIcon } from "../../components/icons";
import { imageStateLabel, ImageStateChip } from "../../components/ImageState";
import { archiveFilename } from "../../datasets/archive";
import { IMAGE_STATES, type ImageState } from "../../datasets/schema";
import {
  getDatasetOverview,
  removeFromDataset,
} from "../../functions/datasets";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  loader: async ({ params }) => {
    const overview = await getDatasetOverview({
      data: { dataset: params.dataset },
    });
    if (!overview) throw notFound();
    return overview;
  },
  staticData: {
    crumbs: ({ params }) => [
      { label: "Datasets", href: "/datasets" },
      { label: params.dataset, mono: true },
    ],
  },
  component: DatasetPage,
});

type Filter = ImageState | "all";

function isImageState(value: unknown): value is ImageState {
  return IMAGE_STATES.some((state) => state === value);
}

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { model, images, counts, training } = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  useRouteRefresh(router, 10_000);

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
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href={`/datasets/${encodeURIComponent(dataset)}/archive`}
            download={archiveFilename(dataset)}
          >
            Download
          </Link>
          <Button
            variant="primary"
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
      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>Reviewed</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={counts.complete} />
          </KPI.Content>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>Training runs</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={training.runs} />
          </KPI.Content>
          {training.reviewedSinceLastRun > 0 ? (
            <KPI.Footer>
              {training.reviewedSinceLastRun} reviewed since the last run
            </KPI.Footer>
          ) : null}
        </KPI>
      </KPIGroup>

      <Segment
        className="self-start"
        aria-label="Image state"
        selectedKey={filter}
        onSelectionChange={(key) => {
          if (key === "all" || isImageState(key)) {
            setFilter(key);
          }
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
              <Table.Column className="text-right">Boxes</Table.Column>
              <Table.Column>Quality</Table.Column>
              <Table.Column aria-label="Actions" />
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
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {visible.map((image) => (
                <Table.Row
                  key={image.digest}
                  href={`/review/${model.id}/${image.digest}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    <span className="truncate">{image.filename}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <ImageStateChip state={image.state} />
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    <BoxCount
                      detected={image.detectionCount}
                      boxes={image.instanceCount}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    {image.quality && image.quality.status !== "ok" ? (
                      <QualityChips quality={image.quality} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell
                    className="text-right"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ImageMenu dataset={dataset} image={image} />
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

function BoxCount({
  detected,
  boxes,
}: {
  detected: number | null;
  boxes: number | null;
}) {
  const count = <Count value={boxes ?? detected} />;
  if (boxes === null || detected === null || boxes === detected) {
    return count;
  }
  return (
    <Hint text={`Detected ${detected}`}>
      <span>{count}</span>
    </Hint>
  );
}

function ImageMenu({
  dataset,
  image,
}: {
  dataset: string;
  image: { digest: string; filename: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const label = `${image.filename} actions`;

  return (
    <>
      <Dropdown>
        <Hint text={label}>
          <Button variant="ghost" isIconOnly size="sm" aria-label={label}>
            <MoreIcon />
          </Button>
        </Hint>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu aria-label={label} onAction={() => setOpen(true)}>
            <Dropdown.Item id="remove" textValue="Remove" variant="danger">
              <Label>Remove…</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <DestructiveActionDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={`Remove ${image.filename}?`}
        confirmLabel="Remove image"
        onConfirm={async () => {
          await removeFromDataset({ data: { dataset, digest: image.digest } });
          await router.invalidate();
        }}
      >
        Review stays with the image.
      </DestructiveActionDialog>
    </>
  );
}
