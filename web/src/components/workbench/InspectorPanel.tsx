import { Button } from "@heroui/react";

import type {
  AnnotationDocument,
  LabelInstance,
} from "../../annotation/schema";
import type { DetectionResult } from "../../detection/schema";
import { tally } from "../../models/readings";
import { versionSlug, type Model } from "../../models/schema";
import type { LayerKey } from "./controls";
import {
  LayersSection,
  Metrics,
  ReadingsSection,
  Section,
  type Metric,
} from "./inspector";

export function InspectorPanel({
  model,
  result,
  annotation,
  layers,
  onLayersChange,
  selected,
  onDeleteSelected,
}: {
  model: Model;
  result: DetectionResult;
  annotation: AnnotationDocument;
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
  selected: LabelInstance | null;
  onDeleteSelected: () => void;
}) {
  return (
    <>
      <ReadingsSection
        readings={model.readings}
        sources={[
          { label: "Review", tally: tally(annotation.instances) },
          { label: "Detected", tally: tally(result.instances) },
        ]}
      />
      <LayersSection layers={layers} onLayersChange={onLayersChange} />
      <Section
        title="Selection"
        trailing={
          selected && (
            <Button variant="danger-soft" size="sm" onPress={onDeleteSelected}>
              Delete
            </Button>
          )
        }
      >
        <Metrics rows={selectionMetrics(annotation, selected)} />
      </Section>
      <Section title="Diagnostics">
        <Metrics rows={diagnosticMetrics(model.id, result)} />
      </Section>
    </>
  );
}

function selectionMetrics(
  annotation: AnnotationDocument,
  selected: LabelInstance | null,
): Metric[] {
  const rows: Metric[] = [
    {
      label: "Selected",
      value: selected ? `#${annotation.instances.indexOf(selected) + 1}` : "—",
    },
  ];
  if (annotation.status === "excluded") {
    rows.push({
      label: "Excluded",
      value: annotation.excludedReason ?? "—",
    });
  }
  if (selected) {
    rows.push(
      { label: "Class", value: selected.class },
      { label: "x", value: selected.bbox.x.toFixed(1) },
      { label: "y", value: selected.bbox.y.toFixed(1) },
      { label: "Width", value: selected.bbox.width.toFixed(1) },
      { label: "Height", value: selected.bbox.height.toFixed(1) },
    );
  }
  return rows;
}

function diagnosticMetrics(modelId: string, result: DetectionResult): Metric[] {
  const metrics = result.diagnostics?.metrics;
  const dish = result.diagnostics?.dish;
  return [
    {
      label: "Threshold",
      value: String(metrics?.confidence_threshold ?? "—"),
    },
    {
      label: "Version",
      value: versionSlug({
        id: result.producer.modelVersionId,
        modelId,
      }),
    },
    { label: "Focus score", value: String(metrics?.focus_score ?? "—") },
    {
      label: "Clipped",
      value:
        metrics?.clipped_fraction === undefined
          ? "—"
          : metrics.clipped_fraction.toFixed(4),
    },
    {
      label: "Dish radius",
      value: dish ? `${dish.radius.toFixed(0)} px` : "—",
    },
  ];
}
