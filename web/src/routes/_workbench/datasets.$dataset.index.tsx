import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ImagePlus, Images, PenLine, Search, SearchX } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { QualityTags } from "../../ui/DetectionQuality";
import { Absent } from "../../ui/Absent";
import { Page, PageColumnSkeleton, PageSection } from "../../ui/Page";
import { modelName } from "../../ui/model-names";
import { DatasetMenu } from "../../features/datasets/DatasetMenu";
import { RemoveImageButton } from "../../features/datasets/RemoveImageButton";
import {
  DATASET_IMAGE_STATE_TONE,
  DATASET_IMAGE_STATES,
  datasetImageState,
  datasetImageStateLabel,
  type DatasetImageState,
} from "../../features/datasets/labels";
import { formatCount } from "../../ui/numbers";
import { getDatasetOverview } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import { Pagination } from "../../ui/kit/Pagination";
import { PreviewField, PreviewMedia } from "../../ui/kit/PreviewLayout";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { Status } from "../../ui/kit/Status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { modelCrumbs } from "../../features/models/crumbs";
import { TrainButton } from "../../features/training/TrainButton";
import { TrainDialog, trainRefusal } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";

type DatasetOverview = NonNullable<
  Awaited<ReturnType<typeof getDatasetOverview>>
>;

type DatasetOverviewImage = DatasetOverview["images"][number];

