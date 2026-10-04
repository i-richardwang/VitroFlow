import { Link, useRouter } from "@tanstack/react-router";
import { FolderPlus, ImageOff } from "lucide-react";
import { useState } from "react";

import { observationLabel, cultureEventLabel } from "./labels";
import type { ReviewSource } from "../../domain/annotation/schema";
import type { ObservationImageRef } from "../../domain/experiments/schema";
import {
  latestCultureEvent,
  observationOrdinals,
} from "../../domain/experiments/culture-events";
import { retryObservationImageAnalysis } from "../../functions/experiments";
import { useAsyncAction } from "../../ui/hooks/useAsyncAction";
import { Alert } from "../../ui/kit/Alert";
import { Button } from "../../ui/kit/Button";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { ToolbarSeparator } from "../../ui/kit/Toolbar";
import { m } from "../../paraglide/messages";
import type {
  UnitNavigationEntry,
  UnitSeries,
} from "../../domain/experiments/contracts";
import { AddToDatasetDialog } from "../datasets/AddToDatasetDialog";
import { ShellActions } from "../../ui/shell/shell";
import {
  Workbench,
  WorkbenchEmpty,
  WorkbenchSection,
  WorkbenchToolbar,
} from "../../ui/shell/Workbench";
import { StepButton } from "../../ui/StepButton";
import { ImageWorkbench } from "../calibration/ImageWorkbench";
import { UnitMenu } from "./UnitMenu";

export function UnitWorkbench({
  series,
  datasets,
  calibrating,
  source,
  onSourceChange,
  onCalibratingChange,
}: {
  series: UnitSeries;
  datasets: string[];
  calibrating: boolean;
  source?: ReviewSource;
  onSourceChange: (source: ReviewSource) => void;
  onCalibratingChange: (calibrating: boolean) => void;
}) {
  const { experiment, unit, treatments, navigation, shown } = series;
  const [addingToDataset, setAddingToDataset] = useState(false);
  const treatment = treatments.find((item) => item.id === unit.treatment)!;
  const at = navigation.findIndex((item) => item.id === unit.id);
  const title = m.unit_title({
    code: unit.code,
    experiment: experiment.name,
  });
  const latestEvent = latestCultureEvent(
    unit.events,
    observationOrdinals(series.observations.map((item) => item.observation)),
  );

  const menu = (
    <UnitMenu
      experiment={experiment.id}
      unit={unit}
      treatments={treatments}
      observations={series.observations.map((item) => item.observation)}
      canRemove={
        unit.events.length === 0 &&
        !series.observations.some((item) => item.image) &&
        navigation.some(
          (item) => item.treatment === unit.treatment && item.id !== unit.id,
        )
      }
      image={shown}
    />
  );
  const toolbar = (
    <>
      <UnitStepper
        experiment={experiment.id}
        calibrating={calibrating}
        previous={navigation[at - 1] ?? null}
        next={navigation[at + 1] ?? null}
      />
      {series.observations.some((item) => item.image) ? (
        <ToolbarSeparator />
      ) : null}
      <ObservationSwitch
        series={series}
        shown={shown?.observation.id ?? null}
      />
    </>
  );

  if (!shown) {
    return (
      <Workbench title={title}>
        <ShellActions>{menu}</ShellActions>
        <WorkbenchToolbar label={m.unit_navigation()}>
          {toolbar}
        </WorkbenchToolbar>
        <WorkbenchEmpty
          icon={ImageOff}
          title={m.unit_no_image()}
          description={m.unit_no_image_description()}
          action={
            <Button
              render={
                <Link
                  to="/experiments/$experiment"
                  params={{ experiment: experiment.id }}
                />
              }
            >
              {m.unit_open_experiment()}
            </Button>
          }
        />
      </Workbench>
    );
  }

  return (
    <ImageWorkbench
      key={`${shown.model.id}:${shown.review.ref.digest}`}
      title={title}
      model={shown.model}
      review={shown.review}
      calibrating={calibrating}
      source={source}
      onSourceChange={onSourceChange}
      onCalibratingChange={onCalibratingChange}
      context={{
        actions: (
          <>
            <Button icon={FolderPlus} onClick={() => setAddingToDataset(true)}>
              {m.dataset_add_heading()}
            </Button>
            <AddToDatasetDialog
              open={addingToDataset}
              images={[shown.ref]}
              datasets={datasets}
              onClose={() => setAddingToDataset(false)}
            />
          </>
        ),
        menu,
        toolbar,
        details: (
          <WorkbenchSection title={m.unit_image_section()}>
            <Descriptions>
              <DescriptionsItem label={m.treatment_label()}>
                {treatment.name}
              </DescriptionsItem>
              <DescriptionsItem label={m.unit_status()}>
                {latestEvent
                  ? cultureEventLabel(latestEvent.type)
                  : m.culture_status_active()}
              </DescriptionsItem>
              <DescriptionsItem label={m.unit_file()}>
                {shown.review.filename}
              </DescriptionsItem>
              <DescriptionsItem label={m.unit_observed()}>
                {shown.observation.observedOn}
              </DescriptionsItem>
            </Descriptions>
            {shown.failure ? (
              <Alert
                type="error"
                title={m.unit_detection_failed()}
                description={
                  <span
                    className="line-clamp-2 break-all"
                    title={shown.failure.error}
                  >
                    {shown.failure.error}
                  </span>
                }
                action={<RetryButton image={shown.ref} />}
              />
            ) : null}
          </WorkbenchSection>
        ),
      }}
    />
  );
}

function ObservationSwitch({
  series,
  shown,
}: {
  series: UnitSeries;
  shown: string | null;
}) {
  const router = useRouter();
  if (!series.observations.some((item) => item.image)) return null;
  return (
    <ToggleGroup
      aria-label={m.observations_label()}
      value={shown ?? undefined}
      options={series.observations.map((item) => ({
        value: item.observation.id,
        label: observationLabel(item.observation),
        disabled: !item.image,
      }))}
      onChange={(observation) => {
        const item = series.observations.find(
          (entry) => entry.observation.id === observation,
        );
        if (!item?.image) return;
        void router.navigate({
          to: "/experiments/$experiment/$unit",
          params: {
            experiment: series.experiment.id,
            unit: series.unit.id,
          },
          search: (previous) => ({ ...previous, observation }),
        });
      }}
    />
  );
}

function UnitStepper({
  experiment,
  calibrating,
  previous,
  next,
}: {
  experiment: string;
  /** Stepping during calibration opens the next unit's image for calibration too. */
  calibrating: boolean;
  previous: UnitNavigationEntry | null;
  next: UnitNavigationEntry | null;
}) {
  const router = useRouter();
  const go = (unit: string) =>
    void router.navigate({
      to: "/experiments/$experiment/$unit",
      params: { experiment, unit },
      search: calibrating ? { calibrate: true } : {},
    });
  return (
    <>
      <StepButton
        direction="previous"
        label={m.unit_previous()}
        disabled={previous === null}
        onClick={() => previous && go(previous.id)}
      />
      <StepButton
        direction="next"
        label={m.unit_next()}
        disabled={next === null}
        onClick={() => next && go(next.id)}
      />
    </>
  );
}

function RetryButton({ image }: { image: ObservationImageRef }) {
  const router = useRouter();
  const action = useAsyncAction();
  return (
    <Button
      size="small"
      loading={action.busy}
      onClick={async () => {
        const result = await action.run(
          () => retryObservationImageAnalysis({ data: image }),
          m.unit_retry_failed(),
        );
        if (result.ok) await router.invalidate();
      }}
    >
      {m.unit_retry()}
    </Button>
  );
}
