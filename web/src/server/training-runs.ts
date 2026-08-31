import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  datasetSnapshots,
  trainingEpochs,
  trainingRuns,
  trainingWorkers,
} from "../db/schema";
import { sameModelVersion, type ModelVersion } from "../models/schema";
import { canonicalJson } from "../json/canonical";
import {
  ACTIVE_TRAINING_RUN_STATUSES,
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
import type { TrainingRunSummary } from "../training/read-model";
import type { TrainingWorkerIdentity } from "../training/workers";
import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../training/errors";
import { contentDigest, modelWeightsBlobKey, putImmutableBlob } from "./blobs";
import {
  createDatasetSnapshot,
  readDatasetSnapshot,
} from "./dataset-snapshots";
import { readDataset } from "./datasets";
import { readModelVersion, registerModelVersion } from "./model-registry";

const LEASE_MILLISECONDS = 5 * 60 * 1000;
const PHASE_PROGRESS: Record<TrainingPhase, number> = {
  preparing: 0,
  training: 0.05,
  validating: 0.9,
};
const TRAINING_PROGRESS_RANGE =
  PHASE_PROGRESS.validating - PHASE_PROGRESS.training;
const NEXT_PHASE: Record<TrainingPhase, TrainingPhase | null> = {
  preparing: "training",
  training: "validating",
  validating: null,
};

/** A workbench page stays bounded while exact totals remain separate. */
export const TRAINING_RUN_LIST_LIMIT = 100;

type Row = typeof trainingRuns.$inferSelect;
type EpochRow = typeof trainingEpochs.$inferSelect;
type RunningTrainingRun = TrainingRun & {
  state: Extract<TrainingRun["state"], { status: "running" }>;
};

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
          sessionId: row.sessionId,
          leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
          phase: row.phase,
          progress: row.progress,
        };
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
      classification: row.trainClassificationLoss,
      regression: row.trainRegressionLoss,
    },
    val: {
      box: row.valBoxLoss,
      classification: row.valClassificationLoss,
      regression: row.valRegressionLoss,
    },
    precision: row.precision,
    recall: row.recall,
    map50: row.map50,
    map50To95: row.map50To95,
    fitness: row.fitness,
    learningRate: row.learningRate,
  });
}

/** Every state column, so a transition never leaves stale values behind. */
function stateColumns(
  state: TrainingRun["state"],
): Pick<
  Row,
  | "status"
  | "workerId"
  | "sessionId"
  | "leaseExpiresAt"
  | "phase"
  | "progress"
  | "error"
  | "modelVersionId"
> {
  const cleared = {
    workerId: null,
    sessionId: null,
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
        sessionId: state.sessionId,
        leaseExpiresAt: new Date(state.leaseExpiresAt),
        phase: state.phase,
        progress: state.progress,
      };
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
  owner: TrainingWorkerIdentity,
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
        eq(trainingRuns.workerId, owner.workerId),
        eq(trainingRuns.sessionId, owner.sessionId),
        currentWorkerSession(owner),
      ),
    )
    .returning();
  if (!row) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return toRun(row);
}

function leaseUntil(at: Date): Date {
  return new Date(at.getTime() + LEASE_MILLISECONDS);
}

function leaseFrom(at: Date): string {
  return leaseUntil(at).toISOString();
}

/** A session is a fencing token: only the process in the worker roster may write. */
function currentWorkerSession(owner: TrainingWorkerIdentity) {
  return sql`exists (
    select 1 from ${trainingWorkers}
    where ${trainingWorkers.id} = ${owner.workerId}
      and ${trainingWorkers.sessionId} = ${owner.sessionId}
  )`;
}

function artifactDigest(
  weights: Uint8Array,
  publication: InferencePublication,
): string {
  // Digest input, shared with the Python inference adapter: weights, NUL, then
  // the canonical inference settings (`ready` is publication state, not a setting).
  const hash = createHash("sha256").update(weights).update("\0");
  hash.update(
    canonicalJson({
      confidence: publication.inference.confidence,
      endToEnd: publication.inference.endToEnd,
      imageSize: publication.inference.imageSize,
      maxDetections: publication.inference.maxDetections,
    }),
  );
  return hash.digest("hex");
}

