import { m } from "../paraglide/messages";
import type { DerivedMetric } from "./metrics";
import type { ModelVersion } from "./schema";

/**
 * What the product ships is named by the product, in the reader's language;
 * what a person created keeps the name they gave it.
 */
const BUILTIN_VERSION_NAMES: Record<string, () => string> = {
  "traditional-v1": m.builtin_version_traditional_v1,
};

const BUILTIN_METRIC_NAMES: Record<string, () => string> = {
  seeds: m.builtin_metric_seeds,
};

export function modelVersionName(
  version: Pick<ModelVersion, "name" | "source">,
): string {
  if (version.source.kind !== "builtin") return version.name;
  return BUILTIN_VERSION_NAMES[version.source.definition]?.() ?? version.name;
}

export function metricName(metric: Pick<DerivedMetric, "id" | "name">): string {
  return BUILTIN_METRIC_NAMES[metric.id]?.() ?? metric.name;
}
