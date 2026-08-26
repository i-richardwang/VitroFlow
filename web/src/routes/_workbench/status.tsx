import {
  Card,
  Chip,
  Description,
  EmptyState,
  Link,
  Table,
} from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { Page } from "../../components/Page";
import { getStatus } from "../../server/status";
import type { WorkerPresence } from "../../workers/schema";

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
  const { workers, server } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <Page
      title="Status"
      description="Workers report here while polling for jobs and after every processed image."
    >
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Workers">
            <Table.Header>
              <Table.Column isRowHeader>Worker</Table.Column>
              <Table.Column>Presence</Table.Column>
              <Table.Column>Current job</Table.Column>
              <Table.Column>Model</Table.Column>
              <Table.Column>Started</Table.Column>
              <Table.Column>Last seen</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex min-h-40 flex-col items-center justify-center gap-1 text-center">
                  <span className="font-medium">No workers have reported</span>
                  <span className="text-xs text-muted">
                    Start one with the workbench URL and worker token.
                  </span>
                  <code className="mt-3 rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs">
                    uv run vitroflow-worker
                  </code>
                </EmptyState>
              )}
            >
              {workers.map((worker) => (
                <Table.Row key={worker.workerId}>
                  <Table.Cell className="font-mono font-medium">
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
                  <Table.Cell className="font-mono">
                    {worker.currentRunId ? (
                      <Link href="/jobs" className="text-xs font-medium">
                        {worker.currentRunId}
                      </Link>
                    ) : (
                      <span className="text-muted">Idle</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted">
                    <span title={worker.execution.model.fingerprint}>
                      {worker.execution.model.name}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-muted">
                    {new Date(worker.startedAt).toLocaleString()}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-muted">
                    {new Date(worker.lastSeenAt).toLocaleString()}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Card>
        <Card.Header>
          <Card.Title>Server</Card.Title>
          <Card.Description>
            Deployment facts a worker needs to connect and the data it publishes
            into.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <Fact label="Data root">
              <code className="font-mono">{server.dataRoot}</code>
            </Fact>
            <Fact label="Password">
              <Configured value={server.passwordConfigured} />
            </Fact>
            <Fact label="Worker token">
              <Configured value={server.workerTokenConfigured} />
            </Fact>
            <Fact label="Images">{server.images}</Fact>
            <Fact label="Runs">{server.runs}</Fact>
            <Fact label="Labels">{server.labels}</Fact>
            <Fact label="Queued jobs">{server.queuedJobs}</Fact>
          </dl>
        </Card.Content>
      </Card>
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