function trainedModelVersion(
  run: TrainingRun,
  weights: Uint8Array,
  publication: InferencePublication,
): ModelVersion {
  const versionId = trainedVersionId(run);
  const weightsDigest = contentDigest(weights);
  return {
    schemaVersion: 1,
    id: versionId,
    modelId: run.modelId,
    name: `YOLO26 ${run.createdAt}`,
    createdAt: run.createdAt,
    source: {
      kind: "training_run",
      trainingRunId: run.id,
      trainingAttempt: run.attempt,
      datasetSnapshotId: run.datasetSnapshotId,
    },
    artifact: {
      kind: "ultralytics",
      digest: artifactDigest(weights, publication),
      weights: { digest: weightsDigest, bytes: weights.byteLength },
      inference: {
        confidence: publication.inference.confidence,
        imageSize: publication.inference.imageSize,
        maxDetections: publication.inference.maxDetections,
        endToEnd: publication.inference.endToEnd,
      },
      validation: publication.validation,
      training: {
        baseModel: {
          reference: publication.training.baseModel.reference,
          digest: publication.training.baseModel.digest,
        },
        parameters: publication.training.parameters,
        runtime: publication.training.runtime,
      },
    },
  };
}

async function assertPublishedVersion(
  run: TrainingRun,
  modelVersionId: string,
  expected: ModelVersion,
  db: Executor,
): Promise<TrainingRun> {
  const existing = await readModelVersion(modelVersionId, db);
  if (!existing || !sameModelVersion(existing, expected)) {
    throw new TrainingRunConflictError(
      `Training run ${run.id} already has a different artifact`,
    );
  }
  return run;
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

/** The newest bounded page of runs, with current-attempt metrics aggregated by SQL. */
export async function listTrainingRunSummaries(
  options: { datasetId?: string; limit?: number } = {},
): Promise<TrainingRunSummary[]> {
  const limit = options.limit ?? TRAINING_RUN_LIST_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > TRAINING_RUN_LIST_LIMIT
  ) {
    throw new Error(
      `Training run list limit must be between 1 and ${TRAINING_RUN_LIST_LIMIT}`,
    );
  }
  const db = await database();
  const rows = await db
    .select({
      dataset: datasetSnapshots.datasetId,
      run: trainingRuns,
      completed: sql<number>`(
        select count(*)::integer
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
      )`,
      bestMap50: sql<number | null>`(
        select ${trainingEpochs.map50}
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
        order by ${trainingEpochs.fitness} desc, ${trainingEpochs.epoch} asc
        limit 1
      )`,
      bestMap50To95: sql<number | null>`(
        select ${trainingEpochs.map50To95}
        from ${trainingEpochs}
        where ${trainingEpochs.runId} = ${trainingRuns.id}
          and ${trainingEpochs.attempt} = ${trainingRuns.attempt}
        order by ${trainingEpochs.fitness} desc, ${trainingEpochs.epoch} asc
        limit 1
      )`,
    })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(
      options.datasetId
        ? eq(datasetSnapshots.datasetId, options.datasetId)
        : undefined,
    )
    .orderBy(desc(trainingRuns.createdAt), desc(trainingRuns.id))
    .limit(limit);
  return rows.map((row) => ({
    dataset: row.dataset,
    run: toRun(row.run),
    completed: row.completed,
    best:
      row.bestMap50 == null || row.bestMap50To95 == null
        ? null
        : { map50: row.bestMap50, map50To95: row.bestMap50To95 },
  }));
}

/** Runs across all datasets, or the runs trained from one dataset's snapshots. */
export async function countTrainingRuns(datasetId?: string): Promise<number> {
  const db = await database();
  const [row] = await db
    .select({ count: count() })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(datasetId ? eq(datasetSnapshots.datasetId, datasetId) : undefined);
  return row?.count ?? 0;
}

export async function countActiveTrainingRuns(
  modelId?: string,
): Promise<number> {
  const db = await database();
  const predicates = [
    inArray(trainingRuns.status, [...ACTIVE_TRAINING_RUN_STATUSES]),
  ];
  if (modelId) predicates.push(eq(trainingRuns.modelId, modelId));
  const [row] = await db
    .select({ count: count() })
    .from(trainingRuns)
    .where(and(...predicates));
  return row?.count ?? 0;
}

/** The newest run trained from a dataset, if it has ever trained. */
export async function latestTrainingRun(
  datasetId: string,
): Promise<TrainingRun | null> {
  const db = await database();
  const [row] = await db
    .select({ run: trainingRuns })
    .from(trainingRuns)
    .innerJoin(
      datasetSnapshots,
      eq(datasetSnapshots.id, trainingRuns.datasetSnapshotId),
    )
    .where(eq(datasetSnapshots.datasetId, datasetId))
    .orderBy(desc(trainingRuns.createdAt), desc(trainingRuns.id))
    .limit(1);
  return row ? toRun(row.run) : null;
}

