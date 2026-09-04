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

/**
 * An observation the link cannot name is no observation: the newest shows.
 * `edit` opens the image's review for editing.
 */
const observationUnitSearchSchema = z.object({
  observation: observationIdSchema.optional().catch(undefined),
  edit: z.literal(true).optional().catch(undefined),
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
    if (!ref.success) throw notFound();
    const series = await getObservationUnit({
      data: { ...ref.data, ...deps },
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
  /** An edit opens on the stored revision, never on a cached one. */
  gcTime: 0,
  component: ObservationUnitPage,
});

function ObservationUnitPage() {
  const { datasets, ...series } = Route.useLoaderData();
  const { edit } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { shown } = series;

  useRouteRefresh(
    router,
    5000,
    shown !== null && shown.review.detection === null && shown.failure === null,
  );

  return (
    <ObservationUnitWorkbench
      key={`${series.experiment.id}/${series.observationUnit.id}`}
      series={series}
      datasets={datasets}
      editing={edit === true}
      onEditingChange={(editing) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            edit: editing ? true : undefined,
          }),
        })
      }
    />
  );
}
