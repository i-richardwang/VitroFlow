import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import type { Experiment } from "../../experiments/schema";

export function readExperimentFields(
  form: FormData,
): Pick<Experiment, "name" | "material" | "explant" | "medium" | "notes"> {
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
}: {
  busy: boolean;
  defaults?: Pick<
    Experiment,
    "name" | "material" | "explant" | "medium" | "notes"
  >;
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
          isDisabled={busy}
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
          isDisabled={busy}
          name="explant"
          defaultValue={defaults?.explant}
        >
          <Label>Explant</Label>
          <Input placeholder="Stem segments" />
          <FieldError />
        </TextField>
      </div>
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="medium"
        defaultValue={defaults?.medium}
      >
        <Label>Base medium</Label>
        <Input placeholder="MS + 3% sucrose, pH 5.8" />
        <FieldError />
      </TextField>
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
