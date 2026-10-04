import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useState } from "react";

import { EnrollWorkerDialog } from "../../features/workers/EnrollWorkerDialog";
import { isAdmin } from "../../domain/auth/schema";
import type { WorkerPresence } from "../../domain/workers/presence";
import type { WorkerActivity } from "../../domain/workers/schema";
import { deleteWorker, getStatus } from "../../functions/status";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { RowMenu } from "../../ui/ActionsMenu";
import { SettingsPage, SettingsPageSkeleton } from "../../ui/Page";
import { confirmDestructive } from "../../ui/confirmDestructive";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { ActionIcon } from "../../ui/kit/ActionIcon";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { Item, ItemList, ItemListSkeleton } from "../../ui/kit/ItemList";
import { StatusDot, type StatusTone } from "../../ui/kit/Status";
import { TextLink } from "../../ui/kit/TextLink";
import { toast } from "../../ui/kit/Toast";

export const Route = createFileRoute("/_workbench/status")({
  loader: () => getStatus(),
  staticData: { crumbs: () => [{ label: m.status_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.status_title()) }],
  }),
  pendingComponent: () => (
    <SettingsPageSkeleton>
      <ItemListSkeleton rows={3} />
    </SettingsPageSkeleton>
  ),
  component: StatusPage,
});

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
  const [enrolling, setEnrolling] = useState(false);
  const administers = isAdmin(user);
  const enroll = () => setEnrolling(true);
  useRouteRefresh(5000);

  return (
    <SettingsPage
      title={m.status_title()}
      extra={
        <>
          <RefreshButton />
          {workers.length > 0 ? (
            <>
              {m.status_worker_count({ count: workers.length })}
              {administers ? (
                <Button type="primary" icon={Plus} onClick={enroll}>
                  {m.worker_enroll()}
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      <ItemList
        aria-label={m.status_workers()}
        empty={
          workers.length === 0 && (
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
                  <Button type="primary" icon={Plus} onClick={enroll}>
                    {m.worker_enroll()}
                  </Button>
                ) : null
              }
            />
          )
        }
      >
        {workers.map((worker) => (
          <WorkerItem
            key={worker.workerId}
            worker={worker}
            administers={administers}
          />
        ))}
      </ItemList>
      {administers ? (
        <EnrollWorkerDialog
          open={enrolling}
          onClose={() => setEnrolling(false)}
        />
      ) : null}
    </SettingsPage>
  );
}

/** Reloads the roster now rather than at the next periodic refresh. */
function RefreshButton() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ActionIcon
      icon={RefreshCw}
      size="small"
      title={m.status_refresh()}
      loading={refreshing}
      onClick={() => {
        setRefreshing(true);
        void router.invalidate().finally(() => setRefreshing(false));
      }}
    />
  );
}

function WorkerItem({
  worker,
  administers,
}: {
  worker: WorkerStatus;
  administers: boolean;
}) {
  const presence = PRESENCE[worker.presence];

  return (
    <Item
      title={worker.workerId}
      addon={<StatusDot label={presence.label()} tone={presence.tone} />}
      meta={[
        <Activity key="activity" activity={worker.activity} />,
        worker.lastSeenSeconds === null
          ? m.worker_never_seen()
          : formatAge(worker.lastSeenSeconds),
      ]}
      actions={
        administers ? <WorkerMenu workerId={worker.workerId} /> : undefined
      }
    />
  );
}

function WorkerMenu({ workerId }: { workerId: string }) {
  const router = useRouter();

  return (
    <RowMenu
      label={m.worker_actions({ name: workerId })}
      items={[
        {
          key: "remove",
          icon: Trash2,
          label: m.worker_remove_item(),
          danger: true,
          onClick: () =>
            confirmDestructive({
              title: m.worker_remove_title({ name: workerId }),
              content: m.worker_remove_description(),
              confirmLabel: m.worker_remove(),
              onConfirm: async () => {
                await deleteWorker({ data: { workerId } });
                toast.success(m.worker_removed({ name: workerId }));
                await router.invalidate();
              },
            }),
        },
      ]}
    />
  );
}

function Activity({ activity }: { activity: WorkerActivity | null }) {
  if (!activity) return m.worker_activity_idle();
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
