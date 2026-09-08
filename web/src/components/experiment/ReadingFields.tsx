import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { metricName, modelName, modelVersionName } from "../../models/names";
import {
  primaryMetric,
  type Model,
  type ModelVersion,
} from "../../models/schema";
import { m } from "../../paraglide/messages";

/** A version an observation may read with, and the model that gives it meaning. */
export interface ReadableVersion {
  model: Model;
  version: ModelVersion;
}

/** What an observation reads: a model version and one of its model's metrics. */
export interface Reading {
  modelVersionId: string;
  metric: string;
}

/** The reading a new observation starts from: what the last one read, or the newest version. */
export function defaultReading(
  versions: readonly ReadableVersion[],
  previous: Reading | undefined,
): Reading {
  if (previous) return previous;
  const first = versions[0]!;
  return {
    modelVersionId: first.version.id,
    metric: primaryMetric(first.model).id,
  };
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
  const chosen = versions.find(
    (item) => item.version.id === value.modelVersionId,
  );
  const metrics = chosen?.model.metrics ?? [];
  return (
    <>
      <Select
        variant="secondary"
        fullWidth
        isRequired
        isDisabled={busy}
        selectedKey={value.modelVersionId}
        onSelectionChange={(key) => {
          if (key === null) return;
          const next = versions.find((item) => item.version.id === String(key));
          if (!next) return;
          onChange({
            modelVersionId: next.version.id,
            metric: next.model.metrics.some((item) => item.id === value.metric)
              ? value.metric
              : primaryMetric(next.model).id,
          });
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
      {metrics.length > 1 ? (
        <Select
          variant="secondary"
          fullWidth
          isRequired
          isDisabled={busy}
          selectedKey={value.metric}
          onSelectionChange={(key) => {
            if (key !== null) onChange({ ...value, metric: String(key) });
          }}
        >
          <Label>{m.observation_metric_label()}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {metrics.map((metric) => (
                <ListBox.Item
                  key={metric.id}
                  id={metric.id}
                  textValue={metricName(metric)}
                >
                  {metricName(metric)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
          <FieldError />
        </Select>
      ) : null}
    </>
  );
}
