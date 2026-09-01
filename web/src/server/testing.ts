import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { makeResult } from "../annotation/testing";
import type { Dataset } from "../datasets/schema";
import type { DetectionResult } from "../detection/schema";
import type { Experiment, ObservationImageRef } from "../experiments/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { Model, ModelVersion } from "../models/schema";
import type { InferenceWorkerHeartbeat } from "../inference/workers";
import { canonicalize } from "./image-ingest";
import { addExperimentObservationImages } from "./datasets";
import {
  addObservationUnits,
  addTreatment,
  createExperiment,
} from "./experiment-design";
import { assignObservationImages } from "./experiment-observation-images";
import { addObservation } from "./experiment-observations";
import { storeImage } from "./image-store";
import {
  createAnnotationFromDetection,
  readAnnotation,
  updateAnnotation,
} from "./annotations";
import { recordInferenceOutcome } from "./inference-outcomes";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { readModelVersion, registerModelVersion } from "./model-registry";
import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { database, transaction } from "../db/client";
import { registerModel as registerDatabaseModel } from "../db/registry";
import {
  datasetSnapshots,
  datasets,
  experimentObservationImages,
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

/** Fixture images are grids of flat blocks so lossy encoding keeps them distinct. */
const FIXTURE_BLOCKS = 8;
const FIXTURE_BLOCK_PIXELS = 8;
export const FIXTURE_EDGE = FIXTURE_BLOCKS * FIXTURE_BLOCK_PIXELS;

/** A source image whose pixels follow from `content`. */
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

export interface ObservedImages {
  experiment: Experiment;
  version: ModelVersion;
  /** In the order of `contents`. */
  digests: string[];
  /** In the order of `contents`. */
  images: ObservationImageRef[];
}

/**
 * Creates one observation unit per text and assigns an image to each in the
 * experiment's first observation.
 */
export async function observeImages(
  experimentName: string,
  contents: string[],
  version?: ModelVersion,
): Promise<ObservedImages> {
  const selectedVersion = version ?? (await baselineVersion());
  const experiment = await createExperiment({
    name: experimentName,
    plantMaterial: "",
    explantType: "",
    baseMedium: "",
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
  const observationUnits = await addObservationUnits({
    experiment: experiment.id,
    treatment: treatment.id,
    codes: contents,
    initialExplantCount: 1,
  });
  const byCode = new Map(
    observationUnits.map((observationUnit) => [
      observationUnit.code,
      observationUnit.id,
    ]),
  );
  const digests = await storeTexts(contents);
  const observation = await addObservation({
    experiment: experiment.id,
    observedOn: "2026-08-08",
    note: "",
  });
  await assignObservationImages({
    experiment: experiment.id,
    observation: observation.id,
    images: contents.map((content, index) => ({
      observationUnit: byCode.get(content)!,
      digest: digests[index]!,
      filename: `${content}.jpg`,
    })),
  });
  const cells = await listExperimentObservationImages(experiment.id);
  return {
    experiment,
    version: selectedVersion,
    digests,
    images: contents.map((content) => ({
      experiment: experiment.id,
      observationImage: cells.get(byCode.get(content)!)!,
    })),
  };
}

/** Observation-image identifiers indexed by observation unit. */
async function listExperimentObservationImages(
  experimentId: string,
): Promise<Map<string, string>> {
  const rows = await (
    await database()
  )
    .select({
      observationUnitId: experimentObservationImages.observationUnitId,
      id: experimentObservationImages.id,
    })
    .from(experimentObservationImages)
    .where(eq(experimentObservationImages.experimentId, experimentId));
  return new Map(rows.map((row) => [row.observationUnitId, row.id]));
}

export interface SeededDataset extends ObservedImages {
  dataset: Dataset;
}

/** Creates observation images from the texts and adds them to the dataset. */
export async function uploadTexts(
  datasetId: string,
  contents: string[],
  version?: ModelVersion,
): Promise<SeededDataset> {
  const observation = await observeImages(
    `${datasetId} images`,
    contents,
    version,
  );
  const { dataset } = await addExperimentObservationImages({
    dataset: datasetId,
    images: observation.images,
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
      modelId: seeded.version.modelId,
    };
    if (await readAnnotation(ref)) continue;
    const result = await resultFor(seeded.version, content);
    await recordInferenceOutcome(
      { digest: ref.digest, versionId: seeded.version.id },
      result,
      { runtimes: [result.producer.runtime] },
    );
    const started = await createAnnotationFromDetection(ref, seeded.version.id);
    await updateAnnotation(ref, { ...started, status: "complete" });
  }
  return seeded;
}
