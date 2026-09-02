import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Widget } from "@heroui-pro/react/widget";
import { Alert, Link } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { EpochCharts } from "../../components/training/EpochCharts";
import { ParametersList } from "../../components/training/ParametersList";
import { TrainingRunState } from "../../components/training/TrainingRunState";
import { versionSlug } from "../../models/schema";
import { getTrainingRun } from "../../functions/training";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import { bestEpoch } from "../../training/metrics";
import { isTrainingRunActive, trainingRunLabel } from "../../training/schema";

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
      { label: "Datasets", href: "/datasets" },
      {
        label: params.dataset,
        href: `/datasets/${params.dataset}`,
        mono: true,
      },
      {
        label: "Training",
        href: `/datasets/${params.dataset}/training`,
      },
      { label: trainingRunLabel({ id: params.runId }), mono: true },
    ],
  },
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
          <TrainingRunState run={run} />
        </span>
      }
      description={<Timestamp value={run.createdAt} />}
    >
      {run.state.status === "failed" ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Training failed</Alert.Title>
            <Alert.Description>{run.state.error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>Epochs</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={current.length} />
          </KPI.Content>
          <KPI.Footer>
            of {total}
            {earlier > 0 ? ` · ${earlier} from earlier attempts hidden` : ""}
          </KPI.Footer>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>Best mAP50-95</KPI.Title>
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
                Published {versionSlug(version)}
              </Link>
            </KPI.Footer>
          ) : best ? (
            <KPI.Footer>Epoch {best.epoch}</KPI.Footer>
          ) : null}
        </KPI>
      </KPIGroup>

      <Widget>
        <Widget.Header>
          <Widget.Title>Curves</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          {current.length > 0 ? (
            <EpochCharts epochs={current} total={total} best={best} />
          ) : (
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>
                  {run.state.status === "failed"
                    ? "No epochs finished"
                    : "Waiting for the first epoch"}
                </EmptyState.Title>
              </EmptyState.Header>
            </EmptyState>
          )}
        </Widget.Content>
      </Widget>

      <Widget>
        <Widget.Header>
          <Widget.Title>Parameters</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          <ParametersList parameters={run.recipe.parameters} columns={2} />
        </Widget.Content>
      </Widget>
    </Page>
  );
}
