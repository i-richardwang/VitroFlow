import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";

import { Page } from "../../ui/Page";
import { TrainDialog } from "../../features/training/TrainDialog";
import { TrainingRunsTable } from "../../features/training/TrainingRunsTable";
import { getTrainingConsole } from "../../functions/training";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
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
          title: `${m.training_title()} · ${params.dataset} · ${m.app_name()}`,
        },
      ],
    }),
    component: TrainingPage,
  },
);

function TrainingPage() {
  const console = Route.useLoaderData();
  const { reviewed, training, runs } = console;
  const router = useRouter();

  useRouteRefresh(router, 10_000);

  return (
    <Page
      title={m.training_title()}
      actions={<TrainDialog console={console} />}
    >
      <KPIGroup>
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.training_kpi_ready()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value maximumFractionDigits={0} value={reviewed} />
          </KPI.Content>
          {training.reviewedSinceLastRun > 0 ? (
            <KPI.Footer>
              {m.training_kpi_new_since_last_run({
                count: training.reviewedSinceLastRun,
              })}
            </KPI.Footer>
          ) : null}
        </KPI>
        <KPIGroup.Separator />
        <KPI>
          <KPI.Header>
            <KPI.Title>{m.training_kpi_workers()}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value
              maximumFractionDigits={0}
              value={training.workersOnline}
            />
          </KPI.Content>
        </KPI>
      </KPIGroup>

      <TrainingRunsTable runs={runs} />
    </Page>
  );
}
