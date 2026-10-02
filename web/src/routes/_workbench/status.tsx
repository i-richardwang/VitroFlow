import { EmptyState } from "@heroui-pro/react/empty-state";
import { Button, Chip, Link, Table, toast } from "@heroui/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Page } from "../../ui/Page";
import { deleteWorker, getStatus } from "../../functions/status";
import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { isAdmin } from "../../domain/auth/schema";
import { DestructiveActionButton } from "../../ui/DestructiveActionDialog";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { m } from "../../paraglide/messages";
import type { WorkerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";

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
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const administers = isAdmin(user);
  useRouteRefresh(router, 5000);

  return (
    <Page
      title={m.status_title()}
      actions={
        administers ? (
          <Button variant="primary" onPress={() => setEnrolling(true)}>
            {m.worker_enroll()}
          </Button>
        ) : null
      }
    >
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
              {administers ? (
                <Table.Column aria-label={m.status_column_actions()} />
              ) : null}
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
                    {worker.lastSeenSeconds === null
                      ? m.worker_never_seen()
                      : formatAge(worker.lastSeenSeconds)}
                  </Table.Cell>
                  {administers ? (
                    <Table.Cell className="text-right">
                      <RemoveWorkerButton workerId={worker.workerId} />
                    </Table.Cell>
                  ) : null}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {administers ? (
        <EnrollWorkerDialog
          isOpen={enrolling}
          onClose={() => setEnrolling(false)}
        />
      ) : null}
    </Page>
  );
}

function RemoveWorkerButton({ workerId }: { workerId: string }) {
  const router = useRouter();

  return (
    <DestructiveActionButton
      label={m.worker_remove()}
      title={m.worker_remove_title({ name: workerId })}
      confirmLabel={m.worker_remove()}
      onConfirm={async () => {
        await deleteWorker({ data: { workerId } });
        toast.success(m.worker_removed({ name: workerId }));
        await router.invalidate();
      }}
    >
      {m.worker_remove_description()}
    </DestructiveActionButton>
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) {
    return <span className="text-muted">{m.worker_activity_idle()}</span>;
  }
  if (activity.kind === "annotation")
    return m.worker_activity_annotation({ image: activity.image });
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
