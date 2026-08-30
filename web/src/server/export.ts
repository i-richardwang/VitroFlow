import type { AnnotationDocument } from "../annotation/schema";
import type { DetectionResult } from "../detection/schema";
import type { ImageSplit } from "../training/schema";
import { readDataset } from "./datasets";
import { listImageRecords } from "./summaries";

export interface DatasetExport {
  schemaVersion: 1;
  dataset: string;
  images: DatasetExportImage[];
}

interface DatasetExportImage {
  digest: string;
  width: number;
  height: number;
  filename: string;
  bytes: number;
  split: ImageSplit | null;
  /** The detection under the version the review started from, or the selected one. */
  detection: DetectionResult | null;
  label: AnnotationDocument | null;
}

/** A dataset's images with their detection and label documents. */
export async function exportDataset(
  datasetId: string,
): Promise<DatasetExport | null> {
  if (!(await readDataset(datasetId))) return null;
  const records = await listImageRecords(datasetId);
  return {
    schemaVersion: 1,
    dataset: datasetId,
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
