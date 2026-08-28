import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { Widget } from "@heroui-pro/react/widget";
import { Link } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { EpochCharts } from "../../components/training/EpochCharts";
import { ParametersList } from "../../components/training/ParametersList";
import { TrainingRunState } from "../../components/training/TrainingRunState";
import { versionSlug } from "../../models/schema";
import { getTrainingRun } from "../../server/models";
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
  component: TrainingRunPage,
});

function TrainingRunPage() {
  const { dataset, run, epochs, version } = Route.useLoaderData();
  const router = useRouter();
  const live = isTrainingRunActive(run);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void router.invalidate(), 10_000);
    return () => window.clearInterval(timer);
  }, [router, live]);

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
      description={
        <>
          Created <Timestamp value={run.createdAt} />
          {"workerId" in run.state ? ` · ${run.state.workerId}` : null}
        </>
      }
    >
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
              <KPI.Value
                maximumFractionDigits={3}
                value={best.map5095}
              />
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
                <EmptyState.Description>
                  {run.state.status === "failed"
                    ? "The run failed before finishing an epoch."
                    : "Curves appear once validation reports."}
                </EmptyState.Description>
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
