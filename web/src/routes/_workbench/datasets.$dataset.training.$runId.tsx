import { Widget } from "@heroui-pro/react/widget";
import { Breadcrumbs, Card, Link } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { EpochCharts } from "../../components/training/EpochCharts";
import { Metric } from "../../components/training/Metric";
import { ParametersList } from "../../components/training/ParametersList";
import { TrainingRunState } from "../../components/training/TrainingRunState";
import { validationMetric, versionSlug } from "../../models/schema";
import { getTrainingRun } from "../../server/models";
import { bestEpoch } from "../../training/metrics";
import { isTrainingRunActive, trainingRunLabel } from "../../training/schema";

export const Route = createFileRoute(
  "/_workbench/datasets/$dataset/training/$runId",
)({
  loader: ({ params }) =>
    getTrainingRun({ data: { dataset: params.dataset, runId: params.runId } }),
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
  const stoppedEarly =
    (run.state.status === "succeeded" || run.state.status === "publishing") &&
    current.length < total;

  return (
    <Page
      breadcrumbs={
        <Breadcrumbs>
          <Breadcrumbs.Item href="/">Datasets</Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/datasets/${dataset}`}>
            {dataset}
          </Breadcrumbs.Item>
          <Breadcrumbs.Item href={`/datasets/${dataset}/training`}>
            Training
          </Breadcrumbs.Item>
          <Breadcrumbs.Item>{trainingRunLabel(run)}</Breadcrumbs.Item>
        </Breadcrumbs>
      }
      title={`Run ${trainingRunLabel(run)}`}
      titleClassName="font-mono"
      description={
        <>
          Created <Timestamp value={run.createdAt} /> · attempt {run.attempt}
          {"workerId" in run.state && ` · ${run.state.workerId}`}
        </>
      }
    >
      <Card className="grid gap-6 p-6 sm:grid-cols-3">
        <Fact label="State">
          <TrainingRunState run={run} />
        </Fact>
        <Fact label="Epochs">
          <span className="font-mono tabular-nums">
            {current.length}
            <span className="text-muted"> / {total}</span>
          </span>
          <span className="text-xs text-muted">
            {stoppedEarly
              ? `Stopped early after ${run.recipe.parameters.patience} epochs without improvement`
              : best
                ? `Best fitness at epoch ${best.epoch}`
                : "No epoch finished yet"}
          </span>
        </Fact>
        <Fact label="Best epoch">
          <span className="font-mono tabular-nums">
            <Metric value={best?.map5095 ?? null} />
            <span className="text-muted"> mAP50-95</span>
          </span>
          <span className="font-mono text-xs tabular-nums text-muted">
            <Metric value={best?.map50 ?? null} /> mAP50 ·{" "}
            <Metric value={best?.precision ?? null} /> P ·{" "}
            <Metric value={best?.recall ?? null} /> R
          </span>
        </Fact>
      </Card>

      <Widget>
        <Widget.Header>
          <Widget.Title>Curves</Widget.Title>
          <Widget.Description>
            {earlier > 0
              ? `${earlier} epochs from earlier attempts are not shown; this attempt trains from scratch.`
              : "Ultralytics reports these after each epoch's validation pass; the dashed line marks the best epoch."}
          </Widget.Description>
        </Widget.Header>
        <Widget.Content>
          {current.length > 0 ? (
            <EpochCharts epochs={current} total={total} best={best} />
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              {run.state.status === "failed"
                ? "The run failed before finishing an epoch."
                : "Curves appear once the first epoch finishes."}
            </p>
          )}
        </Widget.Content>
      </Widget>

      {version && version.artifact.kind === "ultralytics" && (
        <Widget>
          <Widget.Header className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Widget.Title>Published version</Widget.Title>
              <Widget.Description>
                Validated with the one-to-many head on the snapshot's validation
                split; select it on the dataset page to prelabel with it.
              </Widget.Description>
            </div>
            <Link
              href={`/datasets/${dataset}`}
              className="shrink-0 text-sm font-medium"
            >
              {versionSlug(version)}
            </Link>
          </Widget.Header>
          <Widget.Content>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr_max-content_1fr]">
              <Term label="mAP50">
                <Metric value={validationMetric(version.artifact, "mAP50")} />
              </Term>
              <Term label="mAP50-95">
                <Metric
                  value={validationMetric(version.artifact, "mAP50-95")}
                />
              </Term>
              <Term label="Precision">
                <Metric
                  value={validationMetric(version.artifact, "precision")}
                />
              </Term>
              <Term label="Recall">
                <Metric value={validationMetric(version.artifact, "recall")} />
              </Term>
              <Term label="Confidence">
                <Metric value={version.artifact.inference.confidence} />
              </Term>
              <Term label="Weights">
                {(version.artifact.bytes / 1_000_000).toFixed(1)} MB
              </Term>
            </dl>
          </Widget.Content>
        </Widget>
      )}

      <Widget>
        <Widget.Header>
          <Widget.Title>Parameters</Widget.Title>
          <Widget.Description>
            {run.recipe.baseModel.reference} · {run.recipe.runtime.framework}{" "}
            {run.recipe.runtime.version}
          </Widget.Description>
        </Widget.Header>
        <Widget.Content>
          <ParametersList parameters={run.recipe.parameters} columns={2} />
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

function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono tabular-nums">{children}</dd>
    </>
  );
}
