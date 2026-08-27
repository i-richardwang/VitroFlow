import {
  IMAGE_STATES,
  type ImageRef,
  type ImageState,
} from "../datasets/schema";
import { isFailure, type SeedQuality } from "../detection/schema";
import { listImages } from "./datasets";
import { readLabel } from "./labels";
import { readPrelabel } from "./prelabels";

export interface ImageSummary extends ImageRef {
  state: ImageState;
  detectionCount: number | null;
  instanceCount: number | null;
  quality: SeedQuality | null;
  error: string | null;
  /** The model version that produced the prelabel, if one exists. */
  modelVersionId: string | null;
}

export interface DatasetSummary {
  dataset: string;
  imageCount: number;
  counts: Record<ImageState, number>;
}

export function summarizeImage(ref: ImageRef): ImageSummary {
  const prelabel = readPrelabel(ref);
  const label = readLabel(ref);
  const detected = prelabel && !isFailure(prelabel) ? prelabel : null;
  const state: ImageState = label
    ? label.status
    : prelabel === null
      ? "pending"
      : isFailure(prelabel)
        ? "failed"
        : "prelabeled";
  return {
    dataset: ref.dataset,
    stem: ref.stem,
    state,
    detectionCount: detected?.instances.length ?? null,
    instanceCount: label?.instances.length ?? null,
    quality: detected?.quality ?? null,
    error: prelabel && isFailure(prelabel) ? prelabel.error : null,
    modelVersionId: prelabel?.producer.model_version_id ?? null,
  };
}

export function countImageStates(
  images: ImageSummary[],
): Record<ImageState, number> {
  const counts = Object.fromEntries(
    IMAGE_STATES.map((state) => [state, 0]),
  ) as Record<ImageState, number>;
  for (const image of images) {
    counts[image.state] += 1;
  }
  return counts;
}

export function summarizeDataset(dataset: string): DatasetSummary {
  const images = listImages(dataset).map(summarizeImage);
  return { dataset, imageCount: images.length, counts: countImageStates(images) };
}
