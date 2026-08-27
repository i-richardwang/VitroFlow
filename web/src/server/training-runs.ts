import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, lte, or } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import { trainingEpochs, trainingRuns } from "../db/schema";
import {
  inferencePublicationSchema,
  trainingEpochSchema,
  trainingRecipeSchema,
  trainingRunId,
  trainingRunSchema,
  type InferencePublication,
  type TrainingEpoch,
  type TrainingEpochReport,
  type TrainingPhase,
  type TrainingRecipe,
  type TrainingRun,
} from "../training/schema";
import { blobExists, moveBlobDirectory, readBlob, writeBlob } from "./blobs";
import {
  createDatasetSnapshot,
  readDatasetSnapshot,
} from "./dataset-snapshots";
import { readDataset } from "./datasets";
import { registerModelVersion } from "./model-registry";
import { readTrainingWorker } from "./training-worker-store";

const LEASE_MILLISECONDS = 5 * 60 * 1000;
const ACTIVE_STATUSES = ["queued", "running", "publishing"] as const;

export class TrainingRunConflictError extends Error {}
export class TrainingRunNotFoundError extends Error {}
export class TrainingArtifactValidationError extends Error {}

type Row = typeof trainingRuns.$inferSelect;
type EpochRow = typeof trainingEpochs.$inferSelect;

function stagingKey(runId: string, file: string): string {
  return `training-staging/${runId}/${file}`;
}

function artifactKey(versionId: string, file: string): string {
  return `model-artifacts/${versionId}/${file}`;
}

/** The version a run publishes; fixed by the run identity before training starts. */
function trainedVersionId(run: Pick<TrainingRun, "modelId" | "id">): string {
  return `${run.modelId}.${run.id}`;
}

function returned(row: Row | undefined, runId: string): TrainingRun {
  if (!row)
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  return toRun(row);
}

function toRun(row: Row): TrainingRun {
  const state = (() => {
    switch (row.status) {
      case "queued":
        return { status: row.status };
      case "running":
        return {
          status: row.status,
          workerId: row.workerId,
          leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
          phase: row.phase,
          progress: row.progress,
        };
      case "publishing":
        return { status: row.status, workerId: row.workerId };
      case "succeeded":
        return { status: row.status, modelVersionId: row.modelVersionId };
      case "failed":
        return { status: row.status, error: row.error };
    }
  })();
  return trainingRunSchema.parse({
    schemaVersion: 1,
    id: row.id,
    modelId: row.modelId,
    datasetSnapshotId: row.datasetSnapshotId,
    createdAt: row.createdAt.toISOString(),
    attempt: row.attempt,
    recipe: row.recipe,
    state,
  });
}

function toEpoch(row: EpochRow): TrainingEpoch {
  return trainingEpochSchema.parse({
    attempt: row.attempt,
    epoch: row.epoch,
    recordedAt: row.recordedAt.toISOString(),
    train: {
      box: row.trainBoxLoss,
      cls: row.trainClsLoss,
      dfl: row.trainDflLoss,
    },
    val: { box: row.valBoxLoss, cls: row.valClsLoss, dfl: row.valDflLoss },
    precision: row.precision,
    recall: row.recall,
    map50: row.map50,
    map5095: row.map5095,
    fitness: row.fitness,
    lr: row.lr,
  });
}

/** Every state column, so a transition never leaves stale values behind. */
function stateColumns(
  state: TrainingRun["state"],
): Pick<
  Row,
  | "status"
  | "workerId"
  | "leaseExpiresAt"
  | "phase"
  | "progress"
  | "error"
  | "modelVersionId"
> {
  const cleared = {
    workerId: null,
    leaseExpiresAt: null,
    phase: null,
    progress: null,
    error: null,
    modelVersionId: null,
  };
  switch (state.status) {
    case "queued":
      return { ...cleared, status: state.status };
    case "running":
      return {
        ...cleared,
        status: state.status,
        workerId: state.workerId,
        leaseExpiresAt: new Date(state.leaseExpiresAt),
        phase: state.phase,
        progress: state.progress,
      };
    case "publishing":
      return { ...cleared, status: state.status, workerId: state.workerId };
    case "succeeded":
      return {
        ...cleared,
        status: state.status,
        modelVersionId: state.modelVersionId,
      };
    case "failed":
      return { ...cleared, status: state.status, error: state.error };
  }
}

async function transition(
  runId: string,
  state: TrainingRun["state"],
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .update(trainingRuns)
    .set(stateColumns(state))
    .where(eq(trainingRuns.id, runId))
    .returning();
  return returned(row, runId);
}

/**
 * Applies a worker's transition only while the run is still leased to it; the
 * predicate is evaluated by the update, so a lease lost meanwhile cannot be
 * overwritten.
 */
