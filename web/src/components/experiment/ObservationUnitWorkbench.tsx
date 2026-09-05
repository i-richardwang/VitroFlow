import { EmptyState } from "@heroui-pro/react/empty-state";
import { Segment } from "@heroui-pro/react/segment";
import { Alert, Button, ButtonGroup, Separator } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import {
  observationLabel,
  type ObservationImageRef,
} from "../../experiments/schema";
import {
  cultureEventLabel,
  latestCultureEvent,
  observationOrdinals,
} from "../../experiments/culture-events";
import { retryObservationImageAnalysis } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import type {
  ObservationUnitNavigationEntry,
  ObservationUnitSeries,
} from "../../experiments/contracts";
import { AddToDatasetButton } from "../dataset/AddToDatasetDialog";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { Workbench, WorkbenchActions, WorkbenchToolbar } from "../Workbench";
import { ImageWorkbench } from "../workbench/ImageWorkbench";
import { StepButton } from "../workbench/StepButton";
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
  const title = m.observation_unit_title({
    code: observationUnit.code,
    experiment: experiment.name,
  });
  const latestEvent = latestCultureEvent(
    observationUnit.events,
    observationOrdinals(series.observations.map((item) => item.observation)),
  );

  const menu = (
    <ObservationUnitMenu
      experiment={experiment.id}
      observationUnit={observationUnit}
      observations={series.observations.map((item) => item.observation)}
      canRemove={
        observationUnit.events.length === 0 &&
        !series.observations.some((item) => item.image)
      }
      image={shown}
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
      <Workbench title={title}>
        <WorkbenchActions>{menu}</WorkbenchActions>
        <WorkbenchToolbar label={m.observation_unit_navigation()}>
          {toolbar}
        </WorkbenchToolbar>
        <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Title>
                {m.observation_unit_no_image()}
              </EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        </div>
      </Workbench>
    );
  }

  return (
    <ImageWorkbench
      key={shown.review.ref.digest}
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
          <Section title={m.observation_unit_image_section()}>
            <Metrics
              rows={[
                {
                  label: m.treatment_label(),
                  value: treatment?.name ?? (
                    <span className="text-muted">{m.treatment_none()}</span>
                  ),
                },
                {
                  label: m.observation_unit_status(),
                  value: latestEvent
                    ? cultureEventLabel(latestEvent.type)
                    : m.culture_status_active(),
                },
                {
                  label: m.observation_unit_file(),
                  value: shown.review.filename,
                },
                {
                  label: m.observation_unit_observed(),
                  value: shown.observation.observedOn,
                },
              ]}
            />
            {shown.failure ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>
                    {m.observation_unit_detection_failed()}
                  </Alert.Title>
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
      aria-label={m.observations_label()}
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
      <StepButton
        label={m.observation_unit_previous()}
        neighbour={previous?.code ?? null}
        onPress={() => previous && go(previous.id)}
      >
        <ChevronLeftIcon />
      </StepButton>
      <StepButton
        label={m.observation_unit_next()}
        neighbour={next?.code ?? null}
        onPress={() => next && go(next.id)}
      >
        <ButtonGroup.Separator />
        <ChevronRightIcon />
      </StepButton>
    </ButtonGroup>
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
          m.observation_unit_retry_failed(),
        );
        if (result.ok) await router.invalidate();
      }}
    >
      {m.observation_unit_retry()}
    </Button>
  );
}
