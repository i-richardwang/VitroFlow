import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { modelName } from "../../ui/model-names";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";

/** What an observation asks of its photographs: one recognition task. */
export function ModelSelect({
  busy,
  models,
  value,
  onChange,
}: {
  busy: boolean;
  models: readonly Model[];
  value: string;
  onChange: (modelId: string) => void;
}) {
  return (
    <Select
      variant="secondary"
      fullWidth
      isRequired
      isDisabled={busy}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Label>{m.observation_model_label()}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {models.map((model) => {
            const name = modelName(model);
            return (
              <ListBox.Item key={model.id} id={model.id} textValue={name}>
                {name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
      <FieldError />
    </Select>
  );
}
