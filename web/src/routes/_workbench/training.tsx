import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { VersionsTable } from "../../features/datasets/VersionsTable";
import { formatQuantity } from "../../ui/quantity";
import { Page, PageSection, PageSectionSkeleton } from "../../ui/Page";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getTrainingOverview } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  StatGridSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import { StatCard, StatGrid } from "../../ui/kit/StatCard";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/training")({
  loader: () => getTrainingOverview(),
  staticData: { crumbs: () => [{ label: m.training_title() }] },
  head: () => ({
    meta: [{ title: `${m.training_title()} · ${m.app_name()}` }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton />
      <StatGridSkeleton count={3} />
      <PageSectionSkeleton>
        <TableSkeleton rows={3} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={3} />
      </PageSectionSkeleton>
    </PageSkeleton>
  ),
  component: TrainingPage,
});

function TrainingPage() {
  const { versions, total, runs, inProgress, workersOnline } =
    Route.useLoaderData();
  const router = useRouter();

  useRouteRefresh(router, 10_000);

  return (
    <Page title={m.training_title()}>
      <StatGrid>
        <StatCard label={m.training_kpi_runs()} value={formatQuantity(total)} />
        <StatCard
          label={m.training_kpi_in_progress()}
          value={formatQuantity(inProgress)}
        />
        <StatCard
          label={m.training_kpi_workers()}
          value={formatQuantity(workersOnline)}
        />
      </StatGrid>

      <PageSection title={m.versions_table()}>
        <VersionsTable versions={versions} />
      </PageSection>

      <PageSection title={m.run_table_label()}>
        <TrainingRunsTable
          runs={runs}
          datasetColumn
          emptyAction={
            <Button render={<Link to="/datasets" />}>
              {m.run_empty_open_datasets()}
            </Button>
          }
        />
      </PageSection>
    </Page>
  );
}
