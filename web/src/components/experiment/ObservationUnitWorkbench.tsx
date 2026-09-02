import { EmptyState } from "@heroui-pro/react/empty-state";
import { Segment } from "@heroui-pro/react/segment";
import { Alert, Button, Chip, Toolbar, Tooltip } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import type { AnnotationInstance } from "../../annotation/schema";
import { isCompletedReview } from "../../annotation/status";
import {
  observationLabel,
  type ObservationImageRef,
} from "../../experiments/schema";
import { cultureEventLabel } from "../../experiments/culture-events";
import { retryObservationImageAnalysis } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { tally } from "../../models/metrics";
import type {
  ObservationUnitNavigationEntry,
  ObservationUnitSeries,
  ExperimentObservationImage,
} from "../../experiments/contracts";
import { AddToDatasetButton } from "../dataset/AddToDatasetDialog";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { QualityWarnings } from "../QualityWarnings";
import { Workbench } from "../Workbench";
import { AnnotationCanvas } from "../workbench/AnnotationCanvas";
import type { LayerKey } from "../workbench/controls";
import {
  LayersSection,
  Metrics,
  MetricsSection,
  Section,
} from "../workbench/inspector";
import { ObservationImageMenu } from "./ObservationImageMenu";
import { ImageAnalysisStateChip } from "./ImageAnalysisStateChip";

const DEFAULT_LAYERS: LayerKey[] = ["boxes", "dish"];
const VIEW_LAYERS: LayerKey[] = ["boxes", "ids", "dish"];

