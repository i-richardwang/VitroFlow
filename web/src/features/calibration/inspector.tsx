import { Switch, SwitchGroup } from "@heroui/react";
import type { ReactNode } from "react";

import { count, type Tally } from "../../domain/models/classes";
import { LAYERS, type LayerKey } from "./controls";
import { className } from "../../ui/model-names";
import { formatCount } from "../../ui/readings";
import { m } from "../../paraglide/messages";

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

/** One reading of the same image, named by where its instances came from. */
export interface CountSource {
  label: string;
  tally: Tally;
}

/**
 * What each reading of this image found, per class the model recognizes, with
 * the total when it recognizes more than one.
 */
export function CountsSection({
  classes,
  sources,
}: {
  classes: string[];
  sources: CountSource[];
}) {
  const primary = sources[0];
  if (!primary) return null;
  const rows: { label: string; of: (counts: Tally) => number }[] = [
    ...classes.map((name) => ({
      label: className(name),
      of: (counts: Tally) => counts[name] ?? 0,
    })),
    ...(classes.length > 1
      ? [{ label: m.workbench_count_total(), of: count }]
      : []),
  ];

  return (
    <Section title={m.workbench_section_metrics()}>
      <Metrics
        rows={rows.map((row) => ({
          label: row.label,
          value: comparedCount(row.of, primary, sources[1]),
        }))}
      />
    </Section>
  );
}

function comparedCount(
  of: (counts: Tally) => number,
  primary: CountSource,
  comparison: CountSource | undefined,
): ReactNode {
  const formatted = formatCount(of(primary.tally));
  if (!comparison) return formatted;
  const other = formatCount(of(comparison.tally));
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
}: {
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
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
    <Section title={m.workbench_section_layers()}>
      <SwitchGroup
        role="group"
        aria-label={m.workbench_section_layers()}
        className="gap-2"
      >
        {LAYERS.map((layer) => (
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
                {layer.label()}
              </span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        ))}
      </SwitchGroup>
    </Section>
  );
}
