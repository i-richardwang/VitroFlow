import { EyeOff, ImageIcon } from "lucide-react";
import type { ReactElement } from "react";

import type { Exclusion } from "../../domain/experiments/analysis";
import type { ObservationImageCell } from "../../domain/experiments/contracts";
import { imageReading } from "../../domain/experiments/readings";
import type { ExperimentObservation } from "../../domain/experiments/schema";
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
 * asks for attention. A photograph found unclear is marked wherever it is
 * shown, whether or not the experiment counts it; where it does not, its unit
 * is struck through on every day and the mark says which photograph did it.
 * `link` wraps what is shown in a way to the photograph.
 */
export function UnitDayCount({
  image,
  observation,
  exclusion,
  link = (content) => content,
}: {
  image: ObservationImageCell | null | undefined;
  observation: Pick<ExperimentObservation, "countedClasses">;
  /** Why the day stays out of the analysis, or nothing when it enters it. */
  exclusion: Exclusion | null;
  link?: (content: ReactElement) => ReactElement;
}) {
  if (!image) return <Absent />;
  const unclearNote = image.unclear ? [m.unclear_section()] : [];
  const reading = imageReading(image, observation);
  if (reading) {
    const included = exclusion === null;
    const notes: string[] = [...unclearNote];
    if (reading.source !== "review") notes.push(m.experiment_cell_unreviewed());
    if (exclusion) notes.push(exclusionNote(exclusion));
    return explain(
      notes,
      link(
        <Text
          as="span"
          type={
            !included
              ? "quaternary"
              : reading.source === "review"
                ? undefined
                : "tertiary"
          }
          weight={reading.source === "review" ? "medium" : undefined}
          className={cn(
            "inline-flex items-center gap-1 tabular-nums",
            !included && "line-through",
          )}
        >
          {formatCount(reading.count)}
          {image.unclear ? (
            <Icon icon={EyeOff} size={12} aria-label={m.unclear_label()} />
          ) : null}
        </Text>,
      ),
    );
  }
  if (image.state === "failed") {
    return explain(
      [...unclearNote, ...(image.error ? [image.error] : [])],
      link(<Status tone="error">{m.experiment_cell_failed()}</Status>),
    );
  }
  const waiting =
    image.state === "unread"
      ? m.experiment_cell_unread()
      : m.experiment_cell_waiting();
  return explain(
    [...unclearNote, waiting],
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

function exclusionNote(exclusion: Exclusion): string {
  return exclusion.reason === "unclear"
    ? m.experiment_cell_excluded_unclear()
    : m.experiment_cell_excluded_event();
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
