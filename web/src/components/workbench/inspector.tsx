import { Switch, SwitchGroup } from "@heroui/react";
import type { ReactNode } from "react";

import {
  formatMetric,
  computeMetric,
  type DerivedMetric,
  type Tally,
} from "../../models/metrics";
import { LAYERS, type LayerKey } from "./controls";

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
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

export interface DerivedMetricSource {
  label: string;
  tally: Tally;
}

export function MetricsSection({
  metrics,
  sources,
}: {
  metrics: DerivedMetric[];
  sources: DerivedMetricSource[];
}) {
  const primary = sources[0];
  if (!primary) return null;

  return (
    <Section title="Metrics">
      <Metrics
        rows={metrics.map((metric) => ({
          label: metric.name,
          value: comparedValue(metric, primary, sources[1]),
        }))}
      />
    </Section>
  );
}

function comparedValue(
  metric: DerivedMetric,
  primary: DerivedMetricSource,
  comparison: DerivedMetricSource | undefined,
): ReactNode {
  const formatted = formatMetric(metric, computeMetric(metric, primary.tally));
  if (!comparison) return formatted;
  const other = formatMetric(metric, computeMetric(metric, comparison.tally));
  if (other === formatted) return formatted;
  return (
    <>
      {formatted}
      <span className="font-sans font-normal text-muted">
        {" "}
        · {comparison.label} {other}
      </span>
    </>
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
