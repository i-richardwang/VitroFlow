import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Segment } from "@heroui-pro/react/segment";
import { Button, Link, Table } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Count } from "../../components/Count";
import { QualityChips } from "../../components/DetectionQuality";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import {
  reviewStateLabel,
  ReviewStateChip,
} from "../../components/ReviewState";
import { archiveFilename } from "../../datasets/archive";
import { REVIEW_STATES, type ReviewState } from "../../annotation/schema";
import {
  getDatasetOverview,
  removeFromDataset,
} from "../../functions/datasets";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import { m } from "../../paraglide/messages";

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
      { label: m.datasets_title(), href: "/datasets" },
      { label: params.dataset, mono: true },
    ],
  },
  head: ({ params }) => ({
    meta: [{ title: `${params.dataset} · ${m.app_name()}` }],
  }),
  component: DatasetPage,
});

type Filter = ReviewState | "all";

function isReviewState(value: unknown): value is ReviewState {
  return REVIEW_STATES.some((state) => state === value);
}

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { images, counts, training } = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  useRouteRefresh(router, 10_000);

  const visible =
    filter === "all"
      ? images
      : images.filter((image) => image.state === filter);
  const countOf = (state: Filter) =>
    state === "all" ? images.length : counts[state];
  const filters = (["all", ...REVIEW_STATES] as const).filter(
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
            {m.dataset_download()}
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
            {m.dataset_training()}
          </Button>
        </>
      }
    >
      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.dataset_kpi_reviewed()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={counts.reviewed} />
          </KPI.Content>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.dataset_kpi_training_runs()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={training.runs} />
          </KPI.Content>
          {training.reviewedSinceLastRun > 0 ? (
            <KPI.Footer>
              {m.dataset_reviewed_since_last_run({
                count: training.reviewedSinceLastRun,
              })}
            </KPI.Footer>
          ) : null}
        </KPI>
      </KPIGroup>

      <Segment
        className="self-start"
        aria-label={m.dataset_filter_label()}
        selectedKey={filter}
        onSelectionChange={(key) => {
          if (key === "all" || isReviewState(key)) {
            setFilter(key);
          }
        }}
      >
        {filters.map((state) => (
          <Segment.Item key={state} id={state}>
            {state === "all" ? m.dataset_filter_all() : reviewStateLabel(state)}
          </Segment.Item>
        ))}
      </Segment>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.dataset_images_table({ dataset })}>
            <Table.Header>
              <Table.Column isRowHeader>
                {m.dataset_column_image()}
              </Table.Column>
              <Table.Column>{m.dataset_column_state()}</Table.Column>
              <Table.Column className="text-right">
                {m.dataset_column_boxes()}
              </Table.Column>
              <Table.Column>{m.dataset_column_quality()}</Table.Column>
              <Table.Column aria-label={m.dataset_column_actions()} />
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>
                      {images.length === 0
                        ? m.dataset_empty_images()
                        : m.dataset_empty_filtered()}
                    </EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {visible.map((image) => (
                <Table.Row
                  key={image.digest}
                  href={`/datasets/${encodeURIComponent(dataset)}/${image.digest}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    <span className="truncate">{image.filename}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <ReviewStateChip state={image.state} />
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
    <Hint text={m.dataset_detected_count({ count: detected })}>
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
  const action = useAsyncAction();

  return (
    <Button
      variant="ghost"
      size="sm"
      isDisabled={action.busy}
      aria-label={m.dataset_remove_image({ file: image.filename })}
      onPress={async () => {
        const result = await action.run(
          () => removeFromDataset({ data: { dataset, digest: image.digest } }),
          m.dataset_image_not_removed(),
        );
        if (result.ok) await router.invalidate();
      }}
    >
      {m.dataset_remove()}
    </Button>
  );
}
