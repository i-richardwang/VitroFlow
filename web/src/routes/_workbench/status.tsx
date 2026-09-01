import { EmptyState } from "@heroui-pro/react/empty-state";
import { Widget } from "@heroui-pro/react/widget";
import { Chip, Link, Table } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { Page } from "../../components/Page";
import { getStatus } from "../../functions/status";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { WorkerPresence } from "../../workers/presence";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  staticData: { crumbs: [{ label: "Status" }] },
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
  const { inferenceWorkers, trainingWorkers } = Route.useLoaderData();
  const router = useRouter();

  useRouteRefresh(router, 5000);

  return (
    <Page title="Status">
      <Widget>
        <Widget.Header>
          <Widget.Title>Analysis</Widget.Title>
        </Widget.Header>
        <Widget.Content className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Analysis workers">
                <Table.Header className="sr-only">
                  <Table.Column isRowHeader>Worker</Table.Column>
                  <Table.Column>Presence</Table.Column>
                  <Table.Column>Activity</Table.Column>
                  <Table.Column>Last seen</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState size="sm">
                      <EmptyState.Header>
                        <EmptyState.Title>
                          No analysis workers are online
                        </EmptyState.Title>
                        <EmptyState.Description>
                          Start one with the workbench URL and worker token.
                        </EmptyState.Description>
                      </EmptyState.Header>
                      <EmptyState.Content>
                        <code className="max-w-full overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs whitespace-nowrap">
                          vitroflow worker setup inference NAME --server URL
                        </code>
                      </EmptyState.Content>
                    </EmptyState>
                  )}
                >
                  {inferenceWorkers.map((worker, idx) => (
                    <Table.Row
                      key={worker.workerId}
                      className={
                        idx === inferenceWorkers.length - 1
                          ? "[&_td]:border-b-0"
                          : ""
                      }
                    >
                      <Table.Cell className="font-mono text-sm font-medium">
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
                      <Table.Cell>
                        {worker.image ? (
                          <span className="text-sm">
                            Analyzing {worker.image}
                          </span>
                        ) : (
                          <span className="text-sm text-muted">Idle</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span
                          className="font-mono text-sm text-muted tabular-nums"
                          title={new Date(worker.lastSeenAt).toLocaleString()}
                        >
                          {formatAge(worker.lastSeenSeconds)}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Widget.Content>
      </Widget>

      <Widget>
        <Widget.Header>
          <Widget.Title>Training</Widget.Title>
        </Widget.Header>
        <Widget.Content className="p-0">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Training workers">
                <Table.Header className="sr-only">
                  <Table.Column isRowHeader>Worker</Table.Column>
                  <Table.Column>Presence</Table.Column>
                  <Table.Column>Activity</Table.Column>
                  <Table.Column>Last seen</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState size="sm">
                      <EmptyState.Header>
                        <EmptyState.Title>
                          No training workers are online
                        </EmptyState.Title>
                        <EmptyState.Description>
                          Training can run on a separate GPU machine.
                        </EmptyState.Description>
                      </EmptyState.Header>
                      <EmptyState.Content>
                        <code className="max-w-full overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs whitespace-nowrap">
                          vitroflow worker setup training NAME --server URL
                          --device mps
                        </code>
                      </EmptyState.Content>
                    </EmptyState>
                  )}
                >
                  {trainingWorkers.map((worker, idx) => (
                    <Table.Row
                      key={worker.workerId}
                      className={
                        idx === trainingWorkers.length - 1
                          ? "[&_td]:border-b-0"
                          : ""
                      }
                    >
                      <Table.Cell>
                        <span className="font-mono text-sm font-medium">
                          {worker.workerId}
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
                      <Table.Cell>
                        {worker.dataset ? (
                          <Link
                            href={`/datasets/${worker.dataset}/training/${worker.currentTrainingRunId}`}
                            className="text-sm font-medium"
                          >
                            Training {worker.dataset}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted">Idle</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-mono text-sm text-muted tabular-nums">
                          {formatAge(worker.lastSeenSeconds)}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Widget.Content>
      </Widget>
    </Page>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
