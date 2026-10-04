import { createFileRoute, notFound } from "@tanstack/react-router";

import type { ExperimentGrid } from "../../domain/experiments/contracts";
import { experimentIdSchema } from "../../domain/experiments/schema";
import { ExperimentGridView } from "../../features/experiments/ExperimentGridView";
import { getExperimentGrid } from "../../functions/experiments";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import {
  PageHeaderSkeleton,
  PageSkeleton,
  StatStripSkeleton,
  TableSkeleton,
} from "../../ui/kit/PageSkeleton";

export const Route = createFileRoute("/_workbench/experiments/$experiment/")({
  loader: async ({ params }) => {
    if (!experimentIdSchema.safeParse(params.experiment).success) {
      throw notFound();
    }
    const grid = await getExperimentGrid({
      data: { experiment: params.experiment },
    });
    if (!grid) throw notFound();
    return grid;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { experiment } = loaderData as ExperimentGrid;
      return [
        { label: m.experiments_title(), href: "/experiments" },
        { label: experiment.name },
      ];
    },
  },
  head: ({ loaderData }) => ({
    meta: [{ title: documentTitle(loaderData?.experiment.name) }],
  }),
  pendingComponent: () => (
    <PageSkeleton>
      <PageHeaderSkeleton meta action />
      <StatStripSkeleton count={4} />
      <TableSkeleton />
    </PageSkeleton>
  ),
  component: ExperimentPage,
});

function ExperimentPage() {
  return <ExperimentGridView data={Route.useLoaderData()} />;
}
