import { EmptyState } from "@heroui-pro/react/empty-state";
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

type WorkerRow = {
  key: string;
  workerId: string;
  kind: "Analysis" | "Training";
  presence: WorkerPresence;
  lastSeenSeconds: number;
  activity: string | null;
  href?: string;
};

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

  const rows: WorkerRow[] = [
    ...inferenceWorkers.map((worker) => ({
      key: `analysis:${worker.workerId}`,
      workerId: worker.workerId,
      kind: "Analysis" as const,
      presence: worker.presence,
      lastSeenSeconds: worker.lastSeenSeconds,
      activity: worker.image ? `Analyzing ${worker.image}` : null,
    })),
    ...trainingWorkers.map((worker) => ({
      key: `training:${worker.workerId}`,
      workerId: worker.workerId,
      kind: "Training" as const,
      presence: worker.presence,
      lastSeenSeconds: worker.lastSeenSeconds,
      activity: worker.dataset ? `Training ${worker.dataset}` : null,
      href:
        worker.dataset && worker.currentTrainingRunId
          ? `/datasets/${worker.dataset}/training/${worker.currentTrainingRunId}`
          : undefined,
    })),
  ];

  return (
    <Page title="Status">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Workers">
            <Table.Header>
              <Table.Column isRowHeader>Worker</Table.Column>
              <Table.Column>Kind</Table.Column>
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
              {rows.map((row) => (
                <Table.Row key={row.key}>
                  <Table.Cell className="font-mono font-medium">
                    {row.workerId}
                  </Table.Cell>
                  <Table.Cell className="text-muted">{row.kind}</Table.Cell>
                  <Table.Cell>
                    <Chip
                      color={PRESENCE[row.presence].color}
                      variant="soft"
                      size="sm"
                    >
                      {PRESENCE[row.presence].label}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <Activity activity={row.activity} href={row.href} />
                  </Table.Cell>
                  <Table.Cell className="font-mono text-muted tabular-nums">
                    {formatAge(row.lastSeenSeconds)}
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

function Activity({
  activity,
  href,
}: {
  activity: string | null;
  href?: string;
}) {
  if (activity && href) {
    return (
      <Link href={href} className="font-medium">
        {activity}
      </Link>
    );
  }
  if (activity) return activity;
  return <span className="text-muted">Idle</span>;
}

function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
