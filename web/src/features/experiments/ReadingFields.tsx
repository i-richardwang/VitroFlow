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
export interface Reading {
  modelVersionId: string;
}

/** The reading a new observation starts from: what the last one read, or the newest version. */
export function defaultReading(
  versions: readonly ReadableVersion[],
  previous: Reading | undefined,
): Reading {
  return previous ?? { modelVersionId: versions[0]!.version.id };
}

export function ReadingFields({
  busy,
  versions,
  value,
  onChange,
}: {
  busy: boolean;
  versions: readonly ReadableVersion[];
  value: Reading;
  onChange: (value: Reading) => void;
}) {
  return (
    <Select
      variant="secondary"
      fullWidth
      isRequired
      isDisabled={busy}
      selectedKey={value.modelVersionId}
      onSelectionChange={(key) => {
        if (key !== null) onChange({ modelVersionId: String(key) });
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
