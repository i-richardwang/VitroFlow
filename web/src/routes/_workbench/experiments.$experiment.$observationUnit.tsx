import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { ObservationUnitWorkbench } from "../../components/experiment/ObservationUnitWorkbench";
import {
  observationUnitRefSchema,
  observationIdSchema,
} from "../../experiments/schema";
import { getObservationUnit } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { ObservationUnitSeries } from "../../experiments/contracts";

const observationUnitSearchSchema = z.object({
  observation: z.unknown().optional(),
});

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$observationUnit",
)({
  validateSearch: observationUnitSearchSchema,
  loaderDeps: ({ search }) => ({ observation: search.observation }),
  loader: async ({ params, deps }) => {
    const ref = observationUnitRefSchema.safeParse({
      experiment: params.experiment,
      observationUnit: params.observationUnit,
    });
    const observation =
      deps.observation === undefined
        ? undefined
        : observationIdSchema.safeParse(deps.observation);
    if (!ref.success || (observation && !observation.success)) throw notFound();
    const series = await getObservationUnit({
      data: { ...ref.data, observation: observation?.data },
    });
    if (!series) throw notFound();
    return series;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment, observationUnit } =
        loaderData as ObservationUnitSeries;
      return [
        { label: "Experiments", href: "/experiments" },
        { label: experiment.name, href: `/experiments/${experiment.id}` },
        { label: observationUnit.code, mono: true },
      ];
    },
  },
  component: ObservationUnitPage,
});

function ObservationUnitPage() {
  const { datasets, ...series } = Route.useLoaderData();
  const router = useRouter();

  const waiting =
    series.shown !== null &&
    series.shown.detection === null &&
    series.shown.failure === null;
  useRouteRefresh(router, 5000, waiting);

  return (
    <ObservationUnitWorkbench
      key={`${series.experiment.id}/${series.observationUnit.id}`}
      series={series}
      datasets={datasets}
    />
  );
}
