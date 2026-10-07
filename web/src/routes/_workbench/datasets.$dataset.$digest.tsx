import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import { ImageWorkbench } from "../../features/annotation/ImageWorkbench";
import { datasetImageRefSchema } from "../../domain/datasets/schema";
import { getDatasetImage } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { DescriptionsItem } from "../../ui/kit/Descriptions";
import { modelName } from "../../ui/model-names";
import { useStepKeys } from "../../features/annotation/keys";
import { WorkbenchFooter, WorkbenchSkeleton } from "../../ui/shell/Workbench";
import { Stepper } from "../../ui/Stepper";
import { splitLabel } from "../../features/datasets/labels";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import { datasetCrumbs } from "../../features/models/crumbs";
import type {
  DatasetImageStep,
  DatasetImageView,
} from "../../domain/datasets/image";
import { Text } from "../../ui/kit/Text";

/** `show` names the reading on view; the best shows otherwise. */
const datasetImageSearchSchema = z.object({
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
});

export const Route = createFileRoute("/_workbench/datasets/$dataset/$digest")({
  validateSearch: datasetImageSearchSchema,
  loader: async ({ params }) => {
    const ref = datasetImageRefSchema.safeParse(params);
    if (!ref.success) throw notFound();
    const view = await getDatasetImage({ data: ref.data });
    if (!view) throw notFound();
    return view;
  },
  staticData: {
    crumbs: ({ loaderData }) => {
      const { dataset, model, review } = loaderData as DatasetImageView;
      return [...datasetCrumbs(model, dataset.id), { label: review.filename }];
    },
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: documentTitle(
          loaderData &&
            m.image_title({
              file: loaderData.review.filename,
              dataset: loaderData.dataset.id,
            }),
        ),
      },
    ],
  }),
  pendingComponent: WorkbenchSkeleton,
  component: DatasetImagePage,
});

function DatasetImagePage() {
  const {
    dataset,
    model,
    review,
    split,
    position,
    previous,
    next,
    nextUnreviewed,
  } = Route.useLoaderData();
  const { show } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { detection } = review;

  useRouteRefresh(
    5000,
    (detection === null && review.annotation === null) ||
      review.progress !== null,
  );

  const stepTo = (step: DatasetImageStep | null) =>
    step
      ? () =>
          void navigate({
            params: (current) => ({ ...current, digest: step.digest }),
            search: {},
          })
      : undefined;
  const toPrevious = stepTo(previous);
  const toNext = stepTo(next);
  useStepKeys({
    ArrowLeft: toPrevious,
    ArrowRight: toNext,
  });

  return (
    <ImageWorkbench
      key={review.ref.digest}
      title={m.image_title({ file: review.filename, dataset: dataset.id })}
      model={model}
      review={review}
      source={show}
      onSourceChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
      onNext={stepTo(nextUnreviewed)}
      context={{
        steps: (
          <WorkbenchFooter label={m.image_steps()}>
            <Stepper
              previous={{ label: m.image_previous(), onClick: toPrevious }}
              next={{ label: m.image_next(), onClick: toNext }}
            >
              {m.ui_step_position(position)}
            </Stepper>
            <Text as="span" size="sm" type="secondary" ellipsis>
              {modelName(model)}
            </Text>
          </WorkbenchFooter>
        ),
        facts: split ? (
          <DescriptionsItem label={m.image_split()}>
            {splitLabel(split)}
          </DescriptionsItem>
        ) : undefined,
      }}
    />
  );
}
