import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { TrainingRunsTable } from "../../components/training/TrainingRunsTable";
import { getTrainingOverview } from "../../server/models";

export const Route = createFileRoute("/_workbench/training")({
  loader: () => getTrainingOverview(),
  component: TrainingPage,
});

function TrainingPage() {
  const { total, runs, inProgress, workersOnline } = Route.useLoaderData();
  const router = useRouter();

  // Run states and worker presence change on their own clocks.
  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

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

      <TrainingRunsTable
        runs={runs}
        datasetColumn
        emptyHint="Open a dataset and train a version from its reviewed annotations."
      />
    </Page>
  );
}
