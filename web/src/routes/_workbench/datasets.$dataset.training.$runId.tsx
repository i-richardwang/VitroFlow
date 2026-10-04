import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";

import { Metric } from "../../ui/Metric";
import { Page, PageSection, PageSectionSkeleton } from "../../ui/Page";
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
import { Empty } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  StatGridSkeleton,
} from "../../ui/kit/PageSkeleton";
import { StatCard, StatGrid } from "../../ui/kit/StatCard";
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
        mono: true,
      },
      {
        label: m.training_title(),
        href: `/datasets/${params.dataset}/training`,
      },
      { label: trainingRunLabel({ id: params.runId }), mono: true },
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
    <PageSkeleton>
      <PageHeaderSkeleton description action />
      <StatGridSkeleton count={2} />
      <PageSectionSkeleton>
        <EpochChartsSkeleton />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <Card>
          <ParametersListSkeleton />
        </Card>
      </PageSectionSkeleton>
    </PageSkeleton>
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
      title={<span className="font-mono">{trainingRunLabel(run)}</span>}
      description={<Timestamp value={run.createdAt} />}
      action={
        run.state.status === "failed" ? null : <TrainingRunState run={run} />
      }
    >
      {run.state.status === "failed" ? (
        <Alert
          type="error"
          title={m.training_failed_title()}
          description={run.state.error}
        />
      ) : null}

      <StatGrid>
        <StatCard
          label={m.training_kpi_epochs()}
          value={m.run_epochs_progress({
            completed: current.length,
            total,
          })}
          hint={
            earlier > 0
              ? m.training_kpi_epochs_earlier_hidden({ count: earlier })
              : undefined
          }
        />
        <StatCard
          label={m.training_kpi_best_map()}
          value={<Metric value={best?.map50To95 ?? null} />}
          hint={
            published ? (
              <TextLink
                render={<Link to="/datasets/$dataset" params={{ dataset }} />}
              >
                {m.training_kpi_published({ version: published.id })}
              </TextLink>
            ) : best ? (
              m.training_kpi_best_epoch({ epoch: best.epoch })
            ) : undefined
          }
        />
      </StatGrid>

      <PageSection title={m.training_curves()}>
        {current.length > 0 ? (
          <EpochCharts epochs={current} total={total} best={best} />
        ) : (
          <Card className="min-h-72 justify-center">
            <Empty
              icon={ChartLine}
              title={
                run.state.status === "failed"
                  ? m.training_no_epochs_finished()
                  : m.training_waiting_first_epoch()
              }
            />
          </Card>
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
