import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { modelName, modelVersionName } from "../../ui/model-names";
import type { Model, ModelVersion } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";

/** A version an observation may read with, and the model that gives it meaning. */
export interface ReadableVersion {
  model: Model;
  version: ModelVersion;
}

/** What an observation reads with: one model version. */
export function VersionSelect({
  busy,
  versions,
  value,
  onChange,
}: {
  busy: boolean;
  versions: readonly ReadableVersion[];
  value: string;
  onChange: (modelVersionId: string) => void;
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
      <Label>{m.observation_version_label()}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {versions.map(({ model, version }) => {
            const name = `${modelName(model)} · ${modelVersionName(version)}`;
            return (
              <ListBox.Item key={version.id} id={version.id} textValue={name}>
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
