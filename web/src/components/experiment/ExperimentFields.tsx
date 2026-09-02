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
}: {
  busy: boolean;
  defaults?: NotebookPage;
  inoculatedOn: DateValue | null;
  onInoculatedOnChange: (value: DateValue | null) => void;
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
        <Input className="w-full" placeholder="September germination study" />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="plantMaterial"
        defaultValue={defaults?.plantMaterial}
      >
        <Label>Plant material</Label>
        <Input className="w-full" placeholder="Chrysanthemum 'Jinba'" />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="explantType"
        defaultValue={defaults?.explantType}
      >
        <Label>Explant type</Label>
        <Input className="w-full" placeholder="Stem segments" />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="baseMedium"
        defaultValue={defaults?.baseMedium}
      >
        <Label>Base medium</Label>
        <Input className="w-full" placeholder="MS + 3% sucrose, pH 5.8" />
        <FieldError />
      </TextField>
      <DayField
        label="Inoculated"
        busy={busy}
        value={inoculatedOn}
        onChange={onInoculatedOnChange}
      />
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="notes"
        defaultValue={defaults?.notes}
      >
        <Label>Notes</Label>
        <TextArea className="w-full" rows={3} />
        <FieldError />
      </TextField>
    </>
  );
}
