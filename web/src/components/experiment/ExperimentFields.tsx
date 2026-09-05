import type { DateValue } from "@internationalized/date";
import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import type { Experiment } from "../../experiments/schema";
import { m } from "../../paraglide/messages";
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
        <Label>{m.experiment_field_name()}</Label>
        <Input
          className="w-full"
          placeholder={m.experiment_field_name_placeholder()}
        />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="plantMaterial"
        defaultValue={defaults?.plantMaterial}
      >
        <Label>{m.experiment_field_plant_material()}</Label>
        <Input
          className="w-full"
          placeholder={m.experiment_field_plant_material_placeholder()}
        />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="explantType"
        defaultValue={defaults?.explantType}
      >
        <Label>{m.experiment_field_explant_type()}</Label>
        <Input
          className="w-full"
          placeholder={m.experiment_field_explant_type_placeholder()}
        />
        <FieldError />
      </TextField>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="baseMedium"
        defaultValue={defaults?.baseMedium}
      >
        <Label>{m.experiment_field_base_medium()}</Label>
        <Input
          className="w-full"
          placeholder={m.experiment_field_base_medium_placeholder()}
        />
        <FieldError />
      </TextField>
      <DayField
        label={m.experiment_field_inoculated()}
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
        <Label>{m.experiment_field_notes()}</Label>
        <TextArea className="w-full" rows={3} />
        <FieldError />
      </TextField>
    </>
  );
}
