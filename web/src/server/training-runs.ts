import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";

import {
  inferencePublicationSchema,
  trainingRecipeSchema,
  trainingRunSchema,
  type InferencePublication,
  type TrainingRecipe,
  type TrainingRun,
} from "../training/schema";
import { createDatasetSnapshot, readDatasetSnapshot } from "./dataset-snapshots";
import { writeAtomically } from "./files";
import { registerModelVersion } from "./model-registry";
import {
  MODEL_ARTIFACTS_DIR,
  TRAINING_RUNS_DIR,
  TRAINING_STAGING_DIR,
  resolveWithin,
} from "./paths";
import { readTrainingWorker } from "./training-worker-store";

const LEASE_MILLISECONDS = 5 * 60 * 1000;

export class TrainingRunConflictError extends Error {}
export class TrainingRunNotFoundError extends Error {}
export class TrainingArtifactValidationError extends Error {}

function runPath(runId: string): string {
  return resolveWithin(TRAINING_RUNS_DIR, `${runId}.json`);
}

function stagingDir(runId: string): string {
  return resolveWithin(TRAINING_STAGING_DIR, runId);
}

function artifactDir(versionId: string): string {
  return resolveWithin(MODEL_ARTIFACTS_DIR, versionId);
}

function persist(run: TrainingRun): TrainingRun {
  const valid = trainingRunSchema.parse(run);
  writeAtomically(runPath(valid.id), `${JSON.stringify(valid, null, 2)}\n`);
  return valid;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function artifactDigest(
  weights: Uint8Array,
  publication: InferencePublication,
): string {
  const hash = createHash("sha256").update(weights).update("\0");
  // `ready` is publication state, not an inference input. Keep this byte-for-byte
  // compatible with the Python inference adapter's YoloInferenceSettings digest.
  hash.update(canonical({
    confidence: publication.inference.confidence,
    end2end: publication.inference.end2end,
    imgsz: publication.inference.imgsz,
    max_det: publication.inference.max_det,
  }));
  return hash.digest("hex");
}

function assertMatchingArtifact(
  directory: string,
  weights: Uint8Array,
  publication: InferencePublication,
  runId: string,
): void {
  const storedWeights = fs.readFileSync(`${directory}/weights/best.pt`);
  const storedPublication = inferencePublicationSchema.parse(
    JSON.parse(fs.readFileSync(`${directory}/inference.json`, "utf-8")),
  );
  if (
    !Buffer.from(weights).equals(storedWeights) ||
    canonical(publication) !== canonical(storedPublication)
  ) {
    throw new TrainingRunConflictError(
      `Training run ${runId} already has a different artifact`,
    );
  }
}

export function readTrainingRun(runId: string): TrainingRun | null {
  const filePath = runPath(runId);
  if (!fs.existsSync(filePath)) return null;
  const run = trainingRunSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  if (run.id !== runId) throw new Error(`Training run ${run.id} does not match ${runId}`);
  return run;
}

export function listTrainingRuns(): TrainingRun[] {
  if (!fs.existsSync(TRAINING_RUNS_DIR)) return [];
  return fs
    .readdirSync(TRAINING_RUNS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readTrainingRun(name.slice(0, -5)))
    .filter((run): run is TrainingRun => run !== null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function createTrainingRun(
  datasetId: string,
  recipe: TrainingRecipe,
): TrainingRun {
  const snapshot = createDatasetSnapshot(datasetId);
  return persist({
    schemaVersion: 1,
    id: `train-${randomUUID()}`,
    modelId: snapshot.modelId,
    datasetSnapshotId: snapshot.id,
    createdAt: new Date().toISOString(),
    attempt: 0,
    recipe: trainingRecipeSchema.parse(recipe),
    state: { status: "queued" },
  });
}

function canClaim(run: TrainingRun, at: Date): boolean {
  return (
    run.state.status === "queued" ||
    (run.state.status === "running" &&
      Date.parse(run.state.leaseExpiresAt) <= at.getTime())
  );
}

function activeRunForWorker(
  workerId: string,
  at: Date,
): TrainingRun | undefined {
  return listTrainingRuns().find(
    (run) =>
      run.state.status === "running" &&
      run.state.workerId === workerId &&
      Date.parse(run.state.leaseExpiresAt) > at.getTime(),
  );
}

export function claimTrainingRun(
  workerId: string,
  at: Date = new Date(),
): TrainingRun | null {
  if (!readTrainingWorker(workerId)) {
    throw new Error("Training worker must heartbeat before claiming work");
  }
  const recovery = recoverTrainingPublications();
  if (recovery.failed.length > 0) {
    throw new Error(
      `Training publication recovery failed for ${recovery.failed
        .map(({ runId }) => runId)
        .join(", ")}`,
    );
  }
  const active = activeRunForWorker(workerId, at);
  if (active) return active;
  const run = listTrainingRuns().find((candidate) => canClaim(candidate, at));
  if (!run) return null;
  return persist({
    ...run,
    attempt: run.attempt + 1,
    state: {
      status: "running",
      workerId,
      leaseExpiresAt: new Date(at.getTime() + LEASE_MILLISECONDS).toISOString(),
      phase: "preparing",
      progress: 0,
    },
  });
}

function ownedRunningRun(runId: string, workerId: string): TrainingRun {
  const run = readTrainingRun(runId);
  if (!run || run.state.status !== "running" || run.state.workerId !== workerId) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${workerId}`,
    );
  }
  return run;
}

export function reportTrainingProgress(
  runId: string,
  workerId: string,
  phase: "preparing" | "training" | "validating",
  progress: number,
  at: Date = new Date(),
): TrainingRun {
  const run = ownedRunningRun(runId, workerId);
  return persist({
    ...run,
    state: {
      status: "running",
      workerId,
      leaseExpiresAt: new Date(at.getTime() + LEASE_MILLISECONDS).toISOString(),
      phase,
      progress,
    },
  });
}

export function failTrainingRun(
  runId: string,
  workerId: string,
  error: string,
): TrainingRun {
  const run = ownedRunningRun(runId, workerId);
  return persist({
    ...run,
    state: { status: "failed", error: error.slice(0, 2000) },
  });
}

function stageTrainingArtifact(
  runId: string,
  workerId: string,
  weights: Uint8Array,
  inference: unknown,
): TrainingRun {
  const current = readTrainingRun(runId);
  if (!current) throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  const parsed = inferencePublicationSchema.safeParse(inference);
  if (!parsed.success) {
    throw new TrainingArtifactValidationError(parsed.error.message);
  }
  const publication = parsed.data;
  if (weights.byteLength === 0) {
    throw new TrainingArtifactValidationError("Training weights are empty");
  }
  const publishedRecipe = {
    baseModel: {
      reference: publication.training.base_model.reference,
      digest: publication.training.base_model.digest,
    },
    configuration: publication.training.configuration,
    runtime: publication.training.runtime,
  };
  const expectedIdentity = {
    baseModel: current.recipe.baseModel,
    configuration: current.recipe.configuration,
    runtime: current.recipe.runtime,
  };
  if (canonical(publishedRecipe) !== canonical(expectedIdentity)) {
    throw new TrainingArtifactValidationError(
      "Training artifact identity does not match its run recipe",
    );
  }
  if (current.state.status === "succeeded") {
    assertMatchingArtifact(
      artifactDir(current.state.modelVersionId),
      weights,
      publication,
      runId,
    );
    return current;
  }
  if (current.state.status === "publishing") {
    if (current.state.workerId !== workerId) {
      throw new TrainingRunConflictError(
        `Training run ${runId} is not owned by ${workerId}`,
      );
    }
    const staged = stagingDir(runId);
    const directory = fs.existsSync(staged)
      ? staged
      : artifactDir(`${current.modelId}.${current.id}`);
    assertMatchingArtifact(directory, weights, publication, runId);
    return current;
  }
  const run = ownedRunningRun(runId, workerId);
  const directory = stagingDir(runId);
  fs.mkdirSync(`${directory}/weights`, { recursive: true });
  writeAtomically(`${directory}/weights/best.pt`, weights);
  writeAtomically(
    `${directory}/inference.json`,
    `${JSON.stringify(publication, null, 2)}\n`,
  );
  return persist({ ...run, state: { status: "publishing", workerId } });
}

/** Upload and server-side publication are one recoverable, idempotent operation. */
export function publishTrainingArtifact(
  runId: string,
  workerId: string,
  weights: Uint8Array,
  inference: unknown,
): TrainingRun {
  stageTrainingArtifact(runId, workerId, weights, inference);
  return finalizeTrainingPublication(runId);
}

function finalizeTrainingPublication(runId: string): TrainingRun {
  const current = readTrainingRun(runId);
  if (!current) throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  if (current.state.status === "succeeded") return current;
  if (current.state.status !== "publishing") {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not ready to publish`,
    );
  }
  const snapshot = readDatasetSnapshot(current.datasetSnapshotId);
  if (!snapshot) throw new Error(`Missing snapshot ${current.datasetSnapshotId}`);
  const versionId = `${current.modelId}.${current.id}`;
  const destination = artifactDir(versionId);
  const source = stagingDir(runId);
  if (!fs.existsSync(destination)) {
    if (!fs.existsSync(source)) {
      throw new Error(`Missing staged artifact for training run ${runId}`);
    }
    fs.mkdirSync(MODEL_ARTIFACTS_DIR, { recursive: true });
    fs.renameSync(source, destination);
  }
  const weights = fs.readFileSync(`${destination}/weights/best.pt`);
  const publication = inferencePublicationSchema.parse(
    JSON.parse(fs.readFileSync(`${destination}/inference.json`, "utf-8")),
  );
  const version = registerModelVersion({
    schemaVersion: 1,
    id: versionId,
    modelId: current.modelId,
    name: `YOLO26 ${current.createdAt}`,
    createdAt: current.createdAt,
    source: {
      kind: "training_run",
      trainingRunId: current.id,
      datasetSnapshotId: snapshot.id,
    },
    artifact: {
      kind: "ultralytics",
      digest: artifactDigest(weights, publication),
      bytes: weights.byteLength,
      path: `model-artifacts/${versionId}/weights/best.pt`,
      inference: {
        confidence: publication.inference.confidence,
        imageSize: publication.inference.imgsz,
        maxDetections: publication.inference.max_det,
        endToEnd: publication.inference.end2end,
      },
      validation: publication.validation,
      training: {
        baseModel: {
          reference: publication.training.base_model.reference,
          digest: publication.training.base_model.digest,
        },
        configuration: publication.training.configuration,
        runtime: publication.training.runtime,
      },
    },
  });
  return persist({
    ...current,
    state: { status: "succeeded", modelVersionId: version.id },
  });
}

export interface TrainingPublicationRecovery {
  recovered: string[];
  failed: Array<{ runId: string; error: string }>;
}

/** Reconciles durable publishing states after interrupted server operations. */
export function recoverTrainingPublications(): TrainingPublicationRecovery {
  const result: TrainingPublicationRecovery = { recovered: [], failed: [] };
  for (const run of listTrainingRuns()) {
    if (run.state.status !== "publishing") continue;
    try {
      finalizeTrainingPublication(run.id);
      result.recovered.push(run.id);
    } catch (error) {
      result.failed.push({
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export function snapshotForRun(runId: string, workerId: string) {
  const run = ownedRunningRun(runId, workerId);
  const snapshot = readDatasetSnapshot(run.datasetSnapshotId);
  if (!snapshot) throw new Error(`Missing snapshot ${run.datasetSnapshotId}`);
  return snapshot;
}
