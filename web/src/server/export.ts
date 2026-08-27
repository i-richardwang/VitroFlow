import type { AnnotationDocument } from "../annotation/schema";
import type { Prelabel } from "../detection/schema";
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
  extension: string;
  filename: string;
  bytes: number;
  split: ImageSplit | null;
  prelabel: Prelabel | null;
  label: AnnotationDocument | null;
}

/** A dataset's images with their prelabel and label documents. */
export async function exportDataset(
  datasetId: string,
): Promise<DatasetExport | null> {
  if (!(await readDataset(datasetId))) return null;
  const records = await listImageRecords(datasetId);
  return {
    schemaVersion: 1,
    dataset: datasetId,
    images: records.map(({ image, prelabel, label }) => ({
      digest: image.digest,
      extension: image.extension,
      filename: image.filename,
      bytes: image.bytes,
      split: image.split,
      prelabel,
      label,
    })),
  };
}