export function ObservationUnitWorkbench({
  series,
  datasets,
}: {
  series: ObservationUnitSeries;
  datasets: string[];
}) {
  const { experiment, model, observationUnit, treatment, navigation, shown } =
    series;
  const at = navigation.findIndex((item) => item.id === observationUnit.id);
  const [layers, setLayers] = useState<ReadonlySet<LayerKey>>(
    () => new Set(DEFAULT_LAYERS),
  );
  const detection = shown?.detection ?? null;
  const completedReview =
    shown?.annotation && isCompletedReview(shown.annotation)
      ? shown.annotation
      : null;
  const instances: AnnotationInstance[] =
    completedReview?.instances ??
    detection?.instances.map(({ id, class: className, bbox }) => ({
      id,
      class: className,
      bbox,
    })) ??
    [];
  const latestEvent = [...observationUnit.events]
    .reverse()
    .find((event) => event.voidedAt === null);

  return (
    <Workbench
      title={`Observation unit ${observationUnit.code} of ${experiment.name}`}
      actions={
        shown ? (
          <>
            {detection && <QualityWarnings quality={detection.quality} />}
            {(detection || shown.annotation) && <ReviewButton image={shown} />}
            <AddToDatasetButton images={[shown.ref]} datasets={datasets} />
            <ObservationImageMenu
              image={shown}
              navigation={navigation}
              observations={series.observations.map((item) => item.observation)}
            />
          </>
        ) : undefined
      }
      toolbar={
        <Toolbar
          aria-label="Observation unit and observation"
          className="gap-3 px-3 py-1.5"
        >
          <ObservationUnitStepper
            experiment={experiment.id}
            previous={navigation[at - 1] ?? null}
            next={navigation[at + 1] ?? null}
          />
          {series.observations.length > 0 ? (
            <ObservationSwitch
              series={series}
              shown={shown?.observation.id ?? null}
            />
          ) : null}
        </Toolbar>
      }
      inspector={
        shown ? (
          <>
            {(completedReview || detection) && (
              <MetricsSection
                metrics={model.metrics}
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
              title="Image"
              trailing={
                shown.failure ? null : (
                  <ImageAnalysisStateChip
                    state={detection ? "analyzed" : "pending"}
                  />
                )
              }
            >
              <Metrics
                rows={[
                  {
                    label: "Treatment",
                    value: treatment?.name ?? (
                      <span className="text-muted">No treatment</span>
                    ),
                  },
                  {
                    label: "Status",
                    value: latestEvent ? (
                      <Chip
                        color={
                          latestEvent.type === "contaminated"
                            ? "warning"
                            : "default"
                        }
                        variant="soft"
                        className="font-sans font-normal"
                      >
                        {cultureEventLabel(latestEvent.type)}
                      </Chip>
                    ) : (
                      <Chip variant="soft" className="font-sans font-normal">
                        Active
                      </Chip>
                    ),
                  },
                  { label: "File", value: shown.filename },
                  {
                    label: "Observed",
                    value: shown.observation.observedOn,
                  },
                ]}
              />
              {shown.failure ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Detection failed</Alert.Title>
                    <Alert.Description>{shown.failure.error}</Alert.Description>
                  </Alert.Content>
                  <RetryButton image={shown.ref} />
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
              <EmptyState.Title>No image yet</EmptyState.Title>
              <EmptyState.Description>
                No observation has an image of observation unit{" "}
                {observationUnit.code}.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      )}
    </Workbench>
  );
}

function ObservationSwitch({
  series,
  shown,
}: {
  series: ObservationUnitSeries;
  shown: string | null;
}) {
  const router = useRouter();
  if (!series.observations.some((item) => item.image)) return null;
  return (
    <Segment
      variant="ghost"
      aria-label="Observations"
      selectedKey={shown ?? undefined}
      onSelectionChange={(key) => {
        if (key == null) return;
        const observation = String(key);
        const item = series.observations.find(
          (entry) => entry.observation.id === observation,
        );
        if (!item?.image) return;
        void router.navigate({
          to: "/experiments/$experiment/$observationUnit",
          params: {
            experiment: series.experiment.id,
            observationUnit: series.observationUnit.id,
          },
          search: { observation },
        });
      }}
    >
      {series.observations.map((item) => (
        <Segment.Item
          key={item.observation.id}
          id={item.observation.id}
          isDisabled={!item.image}
        >
          {observationLabel(item.observation)}
        </Segment.Item>
      ))}
    </Segment>
  );
}

function ObservationUnitStepper({
  experiment,
  previous,
  next,
}: {
  experiment: string;
  previous: ObservationUnitNavigationEntry | null;
  next: ObservationUnitNavigationEntry | null;
}) {
  const router = useRouter();
  const go = (observationUnit: string) =>
    void router.navigate({
      to: "/experiments/$experiment/$observationUnit",
      params: { experiment, observationUnit },
    });
  return (
    <span className="flex items-center">
      <ObservationUnitStepButton
        label="Previous observation unit"
        observationUnit={previous}
        onPress={go}
        icon={<ChevronLeftIcon />}
      />
      <ObservationUnitStepButton
        label="Next observation unit"
        observationUnit={next}
        onPress={go}
        icon={<ChevronRightIcon />}
      />
    </span>
  );
}

function ObservationUnitStepButton({
  label,
  observationUnit,
  onPress,
  icon,
}: {
  label: string;
  observationUnit: ObservationUnitNavigationEntry | null;
  onPress: (observationUnit: string) => void;
  icon: ReactNode;
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      isIconOnly
      aria-label={label}
      isDisabled={observationUnit === null}
      onPress={() => observationUnit && onPress(observationUnit.id)}
    >
      {icon}
    </Button>
  );
  if (observationUnit === null) return button;
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger>{button}</Tooltip.Trigger>
      <Tooltip.Content>{observationUnit.code}</Tooltip.Content>
    </Tooltip>
  );
}

function ReviewButton({ image }: { image: ExperimentObservationImage }) {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      onPress={() => {
        void router.navigate({
          to: "/review/$model/$digest",
          params: { model: image.modelId, digest: image.digest },
          search: { version: image.modelVersionId },
        });
      }}
    >
      {image.annotation ? "Open review" : "Review"}
    </Button>
  );
}

function RetryButton({ image }: { image: ObservationImageRef }) {
  const router = useRouter();
  const action = useAsyncAction();
  return (
    <Button
      variant="secondary"
      isDisabled={action.busy}
      onPress={async () => {
        const result = await action.run(
          () => retryObservationImageAnalysis({ data: image }),
          "Could not retry image analysis",
        );
        if (result.ok) await router.invalidate();
      }}
    >
      Try again
    </Button>
  );
}