async function ownedTransition(
  runId: string,
  workerId: string,
  state: TrainingRun["state"],
  db: Executor,
): Promise<TrainingRun> {
  const [row] = await db
    .update(trainingRuns)
    .set(stateColumns(state))
    .where(
      and(
        eq(trainingRuns.id, runId),
        eq(trainingRuns.status, "running"),
        eq(trainingRuns.workerId, workerId),
      ),
    )
    .returning();
  if (!row) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${workerId}`,
    );
  }
  return toRun(row);
}

function leaseFrom(at: Date): string {
  return new Date(at.getTime() + LEASE_MILLISECONDS).toISOString();
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
  // Digest input, shared with the Python inference adapter: weights, NUL, then
  // the canonical inference settings (`ready` is publication state, not a setting).
  const hash = createHash("sha256").update(weights).update("\0");
  hash.update(
    canonical({
      confidence: publication.inference.confidence,
      end2end: publication.inference.end2end,
      imgsz: publication.inference.imgsz,
      max_det: publication.inference.max_det,
    }),
  );
  return hash.digest("hex");
}

function assertMatchingArtifact(
  key: (file: string) => string,
  weights: Uint8Array,
  publication: InferencePublication,
  runId: string,
): void {
  const storedWeights = readBlob(key("weights/best.pt"));
  const storedPublication = inferencePublicationSchema.parse(
    JSON.parse(new TextDecoder().decode(readBlob(key("inference.json")))),
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

export async function readTrainingRun(
  runId: string,
  db?: Executor,
): Promise<TrainingRun | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.id, runId));
  return row ? toRun(row) : null;
}

/** Runs for a model, newest first. */
export async function listTrainingRuns(
  modelId: string,
): Promise<TrainingRun[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(trainingRuns)
    .where(eq(trainingRuns.modelId, modelId))
    .orderBy(desc(trainingRuns.createdAt));
  return rows.map(toRun);
}

export async function countTrainingRuns(): Promise<number> {
  const db = await database();
  const [row] = await db.select({ count: count() }).from(trainingRuns);
  return row?.count ?? 0;
}

/** The run still queued, leased, or publishing for a model; at most one exists. */
export async function activeTrainingRun(
  modelId: string,
  db?: Executor,
): Promise<TrainingRun | null> {
  const [row] = await (db ?? (await database()))
    .select()
    .from(trainingRuns)
    .where(
      and(
        eq(trainingRuns.modelId, modelId),
        inArray(trainingRuns.status, [...ACTIVE_STATUSES]),
      ),
    );
  return row ? toRun(row) : null;
}

export async function createTrainingRun(
  datasetId: string,
  recipe: TrainingRecipe,
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    const dataset = await readDataset(datasetId, tx);
    if (!dataset) throw new Error(`Unknown dataset: ${datasetId}`);
    const active = await activeTrainingRun(dataset.modelId, tx);
    if (active) {
      throw new TrainingRunConflictError(
        `Training run ${active.id} is still active for ${dataset.modelId}`,
      );
    }
    const snapshot = await createDatasetSnapshot(datasetId, tx);
    const [row] = await tx
      .insert(trainingRuns)
      .values({
        id: trainingRunId(randomUUID()),
        modelId: snapshot.modelId,
        datasetSnapshotId: snapshot.id,
        createdAt: new Date(),
        attempt: 0,
        recipe: trainingRecipeSchema.parse(recipe),
        ...stateColumns({ status: "queued" }),
      })
      .returning();
    return returned(row, snapshot.id);
  });
}

/**
 * Leases the oldest claimable run to a worker. A worker holding a live lease
 * gets that run back; the row lock serialises competing workers.
 */
export async function claimTrainingRun(
  workerId: string,
  at: Date = new Date(),
): Promise<TrainingRun | null> {
  if (!(await readTrainingWorker(workerId))) {
    throw new Error("Training worker must heartbeat before claiming work");
  }
  const recovery = await recoverTrainingPublications();
  if (recovery.failed.length > 0) {
    throw new Error(
      `Training publication recovery failed for ${recovery.failed
        .map(({ runId }) => runId)
        .join(", ")}`,
    );
  }
  return transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.status, "running"),
          eq(trainingRuns.workerId, workerId),
          gt(trainingRuns.leaseExpiresAt, at),
        ),
      );
    if (owned) return toRun(owned);
    const [candidate] = await tx
      .select()
      .from(trainingRuns)
      .where(
        or(
          eq(trainingRuns.status, "queued"),
          and(
            eq(trainingRuns.status, "running"),
            lte(trainingRuns.leaseExpiresAt, at),
          ),
        ),
      )
      .orderBy(asc(trainingRuns.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [row] = await tx
      .update(trainingRuns)
      .set({
        attempt: candidate.attempt + 1,
        ...stateColumns({
          status: "running",
          workerId,
          leaseExpiresAt: leaseFrom(at),
          phase: "preparing",
          progress: 0,
        }),
      })
      .where(eq(trainingRuns.id, candidate.id))
      .returning();
    return returned(row, candidate.id);
  });
}

/** The run as its leaseholder sees it; any other caller gets a conflict. */
async function ownedRunningRun(
  runId: string,
  workerId: string,
  db: Executor,
): Promise<TrainingRun> {
  const run = await readTrainingRun(runId, db);
  if (
    !run ||
    run.state.status !== "running" ||
    run.state.workerId !== workerId
  ) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${workerId}`,
    );
  }
  return run;
}

