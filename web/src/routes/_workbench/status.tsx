import { EmptyState } from "@heroui-pro/react/empty-state";
import { Chip, Link, Table } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { Page } from "../../components/Page";
import { getStatus } from "../../functions/status";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { WorkerPresence } from "../../workers/presence";
import type { WorkerActivity } from "../../workers/schema";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  staticData: { crumbs: () => [{ label: "Status" }] },
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
  const { workers } = Route.useLoaderData();
  const router = useRouter();
  useRouteRefresh(router, 5000);

  return (
    <Page title="Status">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Workers">
            <Table.Header>
              <Table.Column isRowHeader>Worker</Table.Column>
              <Table.Column>Presence</Table.Column>
              <Table.Column>Activity</Table.Column>
              <Table.Column>Last seen</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>No workers yet</EmptyState.Title>
                  </EmptyState.Header>
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
                  <Table.Cell>
                    <Activity activity={worker.activity} />
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted tabular-nums">
                    {formatAge(worker.lastSeenSeconds)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </Page>
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) return <span className="text-muted">Idle</span>;
  if (activity.kind === "inference") return `Analyzing ${activity.image}`;
  return (
    <Link
      href={`/datasets/${activity.dataset}/training/${activity.runId}`}
      className="font-medium"
    >
      Training {activity.dataset}
    </Link>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
