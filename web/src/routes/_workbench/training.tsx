import { createFileRoute, Link } from "@tanstack/react-router";

import { VersionsTable } from "../../features/datasets/VersionsTable";
import { formatCount } from "../../ui/numbers";
import {
  Page,
  PageColumnSkeleton,
  PageSection,
  PageSectionSkeleton,
} from "../../ui/Page";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getTrainingOverview } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { PageHeaderSkeleton, TableSkeleton } from "../../ui/kit/PageSkeleton";
import {
  Statistic,
  StatisticGroup,
  StatisticGroupSkeleton,
} from "../../ui/kit/Statistic";
import { Tag } from "../../ui/kit/Tag";
import { Button } from "../../ui/kit/Button";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/training")({
  loader: () => getTrainingOverview(),
  staticData: { crumbs: () => [{ label: m.training_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.training_title()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <StatisticGroupSkeleton count={3} />
      <PageSectionSkeleton>
        <TableSkeleton rows={3} />
      </PageSectionSkeleton>
      <PageSectionSkeleton>
        <TableSkeleton rows={3} />
      </PageSectionSkeleton>
    </PageColumnSkeleton>
  ),
  component: TrainingPage,
});

function TrainingPage() {
  const { versions, total, runs, inProgress, workersOnline } =
    Route.useLoaderData();

  useRouteRefresh(10_000);

  return (
    <Page title={m.training_title()} description={m.training_description()}>
      <StatisticGroup>
        <Statistic title={m.training_kpi_runs()} value={formatCount(total)} />
        <Statistic
          title={m.training_kpi_in_progress()}
          value={formatCount(inProgress)}
        />
        <Statistic
          title={m.training_kpi_workers()}
          value={formatCount(workersOnline)}
        />
      </StatisticGroup>

      <PageSection
        title={m.versions_table()}
        extra={
          versions.length > 0 ? <CountTag count={versions.length} /> : null
        }
      >
        <VersionsTable versions={versions} emptyAction={<OpenDatasets />} />
      </PageSection>

      <PageSection
        title={m.run_table_label()}
        extra={runs.length > 0 ? <OpenDatasets /> : null}
      >
        <TrainingRunsTable
          runs={runs}
          datasetColumn
          emptyAction={<OpenDatasets />}
        />
      </PageSection>
    </Page>
  );
}

function CountTag({ count }: { count: number }) {
  return <Tag size="small">{formatCount(count)}</Tag>;
}

/** Training starts from a dataset's training page, so the runs point there. */
function OpenDatasets() {
  return (
    <Button render={<Link to="/datasets" />}>
      {m.run_empty_open_datasets()}
    </Button>
  );
}
