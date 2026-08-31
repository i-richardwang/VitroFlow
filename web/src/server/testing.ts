import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { makeResult } from "../annotation/testing";
import type { Dataset } from "../datasets/schema";
import type { DetectionResult } from "../detection/schema";
import type { Experiment, PhotoRef } from "../experiments/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { Model, ModelVersion } from "../models/schema";
import type { InferenceWorkerHeartbeat } from "../inference/workers";
import { canonicalize } from "./image-ingest";
import { addExperimentPhotos } from "./datasets";
import { addDishes, addTreatment, createExperiment } from "./experiment-design";
import { addObservation, filePhotos } from "./experiment-observations";
import { storeImage } from "./image-store";
import { createLabelFromDetection, readLabel, updateLabel } from "./labels";
import { recordInferenceOutcome } from "./inference-outcomes";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { readModelVersion, registerModelVersion } from "./model-registry";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { database, transaction } from "../db/client";
import { registerModel as registerDatabaseModel } from "../db/registry";
import {
  datasetSnapshots,
  datasets,
  experimentPhotos,
  trainingRuns,
} from "../db/schema";

export const TEST_RUNTIME: RuntimeDescriptor = {
  adapter: "traditional",
  fingerprint: "b".repeat(64),
};

export const ULTRALYTICS_RUNTIME: RuntimeDescriptor = {
  adapter: "ultralytics",
  fingerprint: "e".repeat(64),
};

export async function registerTestModel(model: Model): Promise<Model> {
  return registerDatabaseModel(model, await database());
}

/** The builtin seed detector every deployment starts with. */
export async function baselineVersion(): Promise<ModelVersion> {
  const version = await readModelVersion(SEED_DETECTOR_BASELINE_VERSION_ID);
  if (!version) throw new Error("builtin models are not registered");
  return version;
}

/** Registers a trained version of `modelId`, as a training run would publish it. */
export async function registerTrainedVersion(
  modelId: string,
  slug = "yolo-v1",
): Promise<ModelVersion> {
  const datasetId = `${modelId}.${slug}.dataset`;
  const snapshotId = `${modelId}.${slug}.snapshot`;
  const runId = `${modelId}.${slug}.run`;
  const value: ModelVersion = {
    schemaVersion: 1,
    id: `${modelId}.${slug}`,
    modelId,
    name: `YOLO ${slug}`,
    createdAt: "2026-08-27T02:00:00.000Z",
    source: {
      kind: "training_run",
      trainingRunId: runId,
      trainingAttempt: 1,
      datasetSnapshotId: snapshotId,
    },
    artifact: {
      kind: "ultralytics",
      digest: createHash("sha256").update(`${modelId}.${slug}`).digest("hex"),
      weights: { digest: "c".repeat(64), bytes: 10 },
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.6,
        recall: 0.5,
        map50: 0.8,
        map50To95: 0.4,
        fitness: 0.44,
      },
      training: YOLO26_SEED_SMALL_RECIPE,
    },
  };
  return transaction(async (tx) => {
    await tx
      .insert(datasets)
      .values({ id: datasetId, modelId, createdAt: new Date() })
      .onConflictDoNothing();
    await tx
      .insert(datasetSnapshots)
      .values({ id: snapshotId, datasetId, modelId, createdAt: new Date() })
      .onConflictDoNothing();
    await tx
      .insert(trainingRuns)
      .values({
        id: runId,
        modelId,
        datasetSnapshotId: snapshotId,
        createdAt: new Date(value.createdAt),
        attempt: 1,
        recipe: YOLO26_SEED_SMALL_RECIPE,
        status: "queued",
      })
      .onConflictDoNothing();
    const version = await registerModelVersion(value, tx);
    await tx
      .update(trainingRuns)
      .set({ status: "succeeded", modelVersionId: version.id })
      .where(eq(trainingRuns.id, runId));
    return version;
  });
}

