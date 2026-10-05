import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";

import { Metric } from "../../ui/Metric";
import { Page, PageColumnSkeleton } from "../../ui/Page";
import { Timestamp } from "../../ui/Timestamp";
import {
  EpochCharts,
  EpochChartsSkeleton,
} from "../../features/training/EpochCharts";
import {
  ParametersList,
  ParametersListSkeleton,
} from "../../features/training/ParametersList";
import { TrainingRunState } from "../../features/training/TrainingRunState";
import { getTrainingRun } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Alert } from "../../ui/kit/Alert";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { Panel } from "../../ui/kit/Panel";
import { Progress } from "../../ui/kit/Progress";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
import { TextLink } from "../../ui/kit/TextLink";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import type { TrainingRunDetail } from "../../domain/training/read-model";
import { datasetCrumbs } from "../../features/models/crumbs";
import { bestEpoch } from "../../domain/training/metrics";
import {
  isTrainingRunActive,
  trainingRunLabel,
} from "../../domain/training/schema";

export const Route = createFileRoute(
  "/_workbench/datasets/$dataset/runs/$runId",
)({
  loader: async ({ params }) => {
    const detail = await getTrainingRun({
      data: { dataset: params.dataset, runId: params.runId },
    });
    if (!detail) throw notFound();
    return detail;
  },
  staticData: {
    crumbs: ({ params, loaderData }) => [
      ...datasetCrumbs((loaderData as TrainingRunDetail).model, params.dataset),
      { label: trainingRunLabel({ id: params.runId }) },
    ],
  },
  head: ({ params }) => ({
    meta: [
      {
        title: documentTitle(
          m.training_run_page_title({
            run: trainingRunLabel({ id: params.runId }),
            dataset: params.dataset,
          }),
        ),
      },
    ],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton variant="subject" meta />
      <StatisticHeroSkeleton />
      <Panel title={m.training_curves()}>
        <EpochChartsSkeleton />
      </Panel>
      <Panel title={m.training_parameters()}>
        <ParametersListSkeleton />
      </Panel>
    </PageColumnSkeleton>
  ),
  component: TrainingRunPage,
});

function TrainingRunPage() {
  const { run, epochs, version } = Route.useLoaderData();
  const { dataset } = Route.useParams();
  const live = isTrainingRunActive(run);

  useRouteRefresh(10_000, live);

  const current = epochs.filter((epoch) => epoch.attempt === run.attempt);
  const earlier = epochs.length - current.length;
  const best = bestEpoch(current);
  const total = run.recipe.parameters.epochs;
  const published =
    version && version.artifact.kind === "ultralytics" ? version : null;

  return (
    <Page
      title={trainingRunLabel(run)}
      subject
      status={<TrainingRunState run={run} />}
      meta={[
        <TextLink
          key="dataset"
          render={<Link to="/datasets/$dataset" params={{ dataset }} />}
        >
          {dataset}
        </TextLink>,
        <span key="base-model" className="text-xs">
          {run.recipe.baseModel.reference}
        </span>,
        <Timestamp key="created" value={run.createdAt} />,
      ]}
    >
      <StatisticHero
        title={m.training_kpi_best_map()}
        value={<Metric value={best?.map50To95 ?? null} />}
        description={
          published
            ? m.training_kpi_published({ version: published.id })
            : best
              ? m.training_kpi_best_epoch({ epoch: best.epoch })
              : undefined
        }
        aside={
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-xs text-fg-tertiary">
              <span>{m.training_kpi_epochs()}</span>
              <span className="text-fg-secondary tabular-nums">
                {m.run_epochs_progress({ completed: current.length, total })}
              </span>
            </div>
            <Progress
              aria-label={m.training_kpi_epochs()}
              size="small"
              value={current.length}
              max={total}
            />
            {earlier > 0 ? (
              <span className="text-xs text-fg-tertiary">
                {m.training_kpi_epochs_earlier_hidden({ count: earlier })}
              </span>
            ) : null}
          </div>
        }
      />

      <Panel title={m.training_curves()}>
        {run.state.status === "failed" ? (
          <Alert
            type="error"
            title={m.training_failed_title()}
            description={
              current.length === 0 ? m.training_no_epochs_finished() : undefined
            }
            detail={run.state.error}
          />
        ) : null}
        {current.length > 0 ? (
          <EpochCharts epochs={current} total={total} best={best} />
        ) : run.state.status === "failed" ? null : (
          <div className="flex min-h-72 flex-col justify-center">
            <Empty icon={ChartLine} title={m.training_waiting_first_epoch()} />
          </div>
        )}
      </Panel>

      <Panel title={m.training_parameters()}>
        <ParametersList parameters={run.recipe.parameters} />
      </Panel>
    </Page>
  );
}
