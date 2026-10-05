import { Link, useRouter } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";

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
import { DescriptionsItem } from "../../ui/kit/Descriptions";
import { StatusDot, type StatusTone } from "../../ui/kit/Status";
import { ToggleGroup } from "../../ui/kit/ToggleGroup";
import { Day } from "../../ui/Day";
import { m } from "../../paraglide/messages";
import type {
  ImageReview,
  UnitSeries,
  UnitStep,
} from "../../domain/experiments/contracts";
import { imageReview } from "../../domain/experiments/readings";
import { ShellActions } from "../../ui/shell/Shell";
import {
  Workbench,
  WorkbenchEmpty,
  WorkbenchFooter,
  WorkbenchSection,
} from "../../ui/shell/Workbench";
import { Stepper } from "../../ui/Stepper";
import { ImageWorkbench } from "../annotation/ImageWorkbench";
import { useStepKeys } from "../annotation/keys";
import { CultureMenu, UnitMenu } from "./UnitMenu";

/**
 * One unit's photograph on one observation day. The footer steps along both
 * of the grid's axes: through the units on the same day, the way a day's
 * photographs are reviewed, and through the days of the same unit, the way a
 * dish is followed over time. Confirming a review moves on to the next unit
 * still to review that day.
 */
export function UnitWorkbench({
  series,
  datasets,
  source,
  onSourceChange,
}: {
  series: UnitSeries;
  datasets: string[];
  source?: ReviewSource;
  onSourceChange: (source: ReviewSource | undefined) => void;
}) {
  const { experiment, unit, treatments, navigation, shown } = series;
  const router = useRouter();
  const treatment = treatments.find((item) => item.id === unit.treatment)!;
  const at = navigation.findIndex((item) => item.id === unit.id);
  const title = m.unit_title({
    code: unit.code,
    experiment: experiment.name,
  });
  const observations = series.observations.map((item) => item.observation);
  const latestEvent = latestCultureEvent(
    unit.events,
    observationOrdinals(observations),
  );

  const toUnit = (target: UnitStep | undefined) =>
    target
      ? () =>
          void router.navigate({
            to: "/experiments/$experiment/$unit",
            params: { experiment: experiment.id, unit: target.id },
            search: { observation: series.observation ?? undefined },
          })
      : undefined;
  const dayAt = observations.findIndex(
    (item) => item.id === series.observation,
  );
  const toDay = (observation: string | undefined) =>
    observation
      ? () =>
          void router.navigate({
            to: "/experiments/$experiment/$unit",
            params: { experiment: experiment.id, unit: unit.id },
            search: { observation },
          })
      : undefined;
  const previousUnit = toUnit(navigation[at - 1]);
  const nextUnit = toUnit(navigation[at + 1]);
  const toReview = [
    ...navigation.slice(at + 1),
    ...navigation.slice(0, at),
  ].filter((item) => item.image === "unreviewed");
  useStepKeys({
    ArrowLeft: previousUnit,
    ArrowRight: nextUnit,
    ArrowUp: toDay(observations[dayAt - 1]?.id),
    ArrowDown: toDay(observations[dayAt + 1]?.id),
  });

  const menu = (
    <UnitMenu
      experiment={experiment.id}
      unit={unit}
      treatments={treatments}
      canRemove={
        unit.events.length === 0 &&
        !series.observations.some((item) => item.image) &&
        navigation.some(
          (item) => item.treatment === unit.treatment && item.id !== unit.id,
        )
      }
      image={shown}
      datasets={datasets}
    />
  );
  const steps = (
    <WorkbenchFooter label={m.unit_steps()}>
      <Stepper
        previous={{ label: m.unit_previous(), onClick: previousUnit }}
        next={{ label: m.unit_next(), onClick: nextUnit }}
      >
        {m.ui_step_position({ index: at + 1, total: navigation.length })}
      </Stepper>
      {toReview.length > 0 ? (
        <span className="text-sm whitespace-nowrap text-fg-tertiary">
          {m.unit_unreviewed_count({ count: toReview.length })}
        </span>
      ) : null}
      <span className="flex-1" />
      {series.observations.length > 0 ? (
        <ToggleGroup
          aria-label={m.observations_label()}
          value={series.observation ?? undefined}
          options={series.observations.map(({ observation, image }) => ({
            value: observation.id,
            label: observationLabel(observation),
            mark: image ? <ReviewDot review={imageReview(image)} /> : undefined,
          }))}
          onChange={(observation) => toDay(observation)?.()}
        />
      ) : null}
    </WorkbenchFooter>
  );
  const culture = (
    <WorkbenchSection title={m.unit_culture_status()}>
      <div className="flex">
        <CultureMenu
          experiment={experiment.id}
          unit={unit}
          observations={observations}
          status={
            latestEvent
              ? cultureEventLabel(latestEvent.type)
              : m.culture_status_active()
          }
        />
      </div>
    </WorkbenchSection>
  );

  if (!shown) {
    // A day in view is one this unit was not photographed on; without one,
    // it has not been photographed at all.
    const missing = series.observation
      ? {
          title: m.unit_no_image_on_day(),
          description: m.unit_no_image_on_day_description(),
        }
      : {
          title: m.unit_no_image(),
          description: m.unit_no_image_description(),
        };
    return (
      <Workbench title={title}>
        <ShellActions>{menu}</ShellActions>
        {steps}
        <WorkbenchEmpty
          icon={ImageOff}
          title={missing.title}
          description={missing.description}
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
      source={source}
      onSourceChange={onSourceChange}
      onNext={toUnit(toReview[0])}
      context={{
        menu,
        steps,
        alert: shown.failure ? (
          <Alert
            type="error"
            title={m.unit_detection_failed()}
            detail={shown.failure.error}
            action={<RetryButton image={shown.ref} />}
          />
        ) : undefined,
        sections: culture,
        facts: (
          <>
            <DescriptionsItem label={m.treatment_label()}>
              {treatment.name}
            </DescriptionsItem>
            <DescriptionsItem label={m.unit_observed()}>
              <Day value={shown.observation.observedOn} />
            </DescriptionsItem>
          </>
        ),
      }}
    />
  );
}

const REVIEW_DOTS: Record<
  ImageReview,
  { tone: StatusTone; label: () => string }
> = {
  reviewed: { tone: "success", label: m.annotation_standing_reviewed },
  unreviewed: { tone: "neutral", label: m.annotation_standing_unreviewed },
};

function ReviewDot({ review }: { review: ImageReview }) {
  const { tone, label } = REVIEW_DOTS[review];
  return <StatusDot tone={tone} label={label()} />;
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