export async function reportTrainingProgress(
  runId: string,
  workerId: string,
  phase: TrainingPhase,
  progress: number,
  at: Date = new Date(),
): Promise<TrainingRun> {
  return ownedTransition(
    runId,
    workerId,
    {
      status: "running",
      workerId,
      leaseExpiresAt: leaseFrom(at),
      phase,
      progress,
    },
    await database(),
  );
}

/**
 * Records one finished epoch and carries the run's progress with it. A repeated
 * report for the same epoch replaces the row, so a retried upload is harmless.
 */
export async function recordTrainingEpoch(
  runId: string,
  workerId: string,
  report: TrainingEpochReport,
  at: Date = new Date(),
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    const current = await ownedRunningRun(runId, workerId, tx);
    const total = current.recipe.parameters.epochs;
    if (report.epoch > total) {
      throw new TrainingRunConflictError(
        `Training run ${runId} has ${total} epochs, not ${report.epoch}`,
      );
    }
    await tx
      .insert(trainingEpochs)
      .values({
        runId,
        attempt: current.attempt,
        epoch: report.epoch,
        recordedAt: at,
        trainBoxLoss: report.train.box,
        trainClsLoss: report.train.cls,
        trainDflLoss: report.train.dfl,
        valBoxLoss: report.val.box,
        valClsLoss: report.val.cls,
        valDflLoss: report.val.dfl,
        precision: report.precision,
        recall: report.recall,
        map50: report.map50,
        map5095: report.map5095,
        fitness: report.fitness,
        lr: report.lr,
      })
      .onConflictDoUpdate({
        target: [
          trainingEpochs.runId,
          trainingEpochs.attempt,
          trainingEpochs.epoch,
        ],
        set: {
          recordedAt: at,
          trainBoxLoss: report.train.box,
          trainClsLoss: report.train.cls,
          trainDflLoss: report.train.dfl,
          valBoxLoss: report.val.box,
          valClsLoss: report.val.cls,
          valDflLoss: report.val.dfl,
          precision: report.precision,
          recall: report.recall,
          map50: report.map50,
          map5095: report.map5095,
          fitness: report.fitness,
          lr: report.lr,
        },
      });
    return ownedTransition(
      runId,
      workerId,
      {
        status: "running",
        workerId,
        leaseExpiresAt: leaseFrom(at),
        phase: "training",
        progress: report.epoch / total,
      },
      tx,
    );
  });
}

/** Every recorded epoch of a run, oldest attempt first. */
export async function listTrainingEpochs(
  runId: string,
): Promise<TrainingEpoch[]> {
  const db = await database();
  const rows = await db
    .select()
    .from(trainingEpochs)
    .where(eq(trainingEpochs.runId, runId))
    .orderBy(asc(trainingEpochs.attempt), asc(trainingEpochs.epoch));
  return rows.map(toEpoch);
}

/** The latest attempt's epochs for each run, keyed by run id. */
export async function latestAttemptEpochs(
  runIds: string[],
): Promise<Map<string, TrainingEpoch[]>> {
  const result = new Map<string, TrainingEpoch[]>();
  if (runIds.length === 0) return result;
  const db = await database();
  const rows = await db
    .select({ epoch: trainingEpochs, attempt: trainingRuns.attempt })
    .from(trainingEpochs)
    .innerJoin(trainingRuns, eq(trainingRuns.id, trainingEpochs.runId))
    .where(
      and(
        inArray(trainingEpochs.runId, runIds),
        eq(trainingEpochs.attempt, trainingRuns.attempt),
      ),
    )
    .orderBy(asc(trainingEpochs.epoch));
  for (const { epoch } of rows) {
    const epochs = result.get(epoch.runId) ?? [];
    epochs.push(toEpoch(epoch));
    result.set(epoch.runId, epochs);
  }
  return result;
}

