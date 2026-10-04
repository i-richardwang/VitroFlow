import type { DetectionQuality } from "../domain/detection/schema";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import { Alert } from "./kit/Alert";
import { Flexbox } from "./kit/Flex";
import { Tag } from "./kit/Tag";

const WARNING_LABELS: ReadonlyMap<string, () => string> = new Map([
  ["dish_detection_failed", m.quality_dish_detection_failed],
  ["exposure_clipping", m.quality_exposure_clipping],
  ["low_focus", m.quality_low_focus],
]);

function warningLabel(warning: string): string {
  return WARNING_LABELS.get(warning)?.() ?? warning.replaceAll("_", " ");
}

export function QualityTags({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return (
    <Flexbox horizontal gap={4} wrap="wrap">
      {quality.warnings.map((warning) => (
        <Tag key={warning} color="warning" size="small">
          {warningLabel(warning)}
        </Tag>
      ))}
    </Flexbox>
  );
}

export function QualityAlert({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return (
    <Alert
      type="warning"
      title={new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(
        quality.warnings.map(warningLabel),
      )}
    />
  );
}
