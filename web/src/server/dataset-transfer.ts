import { eq, inArray } from "drizzle-orm";

import {
  datasetManifestSchema,
  type DatasetManifest,
} from "../datasets/manifest";
import type { Dataset } from "../datasets/schema";
import { transaction } from "../db/client";
import { annotations, datasetImages, datasets, images } from "../db/schema";
import { readDataset } from "./datasets";
import { lockImage } from "./image-lock";
import { readModel } from "./model-registry";
import { listImageRecords } from "./summaries";

/**
 * A dataset leaves and enters the workbench as a manifest and the images it
 * names. The manifest carries what the workbench keeps for the dataset: the
 * memberships and the reviews recorded for its model. Images travel by digest
 * ahead of the manifest, so importing it is one atomic step that either
 * creates the whole dataset or nothing.
 */

/** The dataset's manifest: its images with their detection and annotation documents. */
export async function readDatasetManifest(
  datasetId: string,
): Promise<DatasetManifest | null> {
  const dataset = await readDataset(datasetId);
  if (!dataset) return null;
  const model = await readModel(dataset.modelId);
  if (!model) throw new Error(`Unknown model: ${dataset.modelId}`);
  const records = await listImageRecords(datasetId);
  return datasetManifestSchema.parse({
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

/** Why this workbench cannot hold the dataset a manifest describes. */
export class DatasetImportError extends Error {}

function sameClasses(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((c, i) => c === right[i]);
}

function listed(digests: string[]): string {
  return digests.join(", ");
}

/**
 * Creates the dataset a manifest describes. The workbench must know the
 * manifest's model with the same classes, must hold every image it names as
 * the bytes it describes, and must have no dataset of that name and no review
 * of those images for that model: a manifest adds to a workbench, never
 * changes what a reviewer decided here. Detections in the manifest are what
 * another workbench's versions found and are not recorded.
 */
export async function importDataset(
  manifest: DatasetManifest,
): Promise<Dataset> {
  const addedAt = new Date();
  return transaction(async (tx) => {
    const model = await readModel(manifest.model.id, tx);
    if (!model) {
      throw new DatasetImportError(`Unknown model: ${manifest.model.id}`);
    }
    if (!sameClasses(model.classes, manifest.model.classes)) {
      throw new DatasetImportError(
        `Model ${model.id} has classes ${listed(model.classes)}, not ${listed(manifest.model.classes)}`,
      );
    }
    const [created] = await tx
      .insert(datasets)
      .values({ id: manifest.dataset, modelId: model.id, createdAt: addedAt })
      .onConflictDoNothing({ target: datasets.id })
      .returning({ id: datasets.id });
    if (!created) {
      throw new DatasetImportError(
        `Dataset ${manifest.dataset} already exists`,
      );
    }
    const digests = manifest.images.map((image) => image.digest).sort();
    for (const digest of digests) await lockImage(digest, tx);
    const stored = new Map(
      digests.length === 0
        ? []
        : (
            await tx
              .select({
                digest: images.id,
                width: images.width,
                height: images.height,
                bytes: images.bytes,
              })
              .from(images)
              .where(inArray(images.id, digests))
          ).map((image) => [image.digest, image]),
    );
    const missing = digests.filter((digest) => !stored.has(digest));
    if (missing.length > 0) {
      throw new DatasetImportError(`Images are not stored: ${listed(missing)}`);
    }
    const mismatched = manifest.images.filter((image) => {
      const image_ = stored.get(image.digest)!;
      return (
        image_.width !== image.width ||
        image_.height !== image.height ||
        image_.bytes !== image.bytes
      );
    });
    if (mismatched.length > 0) {
      throw new DatasetImportError(
        `Images have other metadata here: ${listed(mismatched.map((image) => image.digest))}`,
      );
    }
    const reviewing = manifest.images.filter((image) => image.annotation);
    if (reviewing.length > 0) {
      const reviewed = await tx
        .select({ digest: annotations.imageId })
        .from(annotations)
        .where(eq(annotations.modelId, model.id))
        .then((rows) => new Set(rows.map((row) => row.digest)));
      const conflicting = reviewing.filter((image) =>
        reviewed.has(image.digest),
      );
      if (conflicting.length > 0) {
        throw new DatasetImportError(
          `Images are already reviewed for ${model.id}: ${listed(conflicting.map((image) => image.digest))}`,
        );
      }
    }
    if (manifest.images.length > 0) {
      await tx.insert(datasetImages).values(
        manifest.images.map((image) => ({
          datasetId: manifest.dataset,
          imageId: image.digest,
          filename: image.filename,
          split: image.split,
          addedAt,
        })),
      );
    }
    if (reviewing.length > 0) {
      await tx.insert(annotations).values(
        reviewing.map((image) => ({
          imageId: image.digest,
          modelId: model.id,
          document: image.annotation!,
          updatedAt: addedAt,
        })),
      );
    }
    return { id: manifest.dataset, modelId: model.id };
  });
}
