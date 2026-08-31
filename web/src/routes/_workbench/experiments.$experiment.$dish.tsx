import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { DishWorkbench } from "../../components/experiment/DishWorkbench";
import { dishRefSchema, observationIdSchema } from "../../experiments/schema";
import { getExperimentDish } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { ExperimentDishSeries } from "../../experiments/contracts";

const dishSearchSchema = z.object({ observation: z.unknown().optional() });

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$dish",
)({
  validateSearch: dishSearchSchema,
  loaderDeps: ({ search }) => ({ observation: search.observation }),
  loader: async ({ params, deps }) => {
    const ref = dishRefSchema.safeParse({
      experiment: params.experiment,
      dish: params.dish,
    });
    const observation =
      deps.observation === undefined
        ? undefined
        : observationIdSchema.safeParse(deps.observation);
    if (!ref.success || (observation && !observation.success)) throw notFound();
    const series = await getExperimentDish({
      data: { ...ref.data, observation: observation?.data },
    });
    if (!series) throw notFound();
    return series;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment, dish } = loaderData as ExperimentDishSeries;
      return [
        { label: "Experiments", href: "/experiments" },
        { label: experiment.name, href: `/experiments/${experiment.id}` },
        { label: dish.label, mono: true },
      ];
    },
  },
  component: DishPage,
});

function DishPage() {
  const { datasets, ...series } = Route.useLoaderData();
  const router = useRouter();

  const waiting =
    series.shown !== null &&
    series.shown.detection === null &&
    series.shown.failure === null;
  useRouteRefresh(router, 5000, waiting);

  return (
    <DishWorkbench
      key={`${series.experiment.id}/${series.dish.id}`}
      series={series}
      datasets={datasets}
    />
  );
}
