import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

import { observationLabel } from "./labels";
import type { UnitSeries } from "../../domain/experiments/contracts";
import { m } from "../../paraglide/messages";
import { Empty } from "../../ui/kit/Empty";
import { Select } from "../../ui/kit/Select";
import { Skeleton } from "../../ui/kit/Skeleton";
import { Toolbar } from "../../ui/kit/Toolbar";
import {
  ImageViewport,
  type ViewportLink,
} from "../../ui/viewport/ImageViewport";
import { FILL, type RelativeView } from "../../ui/viewport/viewport";

type UnitObservation = UnitSeries["observations"][number];

/**
 * The day to set beside the day in view at first: the last one the unit was
 * photographed on before it, or else the first after it.
 */
export function referenceDay(
  observations: readonly UnitObservation[],
  inView: string | null,
): string | undefined {
  const at = observations.findIndex((item) => item.observation.id === inView);
  const before = observations.slice(0, Math.max(at, 0)).reverse();
  const after = observations.slice(at + 1);
  return [...before, ...after].find((item) => item.image)?.observation.id;
}

/**
 * Two days of one unit side by side, the reference day on the left and the
 * day in view on the right, each named by the choice of it over its corner.
 * Both photographs are placed by one view, so zooming or panning either
 * shows the same part of the dish in both. The reference is chosen from the
 * days the unit was photographed on.
 */
export function DayComparison({
  reference,
  inView,
  observations,
  pending,
  onReferenceChange,
  onInViewChange,
}: {
  reference: UnitObservation;
  inView: UnitObservation | undefined;
  observations: readonly UnitObservation[];
  /** Another unit is on its way; both photographs stay until it arrives. */
  pending: boolean;
  onReferenceChange: (observation: string) => void;
  onInViewChange: (observation: string) => void;
}) {
  const [view, setView] = useState<RelativeView>(FILL);
  const link: ViewportLink = { view, onChange: setView };
  const options = (
    days: readonly UnitObservation[],
    other: UnitObservation | undefined,
  ) =>
    days.map(({ observation }) => ({
      value: observation.id,
      label: observationLabel(observation),
      disabled: observation.id === other?.observation.id,
    }));
  return (
    <ComparisonFrame
      start={
        <ComparedDay day={reference} link={link} pending={pending}>
          <Select
            aria-label={m.unit_compare_reference()}
            size="small"
            variant="borderless"
            popupWidth="content"
            options={options(
              observations.filter((item) => item.image || item === reference),
              inView,
            )}
            value={reference.observation.id}
            onChange={onReferenceChange}
          />
        </ComparedDay>
      }
      end={
        inView ? (
          <ComparedDay day={inView} link={link} pending={pending}>
            <Select
              aria-label={m.observations_label()}
              size="small"
              variant="borderless"
              popupWidth="content"
              options={options(observations, reference)}
              value={inView.observation.id}
              onChange={onInViewChange}
            />
          </ComparedDay>
        ) : (
          <MissingPhoto />
        )
      }
    />
  );
}

/** A `DayComparison` while its unit is read. */
export function DayComparisonSkeleton() {
  return (
    <ComparisonFrame
      start={<Skeleton aria-hidden height="auto" radius={0} />}
      end={<Skeleton aria-hidden height="auto" radius={0} />}
    />
  );
}

/** The two sides of a comparison: side by side, or one above the other on a phone. */
function ComparisonFrame({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col mobile:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1">{start}</div>
      <div className="relative flex min-h-0 min-w-0 flex-1 border-t mobile:border-t-0 mobile:border-l">
        {end}
      </div>
    </div>
  );
}

/** One day's photograph, with the choice of the day over its corner. */
function ComparedDay({
  day,
  link,
  pending,
  children,
}: {
  day: UnitObservation;
  link: ViewportLink;
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {day.image ? (
        <ImageViewport
          image={day.image}
          filename={day.image.filename}
          link={link}
          pending={pending}
        />
      ) : (
        <MissingPhoto />
      )}
      <Toolbar
        aria-label={observationLabel(day.observation)}
        className="absolute top-3 left-3"
      >
        {children}
      </Toolbar>
    </>
  );
}

function MissingPhoto() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty icon={ImageOff} title={m.unit_no_image_on_day()} />
    </div>
  );
}
