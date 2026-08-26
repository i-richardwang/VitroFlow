import {
  Button,
  Header,
  Label,
  Separator,
  Switch,
  SwitchGroup,
} from "@heroui/react";

import type { AnnotationDocument, SeedInstance } from "../../annotation/schema";
import type { SeedResult } from "../../detection/schema";
import { LAYERS, type LayerKey } from "./controls";

interface Metric {
  label: string;
  value: string;
}

export function InspectorPanel({
  result,
  annotation,
  layers,
  onLayersChange,
  selected,
  onDeleteSelected,
}: {
  result: SeedResult;
  annotation: AnnotationDocument;
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
  selected: SeedInstance | null;
  onDeleteSelected: () => void;
}) {
  const toggleLayer = (key: LayerKey, on: boolean) => {
    const next = new Set(layers);
    if (on) {
      next.add(key);
    } else {
      next.delete(key);
    }
    onLayersChange(next);
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-surface">
      <Section title="Layers">
        <SwitchGroup aria-label="Layers" className="gap-2">
          {LAYERS.map((layer) => (
            <Switch
              key={layer.key}
              size="sm"
              isSelected={layers.has(layer.key)}
              onChange={(on) => toggleLayer(layer.key, on)}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                <Label className="flex items-center gap-2">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: layer.color }}
                  />
                  {layer.label}
                </Label>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          ))}
        </SwitchGroup>
      </Section>

      <Separator />
      <Section
        title="Instances"
        trailing={
          selected && (
            <Button variant="danger-soft" size="sm" onPress={onDeleteSelected}>
              Delete
            </Button>
          )
        }
      >
        <Metrics rows={instanceMetrics(annotation, selected)} />
      </Section>

      <Separator />
      <Section title="Diagnostics">
        <Metrics rows={diagnosticMetrics(result)} />
      </Section>
    </aside>
  );
}

function instanceMetrics(
  annotation: AnnotationDocument,
  selected: SeedInstance | null,
): Metric[] {
  const count = {
    label: "Count",
    value: String(annotation.instances.length),
  };
  if (!selected) {
    return [count, { label: "Selected", value: "—" }];
  }
  return [
    count,
    {
      label: "Selected",
      value: `#${annotation.instances.indexOf(selected) + 1}`,
    },
    { label: "x", value: selected.bbox.x.toFixed(1) },
    { label: "y", value: selected.bbox.y.toFixed(1) },
    { label: "Width", value: selected.bbox.width.toFixed(1) },
    { label: "Height", value: selected.bbox.height.toFixed(1) },
  ];
}

function diagnosticMetrics(result: SeedResult): Metric[] {
  return [
    { label: "Detections", value: String(result.count) },
    {
      label: "Threshold",
      value: String(result.config.decision.confidence_threshold),
    },
    { label: "Model", value: result.model.name },
    { label: "Focus score", value: String(result.quality.focus_score) },
    { label: "Clipped", value: result.quality.clipped_fraction.toFixed(4) },
    { label: "Dish radius", value: `${result.dish.radius.toFixed(0)} px` },
  ];
}

function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <div className="mb-2.5 flex h-6 items-center justify-between">
        <Header className="p-0">{title}</Header>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function Metrics({ rows }: { rows: Metric[] }) {
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
