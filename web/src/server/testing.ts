import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { PrelabelResult } from "../detection/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { ModelVersion } from "../models/schema";
import type { ImageExtension, ImageRef } from "../datasets/schema";
import type { InferenceWorkerHeartbeat } from "../inference/workers";
import { contentDigest } from "./blobs";
import { IMAGE_SIGNATURES } from "./image-format";
import { readDataset } from "./datasets";
import { createLabel } from "./labels";
import { readModelVersion } from "./model-registry";
import { addImages } from "./upload";

export const TEST_RUNTIME: RuntimeDescriptor = {
  adapter: "traditional",
  fingerprint: "b".repeat(64),
};

/** A heartbeat from a worker that executes only `TEST_RUNTIME`. */
export function testHeartbeat(
  workerId: string,
  current: ImageRef | null = null,
): InferenceWorkerHeartbeat {
  return {
    workerId,
    startedAt: "2026-08-27T00:00:00.000Z",
    runtimes: [TEST_RUNTIME],
    loaded: null,
    current,
  };
}

/** Bytes that declare `format` and carry `content` behind the signature. */
export function imageBytes(
  content: string,
  format: ImageExtension = ".jpg",
): Uint8Array<ArrayBuffer> {
  const signature = IMAGE_SIGNATURES[format][0]!;
  return new Uint8Array([...signature, ...new TextEncoder().encode(content)]);
}

export function imageFile(content: string, name = `${content}.jpg`): File {
  return new File([imageBytes(content)], name);
}

/** The digest of `imageFile(content)`. */
export function imageDigest(content: string): string {
  return contentDigest(imageBytes(content));
}

/** The dataset and the model version it currently selects. */
export async function selectedVersion(datasetId: string) {
  const dataset = await readDataset(datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  const version = await readModelVersion(dataset.selectedModelVersionId);
  if (!version) throw new Error(`missing version for ${datasetId}`);
  return { dataset, version };
}

/**
 * Uploads each text as a JPEG named after it, so tests address the images by
 * `imageDigest(text)`.
 */
export async function uploadTexts(datasetId: string, contents: string[]) {
  await addImages(
    datasetId,
    contents.map((content) => imageFile(content)),
  );
  return selectedVersion(datasetId);
}

/** A result `version` would produce for the image with these bytes. */
export function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): PrelabelResult {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: imageDigest(content),
    }),
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime,
    },
  };
}

/** Uploads the texts and completes a review of each, ready for training. */
export async function reviewedDataset(datasetId: string, contents: string[]) {
  const selected = await uploadTexts(datasetId, contents);
  for (const content of contents) {
    await createLabel(
      { dataset: datasetId, digest: imageDigest(content) },
      {
        ...documentFromPrelabel(resultFor(selected.version, content)),
        status: "complete",
      },
    );
  }
  return selected;
}
