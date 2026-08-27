import { KPI } from "@heroui-pro/react/kpi";
import { Widget } from "@heroui-pro/react/widget";
import { Chip, EmptyState, Link, Table } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { Timestamp } from "../../components/Timestamp";
import { getStatus } from "../../server/status";
import type { WorkerPresence } from "../../workers/presence";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  component: StatusPage,
});

const PRESENCE: Record<
  WorkerPresence,
  { label: string; color: "success" | "warning" | "default" }
> = {
  online: { label: "Online", color: "success" },
  stale: { label: "Stale", color: "warning" },
  offline: { label: "Offline", color: "default" },
};

function StatusPage() {
  const { inferenceWorkers, trainingWorkers, server } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <Page
      title="Status"
      description="Inference and training workers report independently from their own compute environments."
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatKpi label="Datasets" value={server.datasets} />
        <StatKpi label="Images" value={server.images} />
        <StatKpi label="Prelabels" value={server.prelabels} />
        <StatKpi label="Labels" value={server.labels} />
        <StatKpi label="Training runs" value={server.trainingRuns} />
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Inference Workers">
            <Table.Header>
              <Table.Column isRowHeader>Worker</Table.Column>
              <Table.Column>Presence</Table.Column>
              <Table.Column className="whitespace-nowrap">
                Processing
              </Table.Column>
              <Table.Column>Model</Table.Column>
              <Table.Column className="whitespace-nowrap text-right">
                Last seen
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">
                    No inference workers have reported
                  </span>
                  <span className="text-xs text-muted">
                    Start one with the workbench URL and worker token.
                  </span>
                  <code className="mt-3 rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs">
                    uv run vitroflow-inference-worker
                  </code>
                </EmptyState>
              )}
            >
              {inferenceWorkers.map((worker) => (
                <Table.Row key={worker.workerId}>
                  <Table.Cell className="break-all font-mono font-medium">
                    {worker.workerId}
                    <span className="mt-1 block font-sans text-xs font-normal text-muted">
                      Started <Timestamp value={worker.startedAt} />
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip
                      color={PRESENCE[worker.presence].color}
                      variant="soft"
                      size="sm"
                    >
                      {PRESENCE[worker.presence].label}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono">
                    {worker.current ? (
                      <Link
                        href={`/datasets/${worker.current.dataset}/${worker.current.stem}`}
                        className="text-xs font-medium"
                      >
                        {worker.current.dataset}/{worker.current.stem}
                      </Link>
                    ) : (
                      <span className="text-muted">Idle</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono text-muted">
                    <span title={worker.runtime.fingerprint}>
                      {worker.target ? (
                        <Link
                          href={`/datasets/${worker.target.dataset}`}
                          className="text-xs font-medium"
                        >
                          {worker.deployment.modelVersionId}
                        </Link>
                      ) : (
                        worker.deployment.modelVersionId
                      )}
                      {" / "}
                      {worker.runtime.adapter}
                    </span>
                    {worker.target && !worker.target.selected && (
                      <Chip
                        color="warning"
                        variant="soft"
                        size="sm"
                        className="ml-2"
                      >
                        Not selected
                      </Chip>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right font-mono tabular-nums text-muted">
                    <span title={new Date(worker.lastSeenAt).toLocaleString()}>
                      {formatAge(worker.lastSeenSeconds)}
                    </span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Training Workers">
            <Table.Header>
              <Table.Column isRowHeader>Training Worker</Table.Column>
              <Table.Column>Presence</Table.Column>
              <Table.Column>Device</Table.Column>
              <Table.Column>Training run</Table.Column>
              <Table.Column className="whitespace-nowrap text-right">
                Last seen
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">
                    No training workers have reported
                  </span>
                  <span className="text-xs text-muted">
                    Training workers can run on a separate GPU machine.
                  </span>
                  <code className="mt-3 rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs">
                    uv run --group yolo vitroflow-training-worker
                  </code>
                </EmptyState>
              )}
            >
              {trainingWorkers.map((worker) => (
                <Table.Row key={worker.workerId}>
                  <Table.Cell className="break-all font-mono font-medium">
                    {worker.workerId}
                  </Table.Cell>
                  <Table.Cell>
                    <Chip
                      color={PRESENCE[worker.presence].color}
                      variant="soft"
                      size="sm"
                    >
                      {PRESENCE[worker.presence].label}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted">
                    {worker.device}
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted">
                    {worker.currentTrainingRunId && worker.dataset ? (
                      <Link
                        href={`/datasets/${worker.dataset}`}
                        className="text-xs font-medium"
                      >
                        {worker.dataset}
                      </Link>
                    ) : (
                      (worker.currentTrainingRunId ?? "Idle")
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right font-mono tabular-nums text-muted">
                    {formatAge(worker.lastSeenSeconds)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Widget>
        <Widget.Header>
          <Widget.Title>Server</Widget.Title>
          <Widget.Description>
            Deployment facts a worker needs to connect and the data it publishes
            into.
          </Widget.Description>
        </Widget.Header>
        <Widget.Content>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <Fact label="Data root">
              <code className="font-mono">{server.dataRoot}</code>
            </Fact>
            <Fact label="Password">
              <Configured value={server.passwordConfigured} />
            </Fact>
            <Fact label="Inference token">
              <Configured value={server.inferenceWorkerTokenConfigured} />
            </Fact>
            <Fact label="Training token">
              <Configured value={server.trainingWorkerTokenConfigured} />
            </Fact>
          </dl>
        </Widget.Content>
      </Widget>
    </Page>
  );
}

function StatKpi({ label, value }: { label: string; value: number }) {
  return (
    <KPI>
      <KPI.Header>
        <KPI.Title>{label}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        <KPI.Value maximumFractionDigits={0} value={value} />
      </KPI.Content>
    </KPI>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Fact({
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

function Configured({ value }: { value: boolean }) {
  return (
    <Chip color={value ? "success" : "warning"} variant="soft" size="sm">
      {value ? "Configured" : "Not set"}
    </Chip>
  );
}
