import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { TrainDialog } from "../../components/training/TrainDialog";
import { TrainingRunsTable } from "../../components/training/TrainingRunsTable";
import { getTrainingConsole } from "../../server/models";

export const Route = createFileRoute("/_workbench/datasets/$dataset/training/")(
  {
    loader: async ({ params }) => {
      const console = await getTrainingConsole({
        data: { dataset: params.dataset },
      });
      if (!console) throw notFound();
      return console;
    },
    component: TrainingPage,
  },
);

function TrainingPage() {
  const console = Route.useLoaderData();
  const { complete, training, runs } = console;
  const router = useRouter();

  // Leases and worker presence are time-derived, so the page refreshes on a
  // fixed interval while anything can change.
  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <Page title="Training" actions={<TrainDialog console={console} />}>
      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>Ready</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={complete} />
          </KPI.Content>
          {training.reviewedSinceLastRun > 0 ? (
            <KPI.Footer>
              {training.reviewedSinceLastRun} new since last run
            </KPI.Footer>
          ) : null}
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>Workers</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value
              maximumFractionDigits={0}
              value={training.workersOnline}
            />
          </KPI.Content>
        </KPI>
      </KPIGroup>

      <TrainingRunsTable runs={runs} />
    </Page>
  );
}
