import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useState } from "react";

import { Page } from "../../ui/Page";
import { formatCount } from "../../ui/numbers";
import { TrainDialog, trainRefusal } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getTrainingConsole } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Button, type ButtonType } from "../../ui/kit/Button";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  StatGridSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";
import { StatCard, StatGrid } from "../../ui/kit/StatCard";
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
          mono: true,
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
      <PageSkeleton>
        <PageHeaderSkeleton action />
        <StatGridSkeleton count={2} />
        <TableSkeleton />
      </PageSkeleton>
    ),
    component: TrainingPage,
  },
);

function TrainingPage() {
  const console = Route.useLoaderData();
  const { reviewed, training, runs } = console;
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const refusal = trainRefusal(console);

  useRouteRefresh(router, 10_000);

  return (
    <Page
      title={m.training_title()}
      actions={
        <TrainButton
          type="primary"
          refusal={refusal}
          onClick={() => setStarting(true)}
        />
      }
    >
      <StatGrid>
        <StatCard
          label={m.training_kpi_ready()}
          value={formatCount(reviewed)}
          hint={
            training.reviewedSinceLastRun > 0
              ? m.training_kpi_new_since_last_run({
                  count: training.reviewedSinceLastRun,
                })
              : undefined
          }
        />
        <StatCard
          label={m.training_kpi_workers()}
          value={formatCount(training.workersOnline)}
        />
      </StatGrid>

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
  type,
  refusal,
  onClick,
}: {
  type?: ButtonType;
  refusal: string | null;
  onClick: () => void;
}) {
  return (
    <Tooltip title={refusal}>
      <Button
        type={type}
        icon={Play}
        disabled={refusal !== null}
        onClick={onClick}
      >
        {m.train_button()}
      </Button>
    </Tooltip>
  );
}
