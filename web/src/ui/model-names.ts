import { m } from "../paraglide/messages";
import type { Model } from "../domain/models/schema";

/**
 * What the product ships is named by the product, in the reader's language;
 * what a person created keeps the name they gave it.
 */
const BUILTIN_MODEL_NAMES: Record<string, () => string> = {
  "seed-detector": m.builtin_model_seed_detector,
};

const BUILTIN_CLASS_NAMES: Record<string, () => string> = {
  seed: m.builtin_class_seed,
};

export function modelName(model: Pick<Model, "id" | "name">): string {
  return BUILTIN_MODEL_NAMES[model.id]?.() ?? model.name;
}

/** A class the product ships is named by the product; any other keeps its identifier. */
export function className(name: string): string {
  return BUILTIN_CLASS_NAMES[name]?.() ?? name;
}