/** A heartbeat from a worker that executes only `TEST_RUNTIME`. */
export function testHeartbeat(
  workerId: string,
  current: string | null = null,
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

/** The digest `imageBytes(content)` is stored under once it is canonicalised. */
export async function imageDigest(content: string): Promise<string> {
  return (await canonicalize(await imageBytes(content))).digest;
}

/** Stores one deterministic source per text, returning the digests in order. */
export async function storeTexts(contents: string[]): Promise<string[]> {
  const digests = [];
  for (const content of contents) {
    digests.push((await storeImage(await imageBytes(content))).digest);
  }
  return digests;
}

export interface PhotographedObservation {
  experiment: Experiment;
  version: ModelVersion;
  /** In the order of `contents`. */
  digests: string[];
  /** In the order of `contents`. */
  photos: PhotoRef[];
}

/**
 * Lays out one dish per text in a new experiment and photographs them all in
 * its first observation, so the images enter the system the way photographs
 * do: through a design that already knows its dishes.
 */
export async function photographObservation(
  experimentName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<PhotographedObservation> {
  const selectedVersion = version ?? (await baselineVersion());
  const experiment = await createExperiment({
    name: experimentName,
    material: "",
    explant: "",
    medium: "",
    notes: "",
    inoculatedOn: "2026-08-01",
    modelVersionId: selectedVersion.id,
  });
  const treatment = await addTreatment({
    experiment: experiment.id,
    name: "Test",
    factors: [],
    note: "",
    replicates: 0,
    initialExplantCount: 1,
  });
  const dishes = await addDishes({
    experiment: experiment.id,
    treatment: treatment.id,
    labels: contents,
    initialExplantCount: 1,
  });
  const byLabel = new Map(dishes.map((dish) => [dish.label, dish.id]));
  const digests = await storeTexts(contents);
  const observation = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
  });
  await filePhotos({
    experiment: experiment.id,
    observation: observation.id,
    photos: contents.map((content, index) => ({
      dish: byLabel.get(content)!,
      digest: digests[index]!,
      filename: `${content}.jpg`,
    })),
  });
  const cells = await listExperimentPhotos(experiment.id);
  return {
    experiment,
    version: selectedVersion,
    digests,
    photos: contents.map((content) => ({
      experiment: experiment.id,
      photo: cells.get(byLabel.get(content)!)!,
    })),
  };
}

/** The photograph filed under each dish, by dish, across every observation. */
async function listExperimentPhotos(
  experimentId: string,
): Promise<Map<string, string>> {
  const rows = await (
    await database()
  )
    .select({ dishId: experimentPhotos.dishId, id: experimentPhotos.id })
    .from(experimentPhotos)
    .where(eq(experimentPhotos.experimentId, experimentId));
  return new Map(rows.map((row) => [row.dishId, row.id]));
}

export interface SeededDataset extends PhotographedObservation {
  dataset: Dataset;
}

/** Photographs the texts in an experiment and adds them to the dataset. */
export async function uploadTexts(
  datasetId: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const observation = await photographObservation(
    `${datasetId} photos`,
    contents,
    version,
  );
  const { dataset } = await addExperimentPhotos({
    dataset: datasetId,
    photos: observation.photos,
  });
  return { ...observation, dataset };
}

/** A result `version` would produce for the image with these bytes. */
export async function resultFor(
  version: ModelVersion,
  content: string,
  runtime = TEST_RUNTIME,
): Promise<DetectionResult> {
  return {
    ...makeResult([{ id: 0, x: 10, y: 10 }], {
      digest: await imageDigest(content),
      dishRadius: FIXTURE_EDGE / 4,
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
    }),
    producer: {
      modelVersionId: version.id,
      artifactDigest: version.artifact.digest,
      runtime,
    },
  };
}

/**
 * Uploads the texts and completes a review of each, ready for training. A
 * review belongs to the image and the model, so texts already reviewed by an
 * earlier call keep the review they have.
 */
export async function reviewedDataset(
  datasetId: string,
  contents: string[],
): Promise<SeededDataset> {
  const seeded = await uploadTexts(datasetId, contents);
  for (const content of contents) {
    const ref = {
      digest: await imageDigest(content),
      model: seeded.version.modelId,
    };
    if (await readLabel(ref)) continue;
    const result = await resultFor(seeded.version, content);
    await recordInferenceOutcome(
      { digest: ref.digest, versionId: seeded.version.id },
      result,
      { runtimes: [result.producer.runtime] },
    );
    const started = await createLabelFromDetection(ref, seeded.version.id);
    await updateLabel(ref, { ...started, status: "complete" });
  }
  return seeded;
}
