import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine, Download, ImagePlus } from "lucide-react";

import { QualityTags } from "../../ui/DetectionQuality";
import { Absent } from "../../ui/Absent";
import { Page } from "../../ui/Page";
import { archiveFilename } from "../../domain/datasets/archive-format";
import { RemoveImageButton } from "../../features/datasets/RemoveImageButton";
import { formatCount } from "../../ui/numbers";
import { getDatasetOverview } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  StatGridSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import { StatCard, StatGrid } from "../../ui/kit/StatCard";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { documentTitle } from "../../ui/documentTitle";
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
    meta: [{ title: documentTitle(params.dataset) }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton action />
      <StatGridSkeleton count={2} />
      <TableSkeleton />
    </PageSkeleton>
  ),
  component: DatasetPage,
});

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { images, reviewedCount, training } = Route.useLoaderData();

  useRouteRefresh(10_000);

  return (
    <Page
      title={<span className="block truncate font-mono">{dataset}</span>}
      action={
        <>
          <Button
            icon={Download}
            render={
              <a
                href={`/datasets/${encodeURIComponent(dataset)}/archive`}
                download={archiveFilename(dataset)}
              />
            }
          >
            {m.dataset_download()}
          </Button>
          <Button
            type="primary"
            icon={ChartLine}
            render={
              <Link to="/datasets/$dataset/training" params={{ dataset }} />
            }
          >
            {m.dataset_training()}
          </Button>
        </>
      }
    >
      <StatGrid>
        <StatCard
          label={m.dataset_kpi_reviewed()}
          value={formatCount(reviewedCount)}
          hint={m.dataset_kpi_reviewed_of({ count: images.length })}
        />
        <StatCard
          label={m.dataset_kpi_training_runs()}
          value={formatCount(training.runs)}
          hint={
            training.reviewedSinceLastRun > 0
              ? m.dataset_reviewed_since_last_run({
                  count: training.reviewedSinceLastRun,
                })
              : undefined
          }
        />
      </StatGrid>
      <Table aria-label={m.dataset_images_table({ dataset })} narrow="cards">
        <TableHeader>
          <tr>
            <TableHead>{m.dataset_column_image()}</TableHead>
            <TableHead className="w-24" numeric>
              {m.dataset_column_boxes()}
            </TableHead>
            <TableHead className="w-64">{m.dataset_column_quality()}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.dataset_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {images.length ? (
            images.map((image) => (
              <TableRow key={image.digest} clickable>
                <TableCell cellSlot="title">
                  <TextLink
                    className="block max-w-80 truncate font-mono"
                    render={
                      <Link
                        to="/datasets/$dataset/$digest"
                        params={{ dataset, digest: image.digest }}
                      />
                    }
                  >
                    {image.filename}
                  </TextLink>
                </TableCell>
                <TableCell cellLabel={m.dataset_column_boxes()} numeric>
                  <BoxCount
                    detected={image.detectionCount}
                    proposed={image.proposalCount}
                    boxes={image.instanceCount}
                  />
                </TableCell>
                <TableCell cellLabel={m.dataset_column_quality()}>
                  {image.quality && image.quality.status !== "ok" ? (
                    <QualityTags quality={image.quality} />
                  ) : (
                    <Absent />
                  )}
                </TableCell>
                <TableCell cellSlot="extra" className="text-end">
                  <RemoveImageButton dataset={dataset} image={image} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmpty>
              <Empty
                icon={ImagePlus}
                title={m.dataset_empty_images()}
                description={m.dataset_empty_images_description()}
                action={
                  <Button render={<Link to="/experiments" />}>
                    {m.dataset_open_experiments()}
                  </Button>
                }
              />
            </TableEmpty>
          )}
        </TableBody>
      </Table>
    </Page>
  );
}

/** A reviewer's count reads plain; an unreviewed proposal or detection reads tertiary. */
function BoxCount({
  detected,
  proposed,
  boxes,
}: {
  detected: number | null;
  proposed: number | null;
  boxes: number | null;
}) {
  if (boxes !== null) return <>{formatCount(boxes)}</>;
  const unreviewed = proposed ?? detected;
  return unreviewed === null ? (
    <Absent />
  ) : (
    <span className="text-fg-tertiary">{formatCount(unreviewed)}</span>
  );
}
