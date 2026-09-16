import { ButtonGroup } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_SOURCES, agentBusy } from "../../domain/annotation/review";
import { ChevronLeftIcon, ChevronRightIcon } from "../../ui/icons";
import { ImageWorkbench } from "../../features/calibration/ImageWorkbench";
import { Metrics, Section } from "../../features/calibration/inspector";
import { StepButton } from "../../features/calibration/StepButton";
import { datasetImageRefSchema } from "../../domain/datasets/schema";
import { getDatasetImage } from "../../functions/datasets";
import { useRouteRefresh } from "../../ui/hooks/useRouteRefresh";
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
    meta: loaderData
      ? [{ title: `${loaderData.review.filename} · ${m.app_name()}` }]
      : [],
  }),
  component: DatasetImagePage,
});

function DatasetImagePage() {
  const { dataset, model, review, agents, split, previous, next } =
    Route.useLoaderData();
  const { show, calibrate } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { detection } = review;

  useRouteRefresh(
    router,
    5000,
    (detection === null && review.annotation === null) || agentBusy(review),
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
      agents={agents}
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
            <ButtonGroup variant="tertiary">
              <StepButton
                label={m.image_previous()}
                neighbour={previous?.filename ?? null}
                onPress={() => previous && stepTo(previous)}
              >
                <ChevronLeftIcon />
              </StepButton>
              <StepButton
                label={m.image_next()}
                neighbour={next?.filename ?? null}
                onPress={() => next && stepTo(next)}
              >
                <ButtonGroup.Separator />
                <ChevronRightIcon />
              </StepButton>
            </ButtonGroup>
          </>
        ),
        details: split ? (
          <Section title={m.image_section()}>
            <Metrics rows={[{ label: m.image_split(), value: split }]} />
          </Section>
        ) : undefined,
      }}
    />
  );
}
