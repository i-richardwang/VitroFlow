import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { UnitWorkbench } from "../../components/experiment/UnitWorkbench";
import { unitRefSchema, observationIdSchema } from "../../experiments/schema";
import { getUnit } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import { m } from "../../paraglide/messages";
import type { UnitSeries } from "../../experiments/contracts";

/**
 * An observation the link cannot name is no observation: the newest shows.
 * `calibrate` opens the draft.
 */
const unitSearchSchema = z.object({
  observation: observationIdSchema.optional().catch(undefined),
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
  const { datasets, ...series } = Route.useLoaderData();
  const { calibrate } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { shown } = series;

  useRouteRefresh(
    router,
    5000,
    shown !== null && shown.review.detection === null && shown.failure === null,
  );

  return (
    <UnitWorkbench
      key={`${series.experiment.id}/${series.unit.id}`}
      series={series}
      datasets={datasets}
      calibrating={calibrate === true}
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
