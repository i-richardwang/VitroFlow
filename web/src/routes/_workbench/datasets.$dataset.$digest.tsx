import { Segment } from "@heroui-pro/react/segment";
import { ButtonGroup, Separator } from "@heroui/react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { REVIEW_VERSIONS } from "../../annotation/review";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/icons";
import { ImageWorkbench } from "../../components/workbench/ImageWorkbench";
import { Metrics, Section } from "../../components/workbench/inspector";
import { StepButton } from "../../components/workbench/StepButton";
import { datasetImageRefSchema } from "../../datasets/schema";
import { getDatasetImage } from "../../functions/datasets";
import { useRouteRefresh } from "../../hooks/useRouteRefresh";
import type { DatasetImageStep, DatasetImageView } from "../../datasets/image";

/**
 * `show` picks the boxes to look at: what the model found, or the review;
 * `edit` opens the review for editing.
 */
const datasetImageSearchSchema = z.object({
  show: z.enum(REVIEW_VERSIONS).optional().catch(undefined),
  edit: z.literal(true).optional().catch(undefined),
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
        { label: "Datasets", href: "/datasets" },
        { label: dataset.id, href: `/datasets/${dataset.id}`, mono: true },
        { label: review.filename, mono: true },
      ];
    },
  },
  component: DatasetImagePage,
});

function DatasetImagePage() {
  const { dataset, model, review, split, previous, next } =
    Route.useLoaderData();
  const { show, edit } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { detection } = review;

  useRouteRefresh(
    router,
    5000,
    detection === null && review.annotation === null,
  );

  const stepTo = (step: DatasetImageStep) =>
    void navigate({
      params: (current) => ({ ...current, digest: step.digest }),
      search: (current) => current,
    });

  return (
    <ImageWorkbench
      key={review.ref.digest}
      title={`${review.filename} in ${dataset.id}`}
      model={model}
      review={review}
      editing={edit === true}
      version={show}
      onEditingChange={(editing) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            edit: editing ? true : undefined,
          }),
        })
      }
      context={{
        toolbar: (
          <>
            <ButtonGroup variant="tertiary">
              <StepButton
                label="Previous image"
                neighbour={previous?.filename ?? null}
                onPress={() => previous && stepTo(previous)}
              >
                <ChevronLeftIcon />
              </StepButton>
              <StepButton
                label="Next image"
                neighbour={next?.filename ?? null}
                onPress={() => next && stepTo(next)}
              >
                <ButtonGroup.Separator />
                <ChevronRightIcon />
              </StepButton>
            </ButtonGroup>
            {!edit && detection && review.annotation ? (
              <>
                <Separator />
                <Segment
                  variant="ghost"
                  aria-label="Boxes shown"
                  selectedKey={show ?? "review"}
                  onSelectionChange={(key) => {
                    if (key !== "review" && key !== "detection") return;
                    void navigate({
                      search: (previous) => ({ ...previous, show: key }),
                    });
                  }}
                >
                  <Segment.Item id="detection">Detected</Segment.Item>
                  <Segment.Item id="review">Reviewed</Segment.Item>
                </Segment>
              </>
            ) : null}
          </>
        ),
        details: (
          <Section title="Image">
            <Metrics
              rows={[
                { label: "File", value: review.filename },
                ...(split ? [{ label: "Split", value: split }] : []),
              ]}
            />
          </Section>
        ),
      }}
    />
  );
}
