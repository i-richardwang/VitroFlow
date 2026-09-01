import { datasetExportSchema, type DatasetExport } from "../datasets/export";
import { readDataset } from "./datasets";
import { readModel } from "./model-registry";
import { listImageRecords } from "./summaries";

/** A dataset's images with their detection and annotation documents. */
export async function exportDataset(
  datasetId: string,
): Promise<DatasetExport | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(datasetId);
  return datasetExportSchema.parse({
    schemaVersion: 1,
    dataset: datasetId,
    model: { id: model.id, classes: model.classes },
    images: records.map(({ image, detection, annotation }) => ({
      digest: image.digest,
      width: image.width,
      height: image.height,
      filename: image.filename,
      bytes: image.bytes,
      split: image.split,
      detection,
      annotation,
    })),
  });
}
