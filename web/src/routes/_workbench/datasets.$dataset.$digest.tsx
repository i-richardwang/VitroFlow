import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES } from "../../domain/annotation/schema";
import { ImageWorkbench } from "../../features/calibration/ImageWorkbench";
import { datasetImageRefSchema } from "../../domain/datasets/schema";
import { getDatasetImage } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { WorkbenchSection, WorkbenchSkeleton } from "../../ui/shell/Workbench";
import { StepButton } from "../../ui/StepButton";
import { splitLabel } from "../../features/datasets/labels";
import { documentTitle } from "../../ui/documentTitle";
import { m } from "../../paraglide/messages";
import type {
  DatasetImageStep,
  DatasetImageView,
} from "../../domain/datasets/image";

/**
 * `show` names the reading on view; the best shows otherwise. `calibrate`
 * opens the draft.
 */
const datasetImageSearchSchema = z.object({
  show: z.enum(REVIEW_SOURCES).optional().catch(undefined),
  calibrate: z.literal(true).optional().catch(undefined),
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
      const { dataset, review } = loaderData as DatasetImageView;
      return [
        { label: m.datasets_title(), href: "/datasets" },
        { label: dataset.id, href: `/datasets/${dataset.id}`, mono: true },
        { label: review.filename, mono: true },
      ];
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
  const { dataset, model, review, split, previous, next } =
    Route.useLoaderData();
  const { show, calibrate } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { detection } = review;

  useRouteRefresh(
    5000,
    (detection === null && review.annotation === null) ||
      review.progress !== null,
  );

  const stepTo = (step: DatasetImageStep) =>
    void navigate({
      params: (current) => ({ ...current, digest: step.digest }),
      search: (current) => current,
    });

  return (
    <ImageWorkbench
      key={review.ref.digest}
      title={m.image_title({ file: review.filename, dataset: dataset.id })}
      model={model}
      review={review}
      calibrating={calibrate === true}
      source={show}
      onSourceChange={(show) =>
        void navigate({ search: (previous) => ({ ...previous, show }) })
      }
      onCalibratingChange={(calibrating) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            calibrate: calibrating ? true : undefined,
          }),
        })
      }
      context={{
        toolbar: (
          <>
            <StepButton
              direction="previous"
              label={m.image_previous()}
              disabled={previous === null}
              onClick={() => previous && stepTo(previous)}
            />
            <StepButton
              direction="next"
              label={m.image_next()}
              disabled={next === null}
              onClick={() => next && stepTo(next)}
            />
          </>
        ),
        details: split ? (
          <WorkbenchSection title={m.image_section()}>
            <Descriptions>
              <DescriptionsItem label={m.image_split()}>
                {splitLabel(split)}
              </DescriptionsItem>
            </Descriptions>
          </WorkbenchSection>
        ) : undefined,
      }}
    />
  );
}
