import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Button, Link, Table } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import { Count } from "../../components/Count";
import { QualityChips } from "../../components/DetectionQuality";
import { Hint } from "../../components/Hint";
import { Page } from "../../components/Page";
import { archiveFilename } from "../../datasets/archive";
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

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { images, reviewedCount, training } = Route.useLoaderData();
  const router = useRouter();

  useRouteRefresh(router, 10_000);

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
            <KPI.Value maximumFractionDigits={0} value={reviewedCount} />
          </KPI.Content>
          <KPI.Footer>
            {m.dataset_kpi_reviewed_of({ count: images.length })}
          </KPI.Footer>
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

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.dataset_images_table({ dataset })}>
            <Table.Header>
              <Table.Column isRowHeader>
                {m.dataset_column_image()}
              </Table.Column>
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
                      {m.dataset_empty_images()}
                    </EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              )}
            >
              {images.map((image) => (
                <Table.Row
                  key={image.digest}
                  href={`/datasets/${encodeURIComponent(dataset)}/${image.digest}`}
                  className="cursor-(--cursor-interactive)"
                >
                  <Table.Cell className="font-mono font-medium">
                    <span className="truncate">{image.filename}</span>
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

/**
 * Reviewed boxes read as a plain number; a detection nobody has reviewed yet
 * reads muted, so the column itself shows which images still need a review.
 */
function BoxCount({
  detected,
  boxes,
}: {
  detected: number | null;
  boxes: number | null;
}) {
  if (boxes === null) {
    if (detected === null) return <Count value={null} />;
    return (
      <Hint text={m.dataset_boxes_unreviewed()}>
        <span className="text-muted">{detected}</span>
      </Hint>
    );
  }
  if (detected === null || detected === boxes) return <>{boxes}</>;
  return (
    <Hint text={m.dataset_detected_count({ count: detected })}>
      <span>{boxes}</span>
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
