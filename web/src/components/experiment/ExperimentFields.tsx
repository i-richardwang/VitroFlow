import type { DateValue } from "@internationalized/date";
import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import type { Experiment } from "../../experiments/schema";
import { DayField } from "./DayField";

type NotebookPage = Pick<
  Experiment,
  "name" | "plantMaterial" | "explantType" | "baseMedium" | "notes"
>;

export function readExperimentFields(form: FormData): NotebookPage {
  const text = (field: string) => String(form.get(field) ?? "");
  return {
    name: text("name"),
    plantMaterial: text("plantMaterial"),
    explantType: text("explantType"),
    baseMedium: text("baseMedium"),
    notes: text("notes"),
  };
}

export function ExperimentFields({
  busy,
  defaults,
  inoculatedOn,
  onInoculatedOnChange,
  protocolLocked = false,
}: {
  busy: boolean;
  defaults?: NotebookPage;
  inoculatedOn: DateValue | null;
  onInoculatedOnChange: (value: DateValue | null) => void;
  protocolLocked?: boolean;
}) {
  return (
    <>
      <TextField
        variant="secondary"
        fullWidth
        isRequired
        isDisabled={busy}
        name="name"
        defaultValue={defaults?.name}
      >
        <Label>Name</Label>
        <Input placeholder="September germination study" />
        <FieldError />
      </TextField>
      <div className="flex w-full gap-3">
        <TextField
          variant="secondary"
          fullWidth
          isDisabled={busy || protocolLocked}
          name="plantMaterial"
          defaultValue={defaults?.plantMaterial}
        >
          <Label>Plant material</Label>
          <Input placeholder="Chrysanthemum 'Jinba'" />
          <FieldError />
        </TextField>
        <TextField
          variant="secondary"
          fullWidth
          isDisabled={busy || protocolLocked}
          name="explantType"
          defaultValue={defaults?.explantType}
        >
          <Label>Explant type</Label>
          <Input placeholder="Stem segments" />
          <FieldError />
        </TextField>
      </div>
      <div className="flex w-full gap-3">
        <TextField
          variant="secondary"
          fullWidth
          isDisabled={busy || protocolLocked}
          name="baseMedium"
          defaultValue={defaults?.baseMedium}
        >
          <Label>Base medium</Label>
          <Input placeholder="MS + 3% sucrose, pH 5.8" />
          <FieldError />
        </TextField>
        <div className="w-52 shrink-0">
          <DayField
            label="Inoculated"
            busy={busy || protocolLocked}
            value={inoculatedOn}
            onChange={onInoculatedOnChange}
          />
        </div>
      </div>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="notes"
        defaultValue={defaults?.notes}
      >
        <Label>Notes</Label>
        <TextArea
          className="w-full"
          rows={3}
          placeholder="Conditions, goals, and anything else the notebook keeps"
        />
        <FieldError />
      </TextField>
    </>
  );
}
