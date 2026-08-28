import { Widget } from "@heroui-pro/react/widget";
import { Breadcrumbs, Card } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { ParametersList } from "../../components/training/ParametersList";
import { TrainDialog } from "../../components/training/TrainDialog";
import { TrainingRunsTable } from "../../components/training/TrainingRunsTable";
import { getTrainingConsole } from "../../server/models";
import { MIN_SNAPSHOT_IMAGES } from "../../training/schema";

export const Route = createFileRoute("/_workbench/datasets/$dataset/training/")(
  {
    loader: ({ params }) =>
      getTrainingConsole({ data: { dataset: params.dataset } }),
    component: TrainingPage,
  },
);

function TrainingPage() {
  const console = Route.useLoaderData();
  const { dataset, complete, recipe, training, runs } = console;
  const router = useRouter();

  // Leases and worker presence are time-derived, so the page refreshes on a
  // fixed interval while anything can change.
  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <Page
      breadcrumbs={
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Datasets</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/datasets/${dataset}`}>
            {dataset}
          </Breadcrumbs.Item>
          <Breadcrumbs.Item>Training</Breadcrumbs.Item>
        </Breadcrumbs>
      }
      title="Training"
      description={`Fine-tunes ${recipe.baseModel.reference} on the complete annotations in ${dataset}; each run publishes a candidate version.`}
    >
      <Card className="grid gap-6 p-6 sm:grid-cols-3">
        <Fact label="Ready to train">
          <span className="font-mono tabular-nums">
            {complete}
            <span className="text-muted"> complete annotations</span>
          </span>
          <span className="text-xs text-muted">
            {training.reviewedSinceLastRun} reviewed since the last run
          </span>
        </Fact>
        <Fact label="Workers">
          <span className="font-mono tabular-nums">
            {training.workersOnline}
            <span className="text-muted"> online</span>
          </span>
          <span className="text-xs text-muted">
            {training.active
              ? "A run is in progress"
              : "Queued runs start on the next claim"}
          </span>
        </Fact>
        <Fact label="Runtime">
          <span className="font-mono">
            {recipe.runtime.framework} {recipe.runtime.version}
          </span>
          <span className="text-xs text-muted">
            Base weights {recipe.baseModel.reference}
          </span>
        </Fact>
      </Card>

      <Widget>
        <Widget.Header className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Widget.Title>Runs</Widget.Title>
            <Widget.Description>
              {runs.length < training.runs
                ? `${runs.length} most recent. `
                : ""}
              Open a run to follow its loss and metric curves epoch by epoch.
            </Widget.Description>
          </div>
          <TrainDialog console={console} />
        </Widget.Header>
        <Widget.Content>
          <TrainingRunsTable
            runs={runs}
            emptyHint={
              complete < MIN_SNAPSHOT_IMAGES
                ? `Complete at least ${MIN_SNAPSHOT_IMAGES} annotations to train.`
                : "Train a YOLO version from the reviewed annotations."
            }
          />
        </Widget.Content>
      </Widget>

      <Widget>
        <Widget.Header>
          <Widget.Title>Recipe</Widget.Title>
          <Widget.Description>
            Defaults for a new run; epochs, image size, batch, patience, and
            learning rate can be changed when starting one.
          </Widget.Description>
        </Widget.Header>
        <Widget.Content>
          <ParametersList parameters={recipe.parameters} columns={2} />
        </Widget.Content>
      </Widget>
    </Page>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
