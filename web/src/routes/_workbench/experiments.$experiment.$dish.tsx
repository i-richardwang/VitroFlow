import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { DishWorkbench } from "../../components/experiment/DishWorkbench";
import { dishRefSchema, roundIdSchema } from "../../experiments/schema";
import { getExperimentDish } from "../../functions/experiments";
import type { ExperimentDishSeries } from "../../server/experiments";

const dishSearchSchema = z.object({ round: z.unknown().optional() });

/**
 * One dish across the experiment's rounds. The path names the dish; the
 * `round` search parameter picks which photograph is shown, and without it
 * the page shows the newest.
 */
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
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  return (
    <DishWorkbench
      key={`${series.experiment.id}/${series.dish.label}`}
      series={series}
      datasets={datasets}
    />
  );
}
