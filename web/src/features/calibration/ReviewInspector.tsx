import type { ReactNode } from "react";

import {
  sourceInstances,
  REVIEW_SOURCES,
  type Review,
} from "../../domain/annotation/review";
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
  type CountSource,
  type Metric,
} from "./inspector";
import { sourceLabels } from "./labels";
import type { Display } from "./types";

export function ReviewInspector({
  model,
  review,
  draft,
  display,
  details,
}: {
  model: Model;
  review: Review;
  /** The instances being calibrated, which stand in for the stored review. */
  draft: AnnotationInstance[] | null;
  display: Display;
  details?: ReactNode;
}) {
  const sources: CountSource[] = REVIEW_SOURCES.flatMap((source) => {
    if (source === "review" && draft) {
      return [{ label: m.workbench_source_draft(), tally: tally(draft) }];
    }
    const instances = sourceInstances(review, source);
    return instances
      ? [{ label: sourceLabels[source](), tally: tally(instances) }]
      : [];
  });
  return (
    <>
      <CountsSection classes={model.classes} sources={sources} />
      {details}
      <LayersSection
        layers={display.layers}
        onLayersChange={display.onLayersChange}
      />
      {review.detection ? (
        <Section title={m.workbench_section_detection()}>
          <Metrics rows={detectionMetrics(review.detection)} />
          <QualityAlert quality={review.detection.quality} />
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
