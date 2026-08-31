import type { DateValue } from "@internationalized/date";
import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import type { Experiment } from "../../experiments/schema";
import { DayField } from "./DayField";

type NotebookPage = Pick<
  Experiment,
  "name" | "material" | "explant" | "medium" | "notes"
>;

export function readExperimentFields(form: FormData): NotebookPage {
  const text = (field: string) => String(form.get(field) ?? "");
  return {
    name: text("name"),
    material: text("material"),
    explant: text("explant"),
    medium: text("medium"),
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
          name="material"
          defaultValue={defaults?.material}
        >
          <Label>Material</Label>
          <Input placeholder="Chrysanthemum 'Jinba'" />
          <FieldError />
        </TextField>
        <TextField
          variant="secondary"
          fullWidth
          isDisabled={busy || protocolLocked}
          name="explant"
          defaultValue={defaults?.explant}
        >
          <Label>Explant</Label>
          <Input placeholder="Stem segments" />
          <FieldError />
        </TextField>
      </div>
      <div className="flex w-full gap-3">
        <TextField
          variant="secondary"
          fullWidth
          isDisabled={busy || protocolLocked}
          name="medium"
          defaultValue={defaults?.medium}
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
