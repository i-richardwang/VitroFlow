import type { ReactNode } from "react";

import { sourceInstances, type Review } from "../../domain/annotation/review";
import {
  REVIEW_SOURCES,
  type AnnotationInstance,
} from "../../domain/annotation/schema";
import type { DetectionResult } from "../../domain/detection/schema";
import { tally } from "../../domain/models/classes";
import type { Model } from "../../domain/models/schema";
import { m } from "../../paraglide/messages";
import { QualityAlert } from "../../ui/DetectionQuality";
import { formatNumber } from "../../ui/numbers";
import { Descriptions, DescriptionsItem } from "../../ui/kit/Descriptions";
import { WorkbenchSection } from "../../ui/shell/Workbench";
import { CountsSection, LayersSection, type CountSource } from "./inspector";
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
  draft: AnnotationInstance[] | null;
  display: Display;
  details?: ReactNode;
}) {
  const sources: CountSource[] = REVIEW_SOURCES.flatMap((source) => {
    if (source === "review" && draft) {
      return [{ label: m.calibration_source_draft(), tally: tally(draft) }];
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
        <WorkbenchSection title={m.calibration_section_detection()}>
          <DetectionFacts result={review.detection} />
          <QualityAlert quality={review.detection.quality} />
        </WorkbenchSection>
      ) : null}
    </>
  );
}

function DetectionFacts({ result }: { result: DetectionResult }) {
  const threshold = result.diagnostics?.metrics?.confidence_threshold;
  return (
    <Descriptions>
      <DescriptionsItem label={m.calibration_detection_version()}>
        {result.producer.modelVersionId}
      </DescriptionsItem>
      {threshold === undefined ? null : (
        <DescriptionsItem label={m.calibration_detection_threshold()}>
          {formatNumber(threshold)}
        </DescriptionsItem>
      )}
    </Descriptions>
  );
}
