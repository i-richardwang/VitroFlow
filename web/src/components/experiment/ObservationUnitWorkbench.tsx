import { EmptyState } from "@heroui-pro/react/empty-state";
import { Segment } from "@heroui-pro/react/segment";
import {
  Alert,
  Button,
  ButtonGroup,
  Separator,
  Toolbar,
  Tooltip,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  observationLabel,
  type ObservationImageRef,
} from "../../experiments/schema";
import { cultureEventLabel } from "../../experiments/culture-events";
import { retryObservationImageAnalysis } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type {
  ObservationUnitNavigationEntry,
  ObservationUnitSeries,
} from "../../experiments/contracts";
import { AddToDatasetButton } from "../dataset/AddToDatasetDialog";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { Workbench } from "../Workbench";
import { ImageWorkbench } from "../workbench/ImageWorkbench";
import { Metrics, Section } from "../workbench/inspector";
import { ObservationUnitMenu } from "./ObservationUnitMenu";

export function ObservationUnitWorkbench({
  series,
  datasets,
  editing,
  onEditingChange,
}: {
  series: ObservationUnitSeries;
  datasets: string[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const { experiment, model, observationUnit, treatment, navigation, shown } =
    series;
  const at = navigation.findIndex((item) => item.id === observationUnit.id);
  const title = `Observation unit ${observationUnit.code} of ${experiment.name}`;
  const latestEvent = [...observationUnit.events]
    .reverse()
    .find((event) => event.voidedAt === null);

  const menu = (
    <ObservationUnitMenu
      experiment={experiment.id}
      observationUnit={observationUnit}
      observations={series.observations.map((item) => item.observation)}
      canRemove={
        observationUnit.events.length === 0 &&
        !series.observations.some((item) => item.image)
      }
      image={shown ?? undefined}
      navigation={navigation}
    />
  );
  const toolbar = (
    <>
      <ObservationUnitStepper
        experiment={experiment.id}
        editing={editing}
        previous={navigation[at - 1] ?? null}
        next={navigation[at + 1] ?? null}
      />
      {series.observations.some((item) => item.image) ? <Separator /> : null}
      <ObservationSwitch
        series={series}
        shown={shown?.observation.id ?? null}
      />
    </>
  );

  if (!shown) {
    return (
      <Workbench
        title={title}
        actions={menu}
        toolbar={
          <Toolbar isAttached aria-label="Navigation">
            {toolbar}
          </Toolbar>
        }
      >
        <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Title>No image yet</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        </div>
      </Workbench>
    );
  }

  return (
    <ImageWorkbench
      title={title}
      model={model}
      review={shown.review}
      editing={editing}
      onEditingChange={onEditingChange}
      context={{
        actions: (
          <AddToDatasetButton images={[shown.ref]} datasets={datasets} />
        ),
        menu,
        toolbar,
        details: (
          <Section title="Image">
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
                  value: latestEvent
                    ? cultureEventLabel(latestEvent.type)
                    : "Active",
                },
                { label: "File", value: shown.review.filename },
                { label: "Observed", value: shown.observation.observedOn },
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
        ),
      }}
    />
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
          search: (previous) => ({ ...previous, observation }),
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
  editing,
  previous,
  next,
}: {
  experiment: string;
  /** Stepping while editing opens the next unit's image for editing too. */
  editing: boolean;
  previous: ObservationUnitNavigationEntry | null;
  next: ObservationUnitNavigationEntry | null;
}) {
  const router = useRouter();
  const go = (observationUnit: string) =>
    void router.navigate({
      to: "/experiments/$experiment/$observationUnit",
      params: { experiment, observationUnit },
      search: editing ? { edit: true } : {},
    });
  return (
    <ButtonGroup variant="tertiary">
      <ObservationUnitStepButton
        label="Previous observation unit"
        observationUnit={previous}
        onPress={go}
      >
        <ChevronLeftIcon />
      </ObservationUnitStepButton>
      <ObservationUnitStepButton
        label="Next observation unit"
        observationUnit={next}
        onPress={go}
      >
        <ButtonGroup.Separator />
        <ChevronRightIcon />
      </ObservationUnitStepButton>
    </ButtonGroup>
  );
}

function ObservationUnitStepButton({
  label,
  observationUnit,
  onPress,
  children,
}: {
  label: string;
  observationUnit: ObservationUnitNavigationEntry | null;
  onPress: (observationUnit: string) => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      variant="tertiary"
      isIconOnly
      aria-label={label}
      isDisabled={observationUnit === null}
      onPress={() => observationUnit && onPress(observationUnit.id)}
    >
      {children}
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

function RetryButton({ image }: { image: ObservationImageRef }) {
  const router = useRouter();
  const action = useAsyncAction();
  return (
    <Button
      variant="danger"
      size="sm"
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
