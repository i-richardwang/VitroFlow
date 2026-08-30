import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionResult } from "../detection/schema";
import type { ImageSplit } from "../training/schema";
import { readDataset } from "./datasets";
import { readModel } from "./model-registry";
import { listImageRecords } from "./summaries";

export interface DatasetExport {
  schemaVersion: 1;
  dataset: string;
  model: { id: string; classes: string[] };
  images: DatasetExportImage[];
}

interface DatasetExportImage {
  digest: string;
  width: number;
  height: number;
  filename: string;
  bytes: number;
  split: ImageSplit | null;
  /** The detection the review started from, or the model's newest one. */
  detection: DetectionResult | null;
  label: AnnotationDocument | null;
}

/** A dataset's images with their detection and label documents. */
export async function exportDataset(
  datasetId: string,
): Promise<DatasetExport | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(datasetId);
  return {
    schemaVersion: 1,
    dataset: datasetId,
    model: { id: model.id, classes: model.classes },
    images: records.map(({ image, detection, label }) => ({
      digest: image.digest,
      width: image.width,
      height: image.height,
      filename: image.filename,
      bytes: image.bytes,
      split: image.split,
      detection,
      label,
    })),
  };
}