export async function failTrainingRun(
  runId: string,
  workerId: string,
  error: string,
): Promise<TrainingRun> {
  return ownedTransition(
    runId,
    workerId,
    { status: "failed", error: error.slice(0, 2000) },
    await database(),
  );
}

async function stageTrainingArtifact(
  runId: string,
  workerId: string,
  weights: Uint8Array,
  inference: unknown,
): Promise<TrainingRun> {
  const parsed = inferencePublicationSchema.safeParse(inference);
  if (!parsed.success) {
    throw new TrainingArtifactValidationError(parsed.error.message);
  }
  const publication = parsed.data;
  return transaction(async (tx) => {
    const current = await readTrainingRun(runId, tx);
    if (!current)
      throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
    if (
      canonical(publication.training) !==
      canonical({
        base_model: current.recipe.baseModel,
        parameters: current.recipe.parameters,
        runtime: current.recipe.runtime,
      })
    ) {
      throw new TrainingArtifactValidationError(
        "Training artifact identity does not match the run recipe",
      );
    }
    if (current.state.status === "publishing") {
      assertMatchingArtifact(
        (file) => stagingKey(runId, file),
        weights,
        publication,
        runId,
      );
      return current;
    }
    if (current.state.status === "succeeded") {
      assertMatchingArtifact(
        (file) => artifactKey(trainedVersionId(current), file),
        weights,
        publication,
        runId,
      );
      return current;
    }
    const staged = await ownedTransition(
      runId,
      workerId,
      { status: "publishing", workerId },
      tx,
    );
    writeBlob(stagingKey(runId, "weights/best.pt"), weights);
    writeBlob(
      stagingKey(runId, "inference.json"),
      `${JSON.stringify(publication, null, 2)}\n`,
    );
    return staged;
  });
}

/** Upload and server-side publication are one recoverable, idempotent operation. */
export async function publishTrainingArtifact(
  runId: string,
  workerId: string,
  weights: Uint8Array,
  inference: unknown,
): Promise<TrainingRun> {
  await stageTrainingArtifact(runId, workerId, weights, inference);
  return finalizeTrainingPublication(runId);
}

/**
 * Moves the staged artifact into place, then registers the version and
 * completes the run in one transaction. The row lock serialises the worker's
 * upload with server-side recovery, and repeating any step is harmless.
 */
async function finalizeTrainingPublication(
  runId: string,
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(trainingRuns)
      .where(eq(trainingRuns.id, runId))
      .for("update");
    const current = returned(row, runId);
    if (current.state.status === "succeeded") return current;
    if (current.state.status !== "publishing") {
      throw new TrainingRunConflictError(
        `Training run ${runId} is not ready to publish`,
      );
    }
    const snapshot = await readDatasetSnapshot(current.datasetSnapshotId, tx);
    if (!snapshot)
      throw new Error(`Missing snapshot ${current.datasetSnapshotId}`);
    const versionId = trainedVersionId(current);
    if (!blobExists(artifactKey(versionId, "weights/best.pt"))) {
      if (!blobExists(stagingKey(runId, "weights/best.pt"))) {
        throw new Error(`Missing staged artifact for training run ${runId}`);
      }
      moveBlobDirectory(
        `training-staging/${runId}`,
        `model-artifacts/${versionId}`,
      );
    }
    const weights = readBlob(artifactKey(versionId, "weights/best.pt"));
    const publication = inferencePublicationSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          readBlob(artifactKey(versionId, "inference.json")),
        ),
      ),
    );
    const version = await registerModelVersion(
      {
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
          path: artifactKey(versionId, "weights/best.pt"),
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
            parameters: publication.training.parameters,
            runtime: publication.training.runtime,
          },
        },
      },
      tx,
    );
    return transition(
      runId,
      { status: "succeeded", modelVersionId: version.id },
      tx,
    );
  });
}

export interface TrainingPublicationRecovery {
  recovered: string[];
  failed: Array<{ runId: string; error: string }>;
}

/** Completes publications a server interruption left in `publishing`. */
export async function recoverTrainingPublications(): Promise<TrainingPublicationRecovery> {
  const result: TrainingPublicationRecovery = { recovered: [], failed: [] };
  const db = await database();
  const rows = await db
    .select({ id: trainingRuns.id })
    .from(trainingRuns)
    .where(eq(trainingRuns.status, "publishing"));
  for (const { id } of rows) {
    try {
      await finalizeTrainingPublication(id);
      result.recovered.push(id);
    } catch (error) {
      result.failed.push({
        runId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function snapshotForRun(runId: string, workerId: string) {
  const db = await database();
  const run = await ownedRunningRun(runId, workerId, db);
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId, db);
  if (!snapshot) throw new Error(`Missing snapshot ${run.datasetSnapshotId}`);
  return snapshot;
}
