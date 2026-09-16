import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES, agentBusy } from "../../domain/annotation/review";
import { UnitWorkbench } from "../../features/experiments/UnitWorkbench";
import {
  unitRefSchema,
  observationIdSchema,
} from "../../domain/experiments/schema";
import { getUnit } from "../../functions/experiments";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { m } from "../../paraglide/messages";
import type { UnitSeries } from "../../domain/experiments/contracts";

/**
 * An observation the link cannot name is no observation: the newest shows.
 * `show` names the reading on view; the best shows otherwise. `calibrate`
 * opens the draft.
 */
const unitSearchSchema = z.object({
  observation: observationIdSchema.optional().catch(undefined),
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
  calibrate: z.literal(true).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$unit",
)({
  validateSearch: unitSearchSchema,
  loaderDeps: ({ search }) => ({ observation: search.observation }),
  loader: async ({ params, deps }) => {
    const ref = unitRefSchema.safeParse({
      experiment: params.experiment,
      unit: params.unit,
    });
    if (!ref.success) throw notFound();
    const series = await getUnit({
      data: { ...ref.data, ...deps },
    });
    if (!series) throw notFound();
    return series;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment, unit } = loaderData as UnitSeries;
      return [
        { label: m.experiments_title(), href: "/experiments" },
        { label: experiment.name, href: `/experiments/${experiment.id}` },
        { label: unit.code, mono: true },
      ];
    },
  },
  head: ({ loaderData }) => {
    const { experiment, unit } = loaderData as UnitSeries;
    return {
      meta: [
        {
          title: `${unit.code} · ${experiment.name} · ${m.app_name()}`,
        },
      ],
    };
  },
  component: UnitPage,
});

function UnitPage() {
  const { datasets, agents, ...series } = Route.useLoaderData();
  const { show, calibrate } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { shown } = series;

  useRouteRefresh(
    router,
    5000,
    shown !== null &&
      ((shown.review.detection === null && shown.failure === null) ||
        agentBusy(shown.review)),
  );

  return (
    <UnitWorkbench
      key={`${series.experiment.id}/${series.unit.id}`}
      series={series}
      datasets={datasets}
      agents={agents}
      calibrating={calibrate === true}
      source={show}
      onSourceChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
      onCalibratingChange={(calibrating) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            calibrate: calibrating ? true : undefined,
          }),
        })
      }
    />
  );
}
