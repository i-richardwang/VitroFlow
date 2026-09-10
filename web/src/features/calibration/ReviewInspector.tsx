import type { ReactNode } from "react";

import type { AnnotationInstance } from "../../domain/annotation/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { tally } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { QualityAlert } from "../../ui/DetectionQuality";
import {
  CountsSection,
  LayersSection,
  Metrics,
  Section,
  type Metric,
} from "./inspector";
import type { Display } from "./types";

export function ReviewInspector({
  model,
  instances,
  detection,
  display,
  details,
}: {
  model: Model;
  /** The instances of the review, or of the draft while calibrating. */
  instances: AnnotationInstance[] | null;
  detection: DetectionResult | null;
  display: Display;
  details?: ReactNode;
}) {
  return (
    <>
      <CountsSection
        classes={model.classes}
        sources={[
          ...(instances
            ? [{ label: m.workbench_source_review(), tally: tally(instances) }]
            : []),
          ...(detection
            ? [
                {
                  label: m.workbench_source_detected(),
                  tally: tally(detection.instances),
                },
              ]
            : []),
        ]}
      />
      {details}
      <LayersSection
        layers={display.layers}
        onLayersChange={display.onLayersChange}
      />
      {detection ? (
        <Section title={m.workbench_section_detection()}>
          <Metrics rows={detectionMetrics(detection)} />
          <QualityAlert quality={detection.quality} />
        </Section>
      ) : null}
    </>
  );
}

function detectionMetrics(result: DetectionResult): Metric[] {
  const metrics = result.diagnostics?.metrics;
  const rows: Metric[] = [
    {
      label: m.workbench_detection_version(),
      value: result.producer.modelVersionId,
    },
  ];
  if (metrics?.confidence_threshold !== undefined) {
    rows.push({
      label: m.workbench_detection_threshold(),
      value: String(metrics.confidence_threshold),
    });
  }
  return rows;
}
