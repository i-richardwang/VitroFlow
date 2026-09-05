import { EmptyState } from "@heroui-pro/react/empty-state";
import { Chip, Link, Table } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { Page } from "../../components/Page";
import { getStatus } from "../../functions/status";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import { m } from "../../paraglide/messages";
import type { WorkerPresence } from "../../workers/presence";
import type { WorkerActivity } from "../../workers/schema";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  staticData: { crumbs: () => [{ label: m.status_title() }] },
  head: () => ({
    meta: [{ title: `${m.status_title()} · ${m.app_name()}` }],
  }),
  component: StatusPage,
});

const PRESENCE: Record<
  WorkerPresence,
  { label: () => string; color: "success" | "warning" | "default" }
> = {
  online: { label: m.worker_presence_online, color: "success" },
  stale: { label: m.worker_presence_stale, color: "warning" },
  offline: { label: m.worker_presence_offline, color: "default" },
};

function StatusPage() {
  const { workers } = Route.useLoaderData();
  const router = useRouter();
  useRouteRefresh(router, 5000);

  return (
    <Page title={m.status_title()}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={m.status_table_label()}>
            <Table.Header>
              <Table.Column isRowHeader>
                {m.status_column_worker()}
              </Table.Column>
              <Table.Column>{m.status_column_presence()}</Table.Column>
              <Table.Column>{m.status_column_activity()}</Table.Column>
              <Table.Column>{m.status_column_last_seen()}</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>{m.status_empty()}</EmptyState.Title>
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
                      {PRESENCE[worker.presence].label()}
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
  if (!activity) {
    return <span className="text-muted">{m.worker_activity_idle()}</span>;
  }
  if (activity.kind === "inference") {
    return m.worker_activity_inference({ image: activity.image });
  }
  return (
    <Link
      href={`/datasets/${activity.dataset}/training/${activity.runId}`}
      className="font-medium"
    >
      {m.worker_activity_training({ dataset: activity.dataset })}
    </Link>
  );
}

function formatAge(seconds: number) {
  if (seconds < 60) return m.worker_age_seconds({ count: seconds });
  if (seconds < 3600) {
    return m.worker_age_minutes({ count: Math.floor(seconds / 60) });
  }
  if (seconds < 86400) {
    return m.worker_age_hours({ count: Math.floor(seconds / 3600) });
  }
  return m.worker_age_days({ count: Math.floor(seconds / 86400) });
}
