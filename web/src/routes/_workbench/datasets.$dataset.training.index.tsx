import { createFileRoute, notFound } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useState } from "react";

import { Page, PageColumnSkeleton } from "../../ui/Page";
import { formatCount } from "../../ui/numbers";
import { TrainDialog, trainRefusal } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getTrainingConsole } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button } from "../../ui/kit/Button";
import { TableSkeleton } from "../../ui/kit/PageSkeleton";
import {
  Statistic,
  StatisticGroup,
  StatisticGroupSkeleton,
} from "../../ui/kit/Statistic";
import { Tooltip } from "../../ui/kit/Tooltip";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";

export const Route = createFileRoute("/_workbench/datasets/$dataset/training/")(
  {
    loader: async ({ params }) => {
      const console = await getTrainingConsole({
        data: { dataset: params.dataset },
      });
      if (!console) throw notFound();
      return console;
    },
    staticData: {
      crumbs: ({ params }) => [
        { label: m.training_datasets_crumb(), href: "/datasets" },
        {
          label: params.dataset,
          href: `/datasets/${params.dataset}`,
        },
        { label: m.training_title() },
      ],
    },
    head: ({ params }) => ({
      meta: [
        {
          title: documentTitle(
            m.training_dataset_title({ dataset: params.dataset }),
          ),
        },
      ],
    }),
    pendingComponent: () => (
      <PageColumnSkeleton>
        <StatisticGroupSkeleton count={2} />
        <TableSkeleton />
      </PageColumnSkeleton>
    ),
    component: TrainingPage,
  },
);

function TrainingPage() {
  const console = Route.useLoaderData();
  const { reviewed, training, runs } = console;
  const [starting, setStarting] = useState(false);
  const refusal = trainRefusal(console);

  useRouteRefresh(10_000);

  return (
    <Page
      title={m.training_title()}
      action={
        runs.length > 0 ? (
          <TrainButton refusal={refusal} onClick={() => setStarting(true)} />
        ) : null
      }
    >
      <StatisticGroup>
        <Statistic
          title={m.training_kpi_ready()}
          value={formatCount(reviewed)}
          description={
            training.reviewedSinceLastRun > 0
              ? m.training_kpi_new_since_last_run({
                  count: training.reviewedSinceLastRun,
                })
              : undefined
          }
        />
        <Statistic
          title={m.training_kpi_workers()}
          value={formatCount(training.workersOnline)}
        />
      </StatisticGroup>

      <TrainingRunsTable
        runs={runs}
        emptyAction={
          <TrainButton refusal={refusal} onClick={() => setStarting(true)} />
        }
      />
      <TrainDialog
        console={console}
        open={starting}
        onClose={() => setStarting(false)}
      />
    </Page>
  );
}

/** Opens the training dialog, or says in a tooltip why a run cannot start. */
function TrainButton({
  refusal,
  onClick,
}: {
  refusal: string | null;
  onClick: () => void;
}) {
  return (
    <Tooltip title={refusal}>
      <Button
        type="primary"
        icon={Play}
        disabled={refusal !== null}
        onClick={onClick}
      >
        {m.train_button()}
      </Button>
    </Tooltip>
  );
}
