import { Alert, Button } from "@heroui/react";

import type { AnnotationDocument } from "../../annotation/schema";
import type { DetectionResult } from "../../detection/schema";
import type { SaveState } from "../../hooks/useAnnotation";
import { tally } from "../../models/metrics";
import { versionSlug, type Model } from "../../models/schema";
import { QualityAlert } from "../DetectionQuality";
import type { LayerKey } from "./controls";
import {
  LayersSection,
  Metrics,
  MetricsSection,
  Section,
  type Metric,
} from "./inspector";

export function InspectorPanel({
  model,
  result,
  annotation,
  layers,
  onLayersChange,
  saveState,
  saveError,
  onRetrySave,
}: {
  model: Model;
  result: DetectionResult;
  annotation: AnnotationDocument;
  layers: ReadonlySet<LayerKey>;
  onLayersChange: (layers: Set<LayerKey>) => void;
  saveState: SaveState;
  saveError: string | null;
  onRetrySave: () => void;
}) {
  return (
    <>
      {saveState === "failed" ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Save failed</Alert.Title>
            {saveError ? (
              <Alert.Description>{saveError}</Alert.Description>
            ) : null}
          </Alert.Content>
          <Button size="sm" variant="danger" onPress={onRetrySave}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {annotation.excludedReason ? (
        <p className="text-sm text-muted">{annotation.excludedReason}</p>
      ) : null}
      <MetricsSection
        metrics={model.metrics}
        sources={[
          { label: "Review", tally: tally(annotation.instances) },
          { label: "Detected", tally: tally(result.instances) },
        ]}
      />
      <LayersSection layers={layers} onLayersChange={onLayersChange} />
      <Section title="Detection">
        <Metrics rows={diagnosticMetrics(model.id, result)} />
        <QualityAlert quality={result.quality} />
      </Section>
    </>
  );
}

function diagnosticMetrics(modelId: string, result: DetectionResult): Metric[] {
  const metrics = result.diagnostics?.metrics;
  const dish = result.diagnostics?.dish;
  const rows: Metric[] = [
    {
      label: "Version",
      value: versionSlug({
        id: result.producer.modelVersionId,
        modelId,
      }),
    },
  ];
  if (metrics?.confidence_threshold !== undefined) {
    rows.push({
      label: "Threshold",
      value: String(metrics.confidence_threshold),
    });
  }
  if (dish) {
    rows.push({
      label: "Petri dish radius",
      value: `${dish.radius.toFixed(0)} px`,
    });
  }
  return rows;
}
