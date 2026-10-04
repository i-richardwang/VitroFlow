import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";

import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { isAdmin } from "../../domain/auth/schema";
import type { WorkerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";
import { deleteWorker, getStatus } from "../../functions/status";
import { m } from "../../paraglide/messages";
import { Page } from "../../ui/Page";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { Status, type StatusTone } from "../../ui/kit/Status";
import { Text } from "../../ui/kit/Text";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  staticData: { crumbs: () => [{ label: m.status_title() }] },
  head: () => ({
    meta: [{ title: `${m.status_title()} · ${m.app_name()}` }],
  }),
  pendingComponent: StatusPending,
  component: StatusPage,
});

function StatusPending() {
  const { user } = Route.useRouteContext();
  return (
    <PageSkeleton>
      <PageHeaderSkeleton action={isAdmin(user)} />
      <TableSkeleton rows={3} />
    </PageSkeleton>
  );
}

const PRESENCE: Record<
  WorkerPresence,
  { label: () => string; tone: StatusTone }
> = {
  online: { label: m.worker_presence_online, tone: "success" },
  stale: { label: m.worker_presence_stale, tone: "warning" },
  offline: { label: m.worker_presence_offline, tone: "neutral" },
};

type WorkerStatus = Awaited<ReturnType<typeof getStatus>>["workers"][number];

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
          <Button type="primary" icon={Plus} onClick={() => setEnrolling(true)}>
            {m.worker_enroll()}
          </Button>
        ) : null
      }
    >
      <Table narrow="cards" aria-label={m.status_table_label()}>
        <TableHeader>
          <tr>
            <TableHead>{m.status_column_worker()}</TableHead>
            <TableHead className="w-32">{m.status_column_presence()}</TableHead>
            <TableHead>{m.status_column_activity()}</TableHead>
            <TableHead className="w-36">
              {m.status_column_last_seen()}
            </TableHead>
            {administers ? (
              <TableHead className="w-12">
                <span className="sr-only">{m.status_column_actions()}</span>
              </TableHead>
            ) : null}
          </tr>
        </TableHeader>
        <TableBody>
          {workers.length ? (
            workers.map((worker) => (
              <WorkerRow
                key={worker.workerId}
                worker={worker}
                administers={administers}
              />
            ))
          ) : (
            <TableEmpty>
              <Empty
                icon={Server}
                title={m.status_empty()}
                description={
                  administers
                    ? m.status_empty_description_admin()
                    : m.status_empty_description_member()
                }
                action={
                  administers ? (
                    <Button icon={Plus} onClick={() => setEnrolling(true)}>
                      {m.worker_enroll()}
                    </Button>
                  ) : null
                }
              />
            </TableEmpty>
          )}
        </TableBody>
      </Table>
      {administers ? (
        <EnrollWorkerDialog
          open={enrolling}
          onClose={() => setEnrolling(false)}
        />
      ) : null}
    </Page>
  );
}

function WorkerRow({
  worker,
  administers,
}: {
  worker: WorkerStatus;
  administers: boolean;
}) {
  const presence = PRESENCE[worker.presence];

  return (
    <TableRow>
      <TableCell cellSlot="title" className="font-mono">
        {worker.workerId}
      </TableCell>
      <TableCell cellLabel={m.status_column_presence()}>
        <Status tone={presence.tone}>{presence.label()}</Status>
      </TableCell>
      <TableCell cellLabel={m.status_column_activity()}>
        <Activity activity={worker.activity} />
      </TableCell>
      <TableCell cellLabel={m.status_column_last_seen()}>
        <Text as="span" type="secondary" className="tabular-nums">
          {worker.lastSeenSeconds === null
            ? m.worker_never_seen()
            : formatAge(worker.lastSeenSeconds)}
        </Text>
      </TableCell>
      {administers ? (
        <TableCell cellSlot="extra" className="text-end">
          <RemoveWorkerButton workerId={worker.workerId} />
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function RemoveWorkerButton({ workerId }: { workerId: string }) {
  const router = useRouter();

  return (
    <ActionIcon
      icon={Trash2}
      size="small"
      title={m.worker_remove()}
      onClick={() =>
        confirmDestructive({
          title: m.worker_remove_title({ name: workerId }),
          content: m.worker_remove_description(),
          confirmLabel: m.worker_remove(),
          onConfirm: async () => {
            await deleteWorker({ data: { workerId } });
            toast.success(m.worker_removed({ name: workerId }));
            await router.invalidate();
          },
        })
      }
    />
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) {
    return (
      <Text as="span" type="secondary">
        {m.worker_activity_idle()}
      </Text>
    );
  }
  if (activity.kind === "inference") {
    return m.worker_activity_inference({ image: activity.image });
  }
  return (
    <TextLink
      render={
        <Link
          to="/datasets/$dataset/training/$runId"
          params={{ dataset: activity.dataset, runId: activity.runId }}
        />
      }
    >
      {m.worker_activity_training({ dataset: activity.dataset })}
    </TextLink>
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