/** `image` names the image previewed beside the list. */
const datasetSearchSchema = z.object({
  image: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/datasets/$dataset/")({
  validateSearch: datasetSearchSchema,
  loader: async ({ params }) => {
    const overview = await getDatasetOverview({
      data: { dataset: params.dataset },
    });
    if (!overview) throw notFound();
    return overview;
  },
  staticData: {
    crumbs: ({ params, loaderData }) => [
      ...modelCrumbs((loaderData as DatasetOverview).model),
      { label: params.dataset },
    ],
  },
  head: ({ params }) => ({
    meta: [{ title: documentTitle(params.dataset) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton variant="subject" description />
      <StatisticHeroSkeleton />
      <TableSkeleton />
    </PageColumnSkeleton>
  ),
  component: DatasetPage,
});

const PAGE_SIZE = 20;

type Filter = DatasetImageState | "all";

function DatasetPage() {
  const { dataset } = Route.useParams();
  const { image: previewed } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { model, images, reviewedCount, training, recipe, runs } =
    Route.useLoaderData();
  const [starting, setStarting] = useState(false);
  const refusal = trainRefusal({ reviewed: reviewedCount, training });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  useRouteRefresh(10_000);

  const states = new Map(
    images.map((image) => [image.digest, datasetImageState(image)]),
  );
  const needle = query.trim().toLowerCase();
  const matches = images.filter(
    (image) =>
      (filter === "all" || states.get(image.digest) === filter) &&
      image.filename.toLowerCase().includes(needle),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const preview = images.find((image) => image.digest === previewed);
  const closePreview = () =>
    void navigate({
      search: (previous) => ({ ...previous, image: undefined }),
    });

  return (
    <Page
      title={dataset}
      subject
      icon={Images}
      description={modelName(model)}
      action={
        <>
          <TrainButton refusal={refusal} onClick={() => setStarting(true)} />
          <DatasetMenu dataset={dataset} />
        </>
      }
      preview={
        preview
          ? {
              title: preview.filename,
              content: (
                <ImagePreview
                  dataset={dataset}
                  image={preview}
                  state={states.get(preview.digest) ?? "unread"}
                />
              ),
              onClose: closePreview,
            }
          : null
      }
    >
      <StatisticHero
        value={formatCount(reviewedCount)}
        title={m.dataset_hero_reviewed()}
        description={[
          m.dataset_hero_images({ count: images.length }),
          ...(training.reviewedSinceLastRun > 0
            ? [
                m.dataset_reviewed_since_last_run({
                  count: training.reviewedSinceLastRun,
                }),
              ]
            : []),
        ].join(" · ")}
      />
      <Table
        aria-label={m.dataset_images_table({ dataset })}
        size="small"
        narrow="cards"
        toolbar={
          images.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={m.dataset_search()}
                className="w-48"
                placeholder={m.dataset_search()}
                prefix={<Icon icon={Search} size={14} />}
                size="small"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
              <ToggleGroup
                aria-label={m.dataset_state_filter()}
                variant="outlined"
                value={filter}
                options={[
                  { value: "all", label: m.dataset_state_all() },
                  ...DATASET_IMAGE_STATES.map((state) => ({
                    value: state,
                    label: datasetImageStateLabel(state),
                  })),
                ]}
                onChange={(next) => {
                  setFilter(next);
                  setPage(1);
                }}
              />
            </div>
          ) : undefined
        }
        footer={
          matches.length > PAGE_SIZE ? (
            <Pagination
              current={current}
              pageSize={PAGE_SIZE}
              total={matches.length}
              onChange={setPage}
            />
          ) : undefined
        }
        empty={
          images.length === 0 ? (
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
          ) : matches.length === 0 ? (
            <Empty
              icon={SearchX}
              title={m.dataset_no_matches()}
              description={m.dataset_no_matches_description()}
            />
          ) : undefined
        }
      >
        <TableHeader>
          <tr>
            <TableHead>{m.dataset_column_image()}</TableHead>
            <TableHead className="w-28">{m.dataset_column_state()}</TableHead>
            <TableHead className="w-1/4">
              {m.dataset_column_quality()}
            </TableHead>
            <TableHead className="w-20" numeric>
              {m.dataset_column_boxes()}
            </TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{m.dataset_column_actions()}</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {shown.map((image) => {
            const state = states.get(image.digest) ?? "unread";
            return (
              <TableRow
                key={image.digest}
                clickable
                data-state={image.digest === previewed ? "selected" : undefined}
              >
                <TableCell cellSlot="title">
                  <TextLink
                    className="block max-w-80 truncate"
                    render={
                      <Link
                        to="/datasets/$dataset"
                        params={{ dataset }}
                        search={{ image: image.digest }}
                      />
                    }
                  >
                    {image.filename}
                  </TextLink>
                </TableCell>
                <TableCell cellLabel={m.dataset_column_state()}>
                  <Status tone={DATASET_IMAGE_STATE_TONE[state]}>
                    {datasetImageStateLabel(state)}
                  </Status>
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
            );
          })}
        </TableBody>
      </Table>
      {runs.length > 0 ? (
        <PageSection title={m.run_table_label()}>
          <TrainingRunsTable runs={runs} />
        </PageSection>
      ) : null}
      <TrainDialog
        set={{ dataset, reviewed: reviewedCount, recipe, training }}
        open={starting}
        onClose={() => setStarting(false)}
      />
    </Page>
  );
}

/** One image beside the list: the photograph, where it stands, and the way into its annotation. */
function ImagePreview({
  dataset,
  image,
  state,
}: {
  dataset: string;
  image: DatasetOverviewImage;
  state: DatasetImageState;
}) {
  return (
    <>
      <PreviewMedia src={`/img/${image.digest}`} alt={image.filename} />
      <PreviewField label={m.dataset_column_state()}>
        <Status tone={DATASET_IMAGE_STATE_TONE[state]}>
          {datasetImageStateLabel(state)}
        </Status>
      </PreviewField>
      <PreviewField label={m.dataset_preview_boxes()}>
        <BoxCount
          detected={image.detectionCount}
          proposed={image.proposalCount}
          boxes={image.instanceCount}
        />
      </PreviewField>
      {image.quality && image.quality.status !== "ok" ? (
        <PreviewField label={m.dataset_preview_quality()}>
          <QualityTags quality={image.quality} />
        </PreviewField>
      ) : null}
      <Button
        block
        type="primary"
        icon={PenLine}
        render={
          <Link
            to="/datasets/$dataset/$digest"
            params={{ dataset, digest: image.digest }}
          />
        }
      >
        {m.dataset_preview_open()}
      </Button>
    </>
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
