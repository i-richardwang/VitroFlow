import type { ImageSplit } from "../../domain/training/schema";
import { m } from "../../paraglide/messages";

const SPLIT_LABELS: Record<ImageSplit, () => string> = {
  train: m.image_split_train,
  val: m.image_split_val,
};

export function splitLabel(split: ImageSplit): string {
  return SPLIT_LABELS[split]();
}
