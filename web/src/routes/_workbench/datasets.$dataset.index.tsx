import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine, ImagePlus } from "lucide-react";

import { QualityTags } from "../../ui/DetectionQuality";
import { Absent } from "../../ui/Absent";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";
import { modelName } from "../../ui/model-names";
import { DatasetMenu } from "../../features/datasets/DatasetMenu";
import { RemoveImageButton } from "../../features/datasets/RemoveImageButton";
import { formatCount } from "../../ui/numbers";
import { getDatasetOverview } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { Progress } from "../../ui/kit/Progress";
import {
  Statistic,
  StatisticGroup,
  StatisticGroupSkeleton,
} from "../../ui/kit/Statistic";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Tag } from "../../ui/kit/Tag";
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
      { label: params.dataset },
    ],
  },
  head: ({ params }) => ({
    meta: [{ title: documentTitle(params.dataset) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton variant="subject" description />
      <StatisticGroupSkeleton count={2} />
      <PageSectionSkeleton>
        <TableSkeleton />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: DatasetPage,
});

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { model, images, reviewedCount, training } = Route.useLoaderData();

  useRouteRefresh(10_000);

  return (
    <Page
      title={dataset}
      subject
      description={modelName(model)}
      action={
        <>
          <Button
            type="primary"
            icon={ChartLine}
            render={
              <Link to="/datasets/$dataset/training" params={{ dataset }} />
            }
          >
            {m.dataset_training()}
          </Button>
          <DatasetMenu dataset={dataset} />
        </>
      }
    >
      <StatisticGroup>
        <Statistic
          title={m.dataset_kpi_reviewed()}
          value={m.dataset_kpi_reviewed_value({
            reviewed: reviewedCount,
            total: images.length,
          })}
          description={
            <Progress
              aria-label={m.dataset_kpi_reviewed()}
              size="small"
              value={reviewedCount}
              max={Math.max(images.length, 1)}
            />
          }
        />
        <Statistic
          title={m.dataset_kpi_training_runs()}
          value={formatCount(training.runs)}
          description={
            training.reviewedSinceLastRun > 0
              ? m.dataset_reviewed_since_last_run({
                  count: training.reviewedSinceLastRun,
                })
              : undefined
          }
        />
      </StatisticGroup>
      <PageSection
        title={m.dataset_images_section()}
        extra={
          images.length > 0 ? (
            <Tag size="small">{formatCount(images.length)}</Tag>
          ) : null
        }
      >
        <Table
          aria-label={m.dataset_images_table({ dataset })}
          size="small"
          narrow="cards"
          empty={
            images.length === 0 && (
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
            )
          }
        >
          <TableHeader>
            <tr>
              <TableHead>{m.dataset_column_image()}</TableHead>
              <TableHead className="w-1/3">
                {m.dataset_column_quality()}
              </TableHead>
              <TableHead className="w-24" numeric>
                {m.dataset_column_boxes()}
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{m.dataset_column_actions()}</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {images.map((image) => (
              <TableRow key={image.digest} clickable>
                <TableCell cellSlot="title">
                  <TextLink
                    className="block max-w-80 truncate"
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
                <TableCell cellLabel={m.dataset_column_quality()}>
                  {image.quality && image.quality.status !== "ok" ? (
                    <QualityTags quality={image.quality} />
                  ) : (
                    <Absent />
                  )}
                </TableCell>
                <TableCell cellLabel={m.dataset_column_boxes()} numeric>
                  <BoxCount
                    detected={image.detectionCount}
                    proposed={image.proposalCount}
                    boxes={image.instanceCount}
                  />
                </TableCell>
                <TableCell cellSlot="actions" className="text-end">
                  <RemoveImageButton dataset={dataset} image={image} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PageSection>
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
