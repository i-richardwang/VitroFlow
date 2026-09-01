import { EmptyState } from "@heroui-pro/react/empty-state";
import { Alert, Button, Link, Toolbar, Tooltip } from "@heroui/react";
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
import { versionSlug } from "../../models/schema";
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
  const {
    experiment,
    model,
    version,
    observationUnit,
    treatment,
    navigation,
    shown,
  } = series;
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
          <ObservationTabs
            series={series}
            shown={shown?.observation.id ?? null}
          />
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
                      <span className="text-muted">None</span>
                    ),
                  },
                  {
                    label: "Observation unit",
                    value: latestEvent ? (
                      <span className="text-warning">
                        {cultureEventLabel(latestEvent.type)}
                      </span>
                    ) : (
                      "Active"
                    ),
                  },
                  { label: "File", value: shown.filename },
                  {
                    label: "Observation date",
                    value: `${observationLabel(shown.observation)} · ${shown.observation.observedOn}`,
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

function ObservationTabs({
  series,
  shown,
}: {
  series: ObservationUnitSeries;
  shown: string | null;
}) {
  const base = `/experiments/${series.experiment.id}/${series.observationUnit.id}`;
  return (
    <nav aria-label="Observations" className="flex items-center gap-1">
      {series.observations.map((item) => {
        const selected = shown === item.observation.id;
        const className = `rounded-lg px-3 py-1.5 text-sm no-underline ${
          selected
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted hover:bg-default"
        }`;
        return item.image ? (
          <Link
            key={item.observation.id}
            href={`${base}?observation=${item.observation.id}`}
            aria-current={selected ? "page" : undefined}
            className={className}
          >
            {observationLabel(item.observation)}
          </Link>
        ) : (
          <span
            key={item.observation.id}
            aria-disabled="true"
            className={`${className} cursor-not-allowed opacity-40`}
          >
            {observationLabel(item.observation)}
          </span>
        );
      })}
    </nav>
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
      {button}
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
