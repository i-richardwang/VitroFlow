import { EmptyState } from "@heroui-pro/react/empty-state";
import { Alert, Button, Link, Toolbar, Tooltip } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import type { LabelInstance } from "../../annotation/schema";
import { isCompletedReview } from "../../annotation/status";
import type { PhotoRef } from "../../experiments/schema";
import { retryPhotoDetection } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { tally } from "../../models/readings";
import { versionSlug } from "../../models/schema";
import type {
  ExperimentDishSeries,
  ExperimentPhoto,
} from "../../experiments/contracts";
import { AddToDatasetDialog } from "../dataset/AddToDatasetDialog";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { QualityWarnings } from "../QualityWarnings";
import { Timestamp } from "../Timestamp";
import { Workbench } from "../Workbench";
import { AnnotationCanvas } from "../workbench/AnnotationCanvas";
import type { LayerKey } from "../workbench/controls";
import {
  LayersSection,
  Metrics,
  ReadingsSection,
  Section,
} from "../workbench/inspector";
import { PhotoStateChip } from "./PhotoState";

const DEFAULT_LAYERS: LayerKey[] = ["boxes", "dish"];
const VIEW_LAYERS: LayerKey[] = ["boxes", "ids", "dish"];

export function DishWorkbench({
  series,
  datasets,
}: {
  series: ExperimentDishSeries;
  datasets: string[];
}) {
  const { experiment, model, version, dish, treatment, shown } = series;
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const detection = shown?.detection ?? null;
  const completedReview =
    shown?.label && isCompletedReview(shown.label) ? shown.label : null;
  const instances: LabelInstance[] =
    completedReview?.instances ??
    detection?.instances.map(({ id, class: className, bbox }) => ({
      id,
      class: className,
      bbox,
    })) ??
    [];

  return (
    <Workbench
      title={`Dish ${dish.label} of ${experiment.name}`}
      actions={
        shown ? (
          <>
            {detection && <QualityWarnings quality={detection.quality} />}
            {(detection || shown.label) && <ReviewButton photo={shown} />}
            <AddToDatasetDialog photos={[shown.ref]} datasets={datasets} />
          </>
        ) : undefined
      }
      toolbar={
        <Toolbar aria-label="Dish and round" className="gap-3 px-3 py-1.5">
          <DishStepper
            experiment={experiment.id}
            previous={series.previous}
            next={series.next}
          />
          <RoundTabs series={series} shown={shown?.ref.round ?? null} />
        </Toolbar>
      }
      inspector={
        shown ? (
          <>
            {(completedReview || detection) && (
              <ReadingsSection
                readings={model.readings}
                sources={[
                  ...(completedReview
                    ? [
                        {
                          label: "Reviewed",
                          tally: tally(completedReview.instances),
                        },
                      ]
                    : []),
                  ...(detection
                    ? [
                        {
                          label: "Detected",
                          tally: tally(detection.instances),
                        },
                      ]
                    : []),
                ]}
              />
            )}
            <Section
              title="Photograph"
              trailing={
                shown.failure ? null : (
                  <PhotoStateChip state={detection ? "observed" : "pending"} />
                )
              }
            >
              <Metrics
                rows={[
                  {
                    label: "Treatment",
                    value: treatment?.name ?? (
                      <span className="text-muted">Unassigned</span>
                    ),
                  },
                  { label: "File", value: shown.filename },
                  {
                    label: "Captured",
                    value: <Timestamp value={shown.round.capturedAt} />,
                  },
                  { label: "Version", value: versionSlug(version) },
                ]}
              />
              {shown.failure ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Detection failed</Alert.Title>
                    <Alert.Description>{shown.failure.error}</Alert.Description>
                  </Alert.Content>
                  <RetryButton photo={shown.ref} />
                </Alert>
              ) : null}
            </Section>
            <LayersSection
              layers={layers}
              onLayersChange={setLayers}
              available={VIEW_LAYERS}
            />
          </>
        ) : undefined
      }
    >
      {shown ? (
        <AnnotationCanvas
          image={{
            digest: shown.digest,
            width: shown.width,
            height: shown.height,
          }}
          filename={shown.filename}
          result={detection}
          instances={instances}
          layers={layers}
        />
      ) : (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Title>Not photographed yet</EmptyState.Title>
              <EmptyState.Description>
                No round has a photograph of dish {dish.label}.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      )}
    </Workbench>
  );
}

function RoundTabs({
  series,
  shown,
}: {
  series: ExperimentDishSeries;
  shown: string | null;
}) {
  const base = `/experiments/${series.experiment.id}/${encodeURIComponent(series.dish.label)}`;
  return (
    <nav aria-label="Rounds" className="flex items-center gap-1">
      {series.rounds.map((item) => {
        const selected = shown === item.round.id;
        const className = `rounded-lg px-3 py-1.5 text-sm no-underline ${
          selected
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted hover:bg-default"
        }`;
        return item.photo ? (
          <Link
            key={item.round.id}
            href={`${base}?round=${item.round.id}`}
            aria-current={selected ? "page" : undefined}
            className={className}
          >
            {item.round.label}
          </Link>
        ) : (
          <span
            key={item.round.id}
            aria-disabled="true"
            className={`${className} cursor-not-allowed opacity-40`}
          >
            {item.round.label}
          </span>
        );
      })}
    </nav>
  );
}

function DishStepper({
  experiment,
  previous,
  next,
}: {
  experiment: string;
  previous: string | null;
  next: string | null;
}) {
  const router = useRouter();
  const go = (dish: string) =>
    void router.navigate({
      to: "/experiments/$experiment/$dish",
      params: { experiment, dish },
    });
  return (
    <span className="flex items-center">
      <DishStepButton
        label="Previous dish"
        dish={previous}
        onPress={go}
        icon={<ChevronLeftIcon />}
      />
      <DishStepButton
        label="Next dish"
        dish={next}
        onPress={go}
        icon={<ChevronRightIcon />}
      />
    </span>
  );
}

function DishStepButton({
  label,
  dish,
  onPress,
  icon,
}: {
  label: string;
  dish: string | null;
  onPress: (dish: string) => void;
  icon: ReactNode;
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      isIconOnly
      aria-label={label}
      isDisabled={dish === null}
      onPress={() => dish && onPress(dish)}
    >
      {icon}
    </Button>
  );
  if (dish === null) return button;
  return (
    <Tooltip delay={0}>
      {button}
      <Tooltip.Content>{dish}</Tooltip.Content>
    </Tooltip>
  );
}

function ReviewButton({ photo }: { photo: ExperimentPhoto }) {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      onPress={() => {
        void router.navigate({
          to: "/review/$model/$digest",
          params: { model: photo.modelId, digest: photo.digest },
          search: { version: photo.modelVersionId },
        });
      }}
    >
      {photo.label ? "Open review" : "Review"}
    </Button>
  );
}

function RetryButton({ photo }: { photo: PhotoRef }) {
  const router = useRouter();
  const action = useAsyncAction();
  return (
    <Button
      variant="secondary"
      isDisabled={action.busy}
      onPress={async () => {
        const result = await action.run(
          () => retryPhotoDetection({ data: photo }),
          "Could not retry detection",
        );
        if (result.ok) await router.invalidate();
      }}
    >
      Try again
    </Button>
  );
}
