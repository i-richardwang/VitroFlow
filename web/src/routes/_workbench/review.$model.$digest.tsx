import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { ImageWorkbench } from "../../components/workbench/ImageWorkbench";
import { labelRefSchema } from "../../annotation/schema";
import { getReview } from "../../functions/review";
import { resourceIdSchema } from "../../identifiers/schema";
import type { Review } from "../../server/review";

const reviewSearchSchema = z.object({ version: z.unknown().optional() });

/**
 * The review workbench for one image and one model. Experiments and datasets
 * both open this page; the document it edits is the same from either. An
 * experiment passes the version it reads with, so a review starts from the
 * boxes the reviewer just saw.
 */
export const Route = createFileRoute("/_workbench/review/$model/$digest")({
  validateSearch: reviewSearchSchema,
  loaderDeps: ({ search }) => ({ version: search.version }),
  loader: async ({ params, deps }) => {
    const ref = labelRefSchema.safeParse({
      digest: params.digest,
      model: params.model,
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
  // The editor owns the document while the page is open and the label row
  // is the source of truth between visits, so a cached copy is never wanted.
  gcTime: 0,
  component: ReviewPage,
});

function ReviewPage() {
  const review = Route.useLoaderData();
  const router = useRouter();

  // A worker records the detection for the experiment the photograph belongs
  // to; until then the page has nothing to review and watches for it.
  const waiting = review.detection === null && review.label === null;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void router.invalidate(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting, router]);

  return (
    <ImageWorkbench
      key={`${review.ref.model}/${review.ref.digest}`}
      review={review}
    />
  );
}
