import { createFileRoute, notFound } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";

import { Metric } from "../../ui/Metric";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";
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
import { Card } from "../../ui/kit/Card";
import { Empty, EmptyPlace } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { ProgressMeter } from "../../ui/kit/Progress";
import { StatisticHero, StatisticHeroSkeleton } from "../../ui/kit/Statistic";
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
      <PageHeaderSkeleton icon meta />
      <StatisticHeroSkeleton />
      <PageSectionSkeleton>
        <Card>
          <EpochChartsSkeleton />
        </Card>
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <Card>
          <ParametersListSkeleton />
        </Card>
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: TrainingRunPage,
});

function TrainingRunPage() {
  const { run, epochs, version } = Route.useLoaderData();
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
      icon={ChartLine}
      status={<TrainingRunState run={run} />}
      meta={[
        run.recipe.baseModel.reference,
        <Timestamp key="created" value={run.createdAt} />,
      ]}
    >
      <StatisticHero
        title={m.training_kpi_best_map()}
        value={<Metric value={best?.map50To95 ?? null} />}
        facts={
          published
            ? [m.training_kpi_published({ version: published.id })]
            : best
              ? [m.training_kpi_best_epoch({ epoch: best.epoch })]
              : undefined
        }
        aside={
          <ProgressMeter
            label={m.training_kpi_epochs()}
            count={m.run_epochs_progress({ completed: current.length, total })}
            value={current.length}
            max={total}
            note={
              earlier > 0
                ? m.training_kpi_epochs_earlier_hidden({ count: earlier })
                : undefined
            }
          />
        }
      />

      <PageSection title={m.training_curves()}>
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
          <Card>
            <EpochCharts epochs={current} total={total} best={best} />
          </Card>
        ) : run.state.status === "failed" ? null : (
          <EmptyPlace variant="outlined">
            <Empty icon={ChartLine} title={m.training_waiting_first_epoch()} />
          </EmptyPlace>
        )}
      </PageSection>

      <PageSection title={m.training_parameters()}>
        <Card>
          <ParametersList parameters={run.recipe.parameters} />
        </Card>
      </PageSection>
    </Page>
  );
}
