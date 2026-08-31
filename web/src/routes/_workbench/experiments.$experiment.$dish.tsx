import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { DishWorkbench } from "../../components/experiment/DishWorkbench";
import { dishRefSchema, roundIdSchema } from "../../experiments/schema";
import { getExperimentDish } from "../../functions/experiments";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { ExperimentDishSeries } from "../../experiments/contracts";

const dishSearchSchema = z.object({ round: z.unknown().optional() });

export const Route = createFileRoute(
  "/_workbench/experiments/$experiment/$dish",
)({
  validateSearch: dishSearchSchema,
  loaderDeps: ({ search }) => ({ round: search.round }),
  loader: async ({ params, deps }) => {
    const ref = dishRefSchema.safeParse({
      experiment: params.experiment,
      dish: params.dish,
    });
    const round =
      deps.round === undefined
        ? undefined
        : roundIdSchema.safeParse(deps.round);
    if (!ref.success || (round && !round.success)) throw notFound();
    const series = await getExperimentDish({
      data: { ...ref.data, round: round?.data },
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
      key={`${series.experiment.id}/${series.dish.label}`}
      series={series}
      datasets={datasets}
    />
  );
}
