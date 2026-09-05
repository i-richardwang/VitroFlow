import { Alert, Chip } from "@heroui/react";

import type { DetectionQuality } from "../detection/schema";
import { m } from "../paraglide/messages";

const WARNING_LABELS: Record<string, () => string> = {
  dish_detection_failed: m.quality_dish_detection_failed,
  exposure_clipping: m.quality_exposure_clipping,
  low_focus: m.quality_low_focus,
};

function warningLabel(warning: string): string {
  return WARNING_LABELS[warning]?.() ?? warning.replaceAll("_", " ");
}

export function QualityChips({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {quality.warnings.map((warning) => (
        <Chip key={warning} color="warning" variant="soft" size="sm">
          {warningLabel(warning)}
        </Chip>
      ))}
    </span>
  );
}

export function QualityAlert({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {quality.warnings.map(warningLabel).join(" · ")}
        </Alert.Title>
      </Alert.Content>
    </Alert>
  );
}
