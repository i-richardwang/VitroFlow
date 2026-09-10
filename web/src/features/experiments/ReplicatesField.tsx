import { Label, NumberField } from "@heroui/react";

import { m } from "../../paraglide/messages";

/** How many replicates a treatment is laid out with when nothing says otherwise. */
export const DEFAULT_REPLICATES = 3;

const MAX_REPLICATES = 200;

/** The number of replicates a treatment is laid out in, never below one. */
export function ReplicatesField({
  busy,
  value,
  onChange,
  className,
  labelled = true,
}: {
  busy: boolean;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  /** A row of a design table carries the label in its header instead. */
  labelled?: boolean;
}) {
  return (
    <NumberField
      className={className}
      variant="secondary"
      minValue={1}
      maxValue={MAX_REPLICATES}
      isDisabled={busy}
      aria-label={labelled ? undefined : m.treatment_replicates_label()}
      value={value}
      onChange={onChange}
    >
      {labelled ? <Label>{m.treatment_replicates_label()}</Label> : null}
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input />
        <NumberField.IncrementButton />
      </NumberField.Group>
    </NumberField>
  );
}
