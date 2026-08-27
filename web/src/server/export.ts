import type { AnnotationDocument } from "../annotation/schema";
import type { Prelabel } from "../detection/schema";
import { readDataset } from "./datasets";
import { listImageRecords } from "./summaries";

export interface DatasetExport {
  schemaVersion: 1;
  dataset: string;
  images: DatasetExportImage[];
}

interface DatasetExportImage {
  dataset: string;
  stem: string;
  source: string;
  digest: string;
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
      dataset: image.dataset,
      stem: image.stem,
      source: image.source,
      digest: image.digest,
      prelabel,
      label,
    })),
  };
}
