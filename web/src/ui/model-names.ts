import { m } from "../paraglide/messages";
import type { Model, ModelVersion } from "../domain/models/schema";

/**
 * What the product ships is named by the product, in the reader's language;
 * what a person created keeps the name they gave it.
 */
const BUILTIN_MODEL_NAMES: Record<string, () => string> = {
  "seed-detector": m.builtin_model_seed_detector,
};

const BUILTIN_VERSION_NAMES: Record<string, () => string> = {
  "traditional-v1": m.builtin_version_traditional_v1,
};

const BUILTIN_CLASS_NAMES: Record<string, () => string> = {
  seed: m.builtin_class_seed,
};

export function modelName(model: Pick<Model, "id" | "name">): string {
  return BUILTIN_MODEL_NAMES[model.id]?.() ?? model.name;
}

export function modelVersionName(
  version: Pick<ModelVersion, "name" | "source">,
): string {
  if (version.source.kind !== "builtin") return version.name;
  return BUILTIN_VERSION_NAMES[version.source.definition]?.() ?? version.name;
}

/** A class the product ships is named by the product; any other keeps its identifier. */
export function className(name: string): string {
  return BUILTIN_CLASS_NAMES[name]?.() ?? name;
}
