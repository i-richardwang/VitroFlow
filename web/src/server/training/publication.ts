import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { database, transaction, type Executor } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import { sameModelVersion, type ModelVersion } from "../../models/schema";
import { canonicalJson } from "../../json/canonical";
import {
  inferencePublicationSchema,
  type InferencePublication,
  type TrainingRun,
} from "../../training/schema";
import type { WorkerIdentity } from "../../workers/schema";
import {
  TrainingArtifactValidationError,
  TrainingRunConflictError,
  TrainingRunNotFoundError,
} from "../../training/errors";
import { putImmutableBlob } from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import { modelWeightsBlobKey } from "./keys";
import { readModelVersion, registerModelVersion } from "../models/public";
import {
  readTrainingRun,
  requireTrainingRunRow,
  requireOwnedRunningRun,
  transitionTrainingRun,
} from "./runs";

/** The version a run publishes; fixed by the run identity before training starts. */
function trainedVersionId(run: Pick<TrainingRun, "modelId" | "id">): string {
  return `${run.modelId}.${run.id}`;
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

/**
 * Stores immutable weights under the current training attempt before a short
 * transaction makes the resulting version visible. Publication and garbage
 * collection serialize on the TrainingRun row, so an active attempt remains a
 * root until it either publishes a version or is superseded.
 */
export async function publishTrainingArtifact(
  runId: string,
  owner: WorkerIdentity,
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
    const locked = requireTrainingRunRow(row, runId);
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
    return transitionTrainingRun(
      runId,
      { status: "succeeded", modelVersionId: registered.id },
      tx,
    );
  });
}
