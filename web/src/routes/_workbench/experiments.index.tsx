import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";

import { ExperimentCard } from "../../features/experiments/ExperimentCard";
import { NewExperimentDialog } from "../../features/experiments/NewExperimentDialog";
import { getExperiments } from "../../functions/experiments";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { Button } from "../../ui/kit/Button";
import { Empty } from "../../ui/kit/Empty";
import { PageHeaderSkeleton } from "../../ui/kit/PageSkeleton";
import { CardGrid, CardGridSkeleton } from "../../ui/kit/SummaryCard";
import { Page, PageColumnSkeleton } from "../../ui/Page";

export const Route = createFileRoute("/_workbench/experiments/")({
  loader: () => getExperiments(),
  staticData: { crumbs: () => [{ label: m.experiments_title() }] },
  head: () => ({
    meta: [{ title: documentTitle(m.experiments_title()) }],
  }),
  pendingComponent: () => (
    <PageColumnSkeleton>
      <PageHeaderSkeleton description />
      <CardGridSkeleton band />
    </PageColumnSkeleton>
  ),
  component: ExperimentsPage,
});

function ExperimentsPage() {
  const experiments = Route.useLoaderData();
  const [creating, setCreating] = useState(false);
  const create = (
    <Button type="primary" icon={Plus} onClick={() => setCreating(true)}>
      {m.experiment_new()}
    </Button>
  );

  return (
    <Page
      title={m.experiments_title()}
      description={m.experiments_description()}
      action={experiments.length > 0 ? create : undefined}
    >
      <CardGrid
        aria-label={m.experiments_title()}
        empty={
          experiments.length === 0 && (
            <Empty
              icon={FlaskConical}
              title={m.experiments_empty()}
              description={m.experiments_empty_description()}
              action={create}
            />
          )
        }
      >
        {experiments.map((summary) => (
          <ExperimentCard key={summary.experiment.id} summary={summary} />
        ))}
      </CardGrid>
      <NewExperimentDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
