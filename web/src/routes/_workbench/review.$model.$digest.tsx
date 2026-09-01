import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { ImageWorkbench } from "../../components/workbench/ImageWorkbench";
import { annotationRefSchema } from "../../annotation/schema";
import { getReview } from "../../functions/review";
import { resourceIdSchema } from "../../identifiers/schema";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { Review } from "../../annotation/review";

const reviewSearchSchema = z.object({ version: z.unknown().optional() });

export const Route = createFileRoute("/_workbench/review/$model/$digest")({
  validateSearch: reviewSearchSchema,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: async ({ params, deps }) => {
    const ref = annotationRefSchema.safeParse({
      digest: params.digest,
      modelId: params.model,
    });
    const version =
      deps.version === undefined
        ? undefined
        : resourceIdSchema.safeParse(deps.version);
    if (!ref.success || (version && !version.success)) throw notFound();
    const review = await getReview({
      data: { ...ref.data, version: version?.data },
    });
    if (!review) throw notFound();
    return review;
  },
  staticData: {
    crumbs: ({ loaderData }) => [
      { label: (loaderData as Review).filename, mono: true },
    ],
  },
  gcTime: 0,
  component: ReviewPage,
});

function ReviewPage() {
  const review = Route.useLoaderData();
  const router = useRouter();

  const waiting = review.state === "waiting";
  useRouteRefresh(router, 5000, waiting);

  return (
    <ImageWorkbench
      key={`${review.ref.modelId}/${review.ref.digest}`}
      review={review}
    />
  );
}
