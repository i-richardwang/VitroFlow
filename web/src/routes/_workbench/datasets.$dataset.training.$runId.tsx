import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Widget } from "@heroui-pro/react/widget";
import { Alert, Link } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import { Page, PageSection } from "../../ui/Page";
import { Timestamp } from "../../ui/Timestamp";
import { EpochCharts } from "../../features/training/EpochCharts";
import { ParametersList } from "../../features/training/ParametersList";
import { TrainingRunState } from "../../features/training/TrainingRunState";
import { getTrainingRun } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
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
        title: `${trainingRunLabel({ id: params.runId })} · ${m.training_title()} · ${m.app_name()}`,
      },
    ],
  }),
  component: TrainingRunPage,
});

function TrainingRunPage() {
  const { dataset, run, epochs, version } = Route.useLoaderData();
  const router = useRouter();
  const live = isTrainingRunActive(run);

  useRouteRefresh(router, 10_000, live);

  const current = epochs.filter((epoch) => epoch.attempt === run.attempt);
  const earlier = epochs.length - current.length;
  const best = bestEpoch(current);
  const total = run.recipe.parameters.epochs;

  return (
    <Page
      title={
        <span className="flex items-center gap-3">
          <span className="truncate font-mono">{trainingRunLabel(run)}</span>
          {run.state.status === "failed" ? null : (
            <TrainingRunState run={run} />
          )}
        </span>
      }
      description={<Timestamp value={run.createdAt} />}
    >
      {run.state.status === "failed" ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{m.training_failed_title()}</Alert.Title>
            <Alert.Description>{run.state.error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.training_kpi_epochs()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={current.length} />
          </KPI.Content>
          <KPI.Footer>
            {earlier > 0
              ? `${m.training_kpi_epochs_of_total({ total })} · ${m.training_kpi_epochs_earlier_hidden({ count: earlier })}`
              : m.training_kpi_epochs_of_total({ total })}
          </KPI.Footer>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.training_kpi_best_map()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            {best ? (
              <KPI.Value maximumFractionDigits={3} value={best.map50To95} />
            ) : (
              <span className="text-2xl font-semibold text-muted">—</span>
            )}
          </KPI.Content>
          {version && version.artifact.kind === "ultralytics" ? (
            <KPI.Footer>
              <Link href={`/datasets/${dataset}`} className="text-sm">
                {m.training_kpi_published({ version: version.id })}
              </Link>
            </KPI.Footer>
          ) : best ? (
            <KPI.Footer>
              {m.training_kpi_best_epoch({ epoch: best.epoch })}
            </KPI.Footer>
          ) : null}
        </KPI>
      </KPIGroup>

      <Widget>
        <Widget.Header>
          <Widget.Title>{m.training_curves()}</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          {current.length > 0 ? (
            <EpochCharts epochs={current} total={total} best={best} />
          ) : (
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>
                  {run.state.status === "failed"
                    ? m.training_no_epochs_finished()
                    : m.training_waiting_first_epoch()}
                </EmptyState.Title>
              </EmptyState.Header>
            </EmptyState>
          )}
        </Widget.Content>
      </Widget>

      <PageSection title={m.training_parameters()}>
        <ParametersList parameters={run.recipe.parameters} columns={2} />
      </PageSection>
    </Page>
  );
}
