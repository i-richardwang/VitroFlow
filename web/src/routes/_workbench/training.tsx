import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { VersionsTable } from "../../components/dataset/VersionsTable";
import { Page } from "../../components/Page";
import { TrainingRunsTable } from "../../components/training/TrainingRunsTable";
import { getTrainingOverview } from "../../functions/training";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";

export const Route = createFileRoute("/_workbench/training")({
  loader: () => getTrainingOverview(),
  staticData: { crumbs: [{ label: "Training" }] },
  component: TrainingPage,
});

function TrainingPage() {
  const { versions, total, runs, inProgress, workersOnline } =
    Route.useLoaderData();
  const router = useRouter();

  useRouteRefresh(router, 10_000);

  return (
    <Page title="Training">
      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>Runs</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={total} />
          </KPI.Content>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>In progress</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={inProgress} />
          </KPI.Content>
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>Workers</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={workersOnline} />
          </KPI.Content>
        </KPI>
      </KPIGroup>

      <VersionsTable versions={versions} />

      <TrainingRunsTable runs={runs} datasetColumn />
    </Page>
  );
}
