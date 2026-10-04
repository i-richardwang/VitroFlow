import type { ReactNode } from "react";

import { classCount, count, type Tally } from "../../domain/models/classes";
import { m } from "../../paraglide/messages";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { Switch } from "../../ui/kit/Switch";
import { formatCount } from "../../ui/numbers";
import { WorkbenchSection } from "../../ui/shell/Workbench";
import { ClassLabel, LAYERS, type LayerKey } from "./controls";

/** One reading of the same image, named by where its instances came from. */
export interface CountSource {
  label: string;
  tally: Tally;
}

/** Values side by side in equal columns, so the columns of stacked rows line up. */
function Columns({ children }: { children: ReactNode }) {
  return (
    <span className="grid auto-cols-fr grid-flow-col gap-3 text-end tabular-nums">
      {children}
    </span>
  );
}

/**
 * What each reading of this image found, per class the model recognizes, with
 * the total when it recognizes more than one. Readings sit side by side, best
 * first, under their names when there is more than one.
 */
export function CountsSection({
  classes,
  sources,
}: {
  classes: string[];
  sources: CountSource[];
}) {
  if (!sources.length) return null;
  const rows: {
    key: string;
    label: ReactNode;
    of: (counts: Tally) => number;
  }[] = [
    ...classes.map((name) => ({
      key: name,
      label: <ClassLabel classes={classes} name={name} />,
      of: (counts: Tally) => classCount(counts, name),
    })),
    ...(classes.length > 1
      ? [{ key: "total", label: m.calibration_count_total(), of: count }]
      : []),
  ];
  return (
    <WorkbenchSection title={m.calibration_section_metrics()}>
      <Descriptions>
        {sources.length > 1 ? (
          <DescriptionsItem label={null}>
            <Columns>
              {sources.map((source) => (
                <span
                  key={source.label}
                  className="truncate text-xs text-fg-secondary"
                >
                  {source.label}
                </span>
              ))}
            </Columns>
          </DescriptionsItem>
        ) : null}
        {rows.map((row) => (
          <DescriptionsItem key={row.key} label={row.label}>
            <Columns>
              {sources.map((source) => (
                <span key={source.label}>
                  {formatCount(row.of(source.tally))}
                </span>
              ))}
            </Columns>
          </DescriptionsItem>
        ))}
      </Descriptions>
    </WorkbenchSection>
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
    <WorkbenchSection title={m.calibration_section_layers()}>
      <fieldset aria-label={m.calibration_section_layers()} className="min-w-0">
        {LAYERS.map((layer) => (
          <label
            key={layer.key}
            className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm"
          >
            {layer.label()}
            <Switch
              size="small"
              checked={layers.has(layer.key)}
              onChange={(on) => toggle(layer.key, on)}
            />
          </label>
        ))}
      </fieldset>
    </WorkbenchSection>
  );
}
