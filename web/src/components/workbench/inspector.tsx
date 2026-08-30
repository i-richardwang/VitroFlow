import { Switch, SwitchGroup } from "@heroui/react";
import type { ReactNode } from "react";

import {
  formatReading,
  read,
  type Reading,
  type Tally,
} from "../../models/readings";
import { LAYERS, type LayerKey } from "./controls";

export function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

export interface Metric {
  label: string;
  value: ReactNode;
}

export function Metrics({ rows }: { rows: Metric[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-3"
        >
          <dt className="text-muted">{row.label}</dt>
          <dd className="truncate font-mono font-medium tabular-nums">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One set of instances the readings are taken from. */
export interface ReadingSource {
  label: string;
  tally: Tally;
}

/**
 * The model's readings of the photograph, one column per source, so a
 * reviewer sees what their boxes read against what the version found.
 */
export function ReadingsSection({
  readings,
  sources,
}: {
  readings: Reading[];
  sources: ReadingSource[];
}) {
  return (
    <Section title="Readings">
      <table className="w-full">
        {sources.length > 1 && (
          <thead>
            <tr className="text-xs text-muted">
              <th className="pb-1 text-left font-normal" scope="col">
                <span className="sr-only">Reading</span>
              </th>
              {sources.map((source) => (
                <th
                  key={source.label}
                  className="pb-1 text-right font-normal"
                  scope="col"
                >
                  {source.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {readings.map((reading, index) => (
            <tr key={reading.id}>
              <th
                className="py-0.5 text-left font-normal text-muted"
                scope="row"
              >
                {reading.name}
              </th>
              {sources.map((source) => (
                <td
                  key={source.label}
                  className={`py-0.5 text-right font-mono tabular-nums ${index === 0 ? "font-semibold" : "font-medium"}`}
                >
                  {formatReading(reading, read(reading, source.tally))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function LayersSection({
  layers,
  onLayersChange,
  available = LAYERS.map((layer) => layer.key),
}: {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
  available?: readonly LayerKey[];
}) {
  const toggle = (key: LayerKey, on: boolean) => {
    const next = new Set(layers);
    if (on) {
      next.add(key);
    } else {
      next.delete(key);
    }
    onLayersChange(next);
  };

  return (
    <Section title="Layers">
      <SwitchGroup role="group" aria-label="Layers" className="gap-2">
        {LAYERS.filter((layer) => available.includes(layer.key)).map(
          (layer) => (
            <Switch
              key={layer.key}
              size="sm"
              isSelected={layers.has(layer.key)}
              onChange={(on) => toggle(layer.key, on)}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: layer.color }}
                  />
                  {layer.label}
                </span>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          ),
        )}
      </SwitchGroup>
    </Section>
  );
}
