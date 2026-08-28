import { Widget } from "@heroui-pro/react/widget";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { StatKpi } from "../../components/StatKpi";
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
    <Page
      title="Training"
      description="Training activity across datasets; runs start from a dataset's training page."
    >
      <div className="grid grid-cols-3 gap-3">
        <StatKpi label="Runs" value={total} />
        <StatKpi label="In progress" value={inProgress} />
        <StatKpi label="Workers online" value={workersOnline} />
      </div>

      <Widget>
        <Widget.Header>
          <div className="flex flex-col gap-1">
            <Widget.Title>Runs</Widget.Title>
            <Widget.Description className="text-foreground/80">
              {runs.length < total
                ? `${runs.length} most recent, newest first.`
                : "Newest first."}{" "}
              Open a run to follow its loss and metric curves.
            </Widget.Description>
          </div>
        </Widget.Header>
        <Widget.Content>
          <TrainingRunsTable
            runs={runs}
            datasetColumn
            emptyHint="Open a dataset and train a version from its reviewed annotations."
          />
        </Widget.Content>
      </Widget>
    </Page>
  );
}
