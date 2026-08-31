import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import type { Experiment } from "../../experiments/schema";

export function ExperimentFields({
  busy,
  defaults,
}: {
  busy: boolean;
  defaults?: Pick<Experiment, "name" | "description">;
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
      <TextField
        variant="secondary"
        fullWidth
        isDisabled={busy}
        name="description"
        defaultValue={defaults?.description}
      >
        <Label>Description</Label>
        <TextArea
          className="w-full"
          rows={3}
          placeholder="Species, explant, medium, and conditions the dishes share"
        />
        <FieldError />
      </TextField>
    </>
  );
}
