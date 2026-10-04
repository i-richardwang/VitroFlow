import type { DetectionQuality } from "../domain/detection/schema";
import { m } from "../paraglide/messages";
import { Alert } from "./kit/Alert";
import { Flexbox } from "./kit/Flex";
import { Tag } from "./kit/Tag";
import { formatList } from "./lists";

const WARNING_LABELS: ReadonlyMap<string, () => string> = new Map([
  ["dish_detection_failed", m.quality_dish_detection_failed],
  ["exposure_clipping", m.quality_exposure_clipping],
  ["low_focus", m.quality_low_focus],
]);

/** Each warning's label, once: warnings this version cannot name share one. */
function warningLabels(quality: DetectionQuality): string[] {
  return [
    ...new Set(
      quality.warnings.map(
        (warning) =>
          WARNING_LABELS.get(warning)?.() ?? m.quality_unknown_warning(),
      ),
    ),
  ];
}

export function QualityTags({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return (
    <Flexbox horizontal gap={4} wrap="wrap">
      {warningLabels(quality).map((label) => (
        <Tag key={label} color="warning" size="small">
          {label}
        </Tag>
      ))}
    </Flexbox>
  );
}

export function QualityAlert({ quality }: { quality: DetectionQuality }) {
  if (quality.status === "ok") {
    return null;
  }
  return <Alert type="warning" title={formatList(warningLabels(quality))} />;
}
