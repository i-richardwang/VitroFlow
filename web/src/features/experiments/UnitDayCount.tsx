import { ImageIcon } from "lucide-react";
import type { ReactElement } from "react";

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
 * asks for attention. `link` wraps what is shown in a way to the photograph.
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
  const reading = imageReading(image, observation);
  if (reading) {
    const notes: string[] = [];
    if (reading.source !== "review") notes.push(m.experiment_cell_unreviewed());
    if (!included) notes.push(m.experiment_cell_excluded());
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
          className={cn("tabular-nums", !included && "line-through")}
        >
          {formatCount(reading.count)}
        </Text>,
      ),
    );
  }
  if (image.state === "failed") {
    return explain(
      image.error ? [image.error] : [],
      link(<Status tone="error">{m.experiment_cell_failed()}</Status>),
    );
  }
  const waiting =
    image.state === "unread"
      ? m.experiment_cell_unread()
      : m.experiment_cell_waiting();
  return explain(
    [waiting],
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
