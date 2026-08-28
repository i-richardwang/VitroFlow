import { createHash } from "node:crypto";
import sharp from "sharp";

import { documentFromPrelabel } from "../annotation/prelabel";
import { makeResult } from "../annotation/testing";
import type { PrelabelResult } from "../detection/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { ModelVersion } from "../models/schema";
import type { ImageRef } from "../datasets/schema";
import type { InferenceWorkerHeartbeat } from "../inference/workers";
import { canonicalize } from "./image-ingest";
import { readDataset } from "./datasets";
import { createLabel } from "./labels";
import { readModelVersion } from "./model-registry";
import { addImage } from "./upload";

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

/** Fixture photographs are a grid of flat blocks so that lossy encoding keeps them apart. */
const FIXTURE_BLOCKS = 8;
const FIXTURE_BLOCK_PIXELS = 8;
export const FIXTURE_EDGE = FIXTURE_BLOCKS * FIXTURE_BLOCK_PIXELS;

/** A source photograph whose pixels follow from `content`. */
export async function imageBytes(
  content: string,
  format: "png" | "jpeg" | "tiff" = "png",
): Promise<Uint8Array<ArrayBuffer>> {
  const seed = createHash("sha256").update(content).digest();
  const pixels = Buffer.alloc(FIXTURE_EDGE * FIXTURE_EDGE * 3);
  for (let y = 0; y < FIXTURE_EDGE; y += 1) {
    for (let x = 0; x < FIXTURE_EDGE; x += 1) {
      const block =
        Math.floor(y / FIXTURE_BLOCK_PIXELS) * FIXTURE_BLOCKS +
        Math.floor(x / FIXTURE_BLOCK_PIXELS);
      const offset = (y * FIXTURE_EDGE + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = seed[(block * 3 + channel) % seed.length]!;
      }
    }
  }
  const image = sharp(pixels, {
    raw: { width: FIXTURE_EDGE, height: FIXTURE_EDGE, channels: 3 },
  });
  const encoded =
    format === "png"
      ? image.png()
      : format === "jpeg"
        ? image.jpeg()
        : image.tiff();
  const encodedBytes = await encoded.toBuffer();
  const bytes = new Uint8Array(new ArrayBuffer(encodedBytes.byteLength));
  bytes.set(encodedBytes);
  return bytes;
}

/** The transport-neutral source accepted by the image ingestion domain. */
export async function imageSource(
  content: string,
  filename = `${content}.jpg`,
) {
  return { filename, bytes: await imageBytes(content) };
}

/** The digest `imageSource(content)` is stored under once it is canonicalised. */
export async function imageDigest(content: string): Promise<string> {
  return (await canonicalize(await imageBytes(content))).digest;
}

/** The dataset and the model version it currently selects. */
export async function selectedVersion(datasetId: string) {
  const dataset = await readDataset(datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  const version = await readModelVersion(dataset.selectedModelVersionId);
  if (!version) throw new Error(`missing version for ${datasetId}`);
  return { dataset, version };
}

/** Uploads one deterministic source per text; tests use its canonical digest. */
export async function uploadTexts(datasetId: string, contents: string[]) {
  for (const content of contents) {
    await addImage(datasetId, await imageSource(content));
  }
  return selectedVersion(datasetId);
}

/** A result `version` would produce for the image with these bytes. */
export async function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): Promise<PrelabelResult> {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: await imageDigest(content),
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
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
      { dataset: datasetId, digest: await imageDigest(content) },
      {
        ...documentFromPrelabel(await resultFor(selected.version, content)),
        status: "complete",
      },
    );
  }
  return selected;
}
