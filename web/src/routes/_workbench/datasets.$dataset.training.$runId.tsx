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
import {
  Statistic,
  StatisticGroup,
  StatisticGroupSkeleton,
} from "../../ui/kit/Statistic";
import { TextLink } from "../../ui/kit/TextLink";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { bestEpoch } from "../../domain/training/metrics";
import {
  isTrainingRunActive,
  trainingRunLabel,
} from "../../domain/training/schema";

export const Route = createFileRoute(
  "/_workbench/datasets/$dataset/training/$runId",
)({
  loader: async ({ params }) => {
    const detail = await getTrainingRun({
      data: { dataset: params.dataset, runId: params.runId },
    });
    if (!detail) throw notFound();
    return detail;
  },
  staticData: {
    crumbs: ({ params }) => [
      { label: m.training_datasets_crumb(), href: "/datasets" },
      {
        label: params.dataset,
        href: `/datasets/${params.dataset}`,
      },
      {
        label: m.training_title(),
        href: `/datasets/${params.dataset}/training`,
      },
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
      <PageHeaderSkeleton meta />
      <StatisticGroupSkeleton count={2} />
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
      headline
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
      <StatisticGroup>
        <Statistic
          title={m.training_kpi_best_map()}
          value={<Metric value={best?.map50To95 ?? null} />}
          description={
            published
              ? m.training_kpi_published({ version: published.id })
              : best
                ? m.training_kpi_best_epoch({ epoch: best.epoch })
                : undefined
          }
        />
        <Statistic
          title={m.training_kpi_epochs()}
          value={m.run_epochs_progress({
            completed: current.length,
            total,
          })}
          description={
            <div className="flex flex-col gap-1">
              <Progress
                aria-label={m.training_kpi_epochs()}
                size="small"
                value={current.length}
                max={total}
              />
              {earlier > 0
                ? m.training_kpi_epochs_earlier_hidden({ count: earlier })
                : null}
            </div>
          }
        />
      </StatisticGroup>

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