/** The run still queued or leased for a model; at most one exists. */
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
        inArray(trainingRuns.status, [...ACTIVE_TRAINING_RUN_STATUSES]),
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
 * Leases the oldest claimable run to a worker session. A live session gets its
 * run back idempotently; a newer session of that worker starts a fresh attempt.
 */
export async function claimTrainingRun(
  owner: TrainingWorkerIdentity,
  at: Date = new Date(),
): Promise<TrainingRun | null> {
  return transaction(async (tx) => {
    const [worker] = await tx
      .select({ sessionId: trainingWorkers.sessionId })
      .from(trainingWorkers)
      .where(eq(trainingWorkers.id, owner.workerId))
      .for("update");
    if (!worker || worker.sessionId !== owner.sessionId) {
      throw new TrainingRunConflictError(
        "Training worker session must heartbeat before claiming work",
      );
    }
    const [owned] = await tx
      .select()
      .from(trainingRuns)
      .where(
        and(
          eq(trainingRuns.status, "running"),
          eq(trainingRuns.workerId, owner.workerId),
          eq(trainingRuns.sessionId, owner.sessionId),
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
          and(
            eq(trainingRuns.status, "running"),
            eq(trainingRuns.workerId, owner.workerId),
            ne(trainingRuns.sessionId, owner.sessionId),
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
          workerId: owner.workerId,
          sessionId: owner.sessionId,
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
  owner: TrainingWorkerIdentity,
  db: Executor,
): Promise<RunningTrainingRun> {
  return requireOwnedRunningRun(
    runId,
    await readTrainingRun(runId, db),
    owner,
    db,
  );
}

async function requireOwnedRunningRun(
  runId: string,
  run: TrainingRun | null,
  owner: TrainingWorkerIdentity,
  db: Executor,
): Promise<RunningTrainingRun> {
  const [worker] = await db
    .select({ sessionId: trainingWorkers.sessionId })
    .from(trainingWorkers)
    .where(eq(trainingWorkers.id, owner.workerId));
  if (
    worker?.sessionId !== owner.sessionId ||
    !run ||
    run.state.status !== "running" ||
    run.state.workerId !== owner.workerId ||
    run.state.sessionId !== owner.sessionId
  ) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return run as RunningTrainingRun;
}

/** Renew ownership without changing the run's phase or business progress. */
export async function renewTrainingLease(
  runId: string,
  owner: TrainingWorkerIdentity,
  at: Date = new Date(),
): Promise<TrainingRun> {
  const db = await database();
  const [row] = await db
    .update(trainingRuns)
    .set({ leaseExpiresAt: leaseUntil(at) })
    .where(
      and(
        eq(trainingRuns.id, runId),
        eq(trainingRuns.status, "running"),
        eq(trainingRuns.workerId, owner.workerId),
        eq(trainingRuns.sessionId, owner.sessionId),
        currentWorkerSession(owner),
      ),
    )
    .returning();
  if (!row) {
    throw new TrainingRunConflictError(
      `Training run ${runId} is not owned by ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return toRun(row);
}

/** Advance through the ordered execution phases; retries are idempotent. */
export async function enterTrainingPhase(
  runId: string,
  owner: TrainingWorkerIdentity,
  phase: TrainingPhase,
  at: Date = new Date(),
): Promise<TrainingRun> {
  const db = await database();
  const current = await ownedRunningRun(runId, owner, db);
  if (
    phase !== current.state.phase &&
    phase !== NEXT_PHASE[current.state.phase]
  ) {
    throw new TrainingRunConflictError(
      `Training run ${runId} cannot move from ${current.state.phase} to ${phase}`,
    );
  }
  return ownedTransition(
    runId,
    owner,
    {
      status: "running",
      workerId: owner.workerId,
      sessionId: owner.sessionId,
      leaseExpiresAt: leaseFrom(at),
      phase,
      progress: Math.max(current.state.progress, PHASE_PROGRESS[phase]),
    },
    db,
  );
}

/**
 * Records one finished epoch and carries the run's progress with it. A repeated
 * report for the same epoch replaces the row, so a retried upload is harmless.
 */
export async function recordTrainingEpoch(
  runId: string,
  owner: TrainingWorkerIdentity,
  report: TrainingEpochReport,
  at: Date = new Date(),
): Promise<TrainingRun> {
  return transaction(async (tx) => {
    const current = await ownedRunningRun(runId, owner, tx);
    if (current.state.phase !== "training") {
      throw new TrainingRunConflictError(
        `Training run ${runId} cannot record epochs while ${current.state.phase}`,
      );
    }
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
        trainClassificationLoss: report.train.classification,
        trainRegressionLoss: report.train.regression,
        valBoxLoss: report.val.box,
        valClassificationLoss: report.val.classification,
        valRegressionLoss: report.val.regression,
        precision: report.precision,
        recall: report.recall,
        map50: report.map50,
        map50To95: report.map50To95,
        fitness: report.fitness,
        learningRate: report.learningRate,
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
          trainClassificationLoss: report.train.classification,
          trainRegressionLoss: report.train.regression,
          valBoxLoss: report.val.box,
          valClassificationLoss: report.val.classification,
          valRegressionLoss: report.val.regression,
          precision: report.precision,
          recall: report.recall,
          map50: report.map50,
          map50To95: report.map50To95,
          fitness: report.fitness,
          learningRate: report.learningRate,
        },
      });
    return ownedTransition(
      runId,
      owner,
      {
        status: "running",
        workerId: owner.workerId,
        sessionId: owner.sessionId,
        leaseExpiresAt: leaseFrom(at),
        phase: "training",
        progress: Math.max(
          current.state.progress,
          PHASE_PROGRESS.training +
            TRAINING_PROGRESS_RANGE * (report.epoch / total),
        ),
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

export async function failTrainingRun(
  runId: string,
  owner: TrainingWorkerIdentity,
  error: string,
): Promise<TrainingRun> {
  return ownedTransition(
    runId,
    owner,
    { status: "failed", error: error.slice(0, 2000) },
    await database(),
  );
}

/**
 * Stores immutable weights under the current training attempt before a short
 * transaction makes the resulting version visible. Publication and garbage
 * collection serialize on the TrainingRun row, so an active attempt remains a
 * root until it either publishes a version or is superseded.
 */
export async function publishTrainingArtifact(
  runId: string,
  owner: TrainingWorkerIdentity,
  weights: Uint8Array,
  inference: unknown,
): Promise<TrainingRun> {
  const parsed = inferencePublicationSchema.safeParse(inference);
  if (!parsed.success) {
    throw new TrainingArtifactValidationError(parsed.error.message);
  }
  const publication = parsed.data;
  const weightsDigest = contentDigest(weights);
  const db = await database();
  const current = await readTrainingRun(runId, db);
  if (!current) {
    throw new TrainingRunNotFoundError(`Unknown training run: ${runId}`);
  }
  if (
    canonicalJson(publication.training) !==
    canonicalJson({
      baseModel: current.recipe.baseModel,
      parameters: current.recipe.parameters,
      runtime: current.recipe.runtime,
    })
  ) {
    throw new TrainingArtifactValidationError(
      "Training artifact identity does not match the run recipe",
    );
  }
  const version = trainedModelVersion(current, weights, publication);
  if (current.state.status === "succeeded") {
    return assertPublishedVersion(
      current,
      current.state.modelVersionId,
      version,
      db,
    );
  }
  await requireOwnedRunningRun(runId, current, owner, db);
  const trainingAttempt = current.attempt;
  await putImmutableBlob(
    modelWeightsBlobKey(runId, trainingAttempt, weightsDigest),
    weights,
  );

  return transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(trainingRuns)
      .where(eq(trainingRuns.id, runId))
      .for("update");
    const locked = returned(row, runId);
    if (locked.state.status === "succeeded") {
      return assertPublishedVersion(
        locked,
        locked.state.modelVersionId,
        version,
        tx,
      );
    }
    if (locked.attempt !== trainingAttempt) {
      throw new TrainingRunConflictError(
        `Training run ${runId} attempt ${trainingAttempt} was superseded`,
      );
    }
    await requireOwnedRunningRun(runId, locked, owner, tx);
    const registered = await registerModelVersion(version, tx);
    return transition(
      runId,
      { status: "succeeded", modelVersionId: registered.id },
      tx,
    );
  });
}

export async function snapshotForRun(
  runId: string,
  owner: TrainingWorkerIdentity,
) {
  const db = await database();
  const run = await ownedRunningRun(runId, owner, db);
  const snapshot = await readDatasetSnapshot(run.datasetSnapshotId, db);
  if (!snapshot) throw new Error(`Missing snapshot ${run.datasetSnapshotId}`);
  return snapshot;
}
