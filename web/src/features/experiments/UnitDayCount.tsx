import { EyeOff, ImageIcon } from "lucide-react";
import type { ReactElement } from "react";

import type { ObservationImageCell } from "../../domain/experiments/contracts";
import { imageReading } from "../../domain/experiments/readings";
import type { ExperimentObservation } from "../../domain/experiments/schema";
import { numberTrusted, type UnclearMark } from "../../domain/images/unclear";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { cn } from "../../ui/kit/cn";
import { Icon } from "../../ui/kit/Icon";
import { Status } from "../../ui/kit/Status";
import { Text } from "../../ui/kit/Text";
import { Tooltip } from "../../ui/kit/Tooltip";
import { formatCount } from "../../ui/numbers";

/**
 * A unit's count on one day, or why there is none, read alike wherever the
 * day is shown. A count nobody has reviewed yet is shown provisional and one
 * left out of the analysis struck through; a photograph not yet counted
 * shows as a photograph, no photograph as absent, and only a failed count
 * asks for attention. A photograph found unclear keeps its number in view:
 * struck through when it is not counted, marked when it is counted anyway.
 * `link` wraps what is shown in a way to the photograph.
 */
export function UnitDayCount({
  image,
  observation,
  included,
  link = (content) => content,
}: {
  image: ObservationImageCell | null | undefined;
  observation: Pick<ExperimentObservation, "countedClasses">;
  /** Whether the day's count enters the analysis. */
  included: boolean;
  link?: (content: ReactElement) => ReactElement;
}) {
  if (!image) return <Absent />;
  const unclear = unclearNotes(image.unclear);
  const reading = imageReading(image, observation);
  if (reading) {
    const trusted = included && numberTrusted(image.unclear);
    const notes: string[] = [...unclear];
    if (reading.source !== "review") notes.push(m.experiment_cell_unreviewed());
    if (!included) notes.push(m.experiment_cell_excluded());
    return explain(
      notes,
      link(
        <Text
          as="span"
          type={
            !trusted
              ? "quaternary"
              : reading.source === "review"
                ? undefined
                : "tertiary"
          }
          weight={reading.source === "review" ? "medium" : undefined}
          className={cn(
            "inline-flex items-center gap-1 tabular-nums",
            !trusted && "line-through",
          )}
        >
          {formatCount(reading.count)}
          {image.unclear?.counted ? (
            <Icon icon={EyeOff} size={12} aria-label={m.unclear_counted()} />
          ) : null}
        </Text>,
      ),
    );
  }
  if (image.state === "failed") {
    return explain(
      [...unclear, ...(image.error ? [image.error] : [])],
      link(<Status tone="error">{m.experiment_cell_failed()}</Status>),
    );
  }
  const waiting =
    image.state === "unread"
      ? m.experiment_cell_unread()
      : m.experiment_cell_waiting();
  return explain(
    [...unclear, waiting],
    link(
      <Text as="span" type="tertiary">
        <Icon
          icon={ImageIcon}
          size={14}
          aria-label={waiting}
          className="align-middle"
        />
      </Text>,
    ),
  );
}

/** What a count says of its photograph's unclear mark: the verdict, then the note. */
function unclearNotes(mark: UnclearMark | null): string[] {
  if (!mark) return [];
  return [
    mark.counted ? m.unclear_counted() : m.unclear_not_counted(),
    ...(mark.note ? [mark.note] : []),
  ];
}

/** A count's notes, one per line, in a tooltip over it. */
function explain(notes: readonly string[], control: ReactElement) {
  if (notes.length === 0) return control;
  return (
    <Tooltip
      title={
        <span className="flex max-w-xs flex-col">
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </span>
      }
    >
      {control}
    </Tooltip>
  );
}
