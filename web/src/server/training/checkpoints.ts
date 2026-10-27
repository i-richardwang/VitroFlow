import { and, eq } from "drizzle-orm";
import type {
  TrainingAttemptOwner,
  TrainingCheckpoint,
} from "../../domain/training/schema";
import { TrainingRunConflictError } from "../../domain/training/errors";
import { transaction, database } from "../infra/db/client";
import { trainingEpochs, trainingRuns } from "../infra/db/schema";
import { putImmutableBlob, readBlob } from "../infra/blobs/store";
import { contentDigest } from "../infra/digest";
import {
  lockOwnedTrainingRun,
  readTrainingRun,
  requireOwnedRunningRun,
} from "./runs";
import { checkpointBlobKey } from "./keys";

/** Active attempts root uploads; a short transaction publishes only a still-owned checkpoint. */
export async function saveTrainingCheckpoint(
  runId: string,
  owner: TrainingAttemptOwner,
  epoch: number,
  bytes: Uint8Array,
) {
  const db = await database();
  const run = await requireOwnedRunningRun(
    runId,
    await readTrainingRun(runId, db),
    owner,
    db,
  );
  const [report] = await db
    .select()
    .from(trainingEpochs)
    .where(
      and(
        eq(trainingEpochs.runId, runId),
        eq(trainingEpochs.attempt, owner.attempt),
        eq(trainingEpochs.epoch, epoch),
      ),
    );
  if (!report || epoch >= run.recipe.parameters.epochs)
    throw new TrainingRunConflictError(
      "Checkpoint must describe a reported, resumable epoch",
    );
  const checkpoint: TrainingCheckpoint = {
    attempt: owner.attempt,
    epoch,
    bytes: bytes.byteLength,
    digest: contentDigest(bytes),
  };
  await putImmutableBlob(checkpointBlobKey(runId, checkpoint), bytes);
  return transaction(async (tx) => {
    const current = await lockOwnedTrainingRun(runId, owner, tx);
    if (current.checkpoint && epoch < current.checkpoint.epoch)
      throw new TrainingRunConflictError("Checkpoint cannot move backwards");
    await tx
      .update(trainingRuns)
      .set({ checkpoint })
      .where(eq(trainingRuns.id, runId));
    return checkpoint;
  });
}

export async function readTrainingCheckpoint(
  runId: string,
  owner: TrainingAttemptOwner,
) {
  const db = await database();
  const run = await requireOwnedRunningRun(
    runId,
    await readTrainingRun(runId, db),
    owner,
    db,
  );
  if (!run.checkpoint) return null;
  const bytes = await readBlob(checkpointBlobKey(runId, run.checkpoint));
  if (!bytes) throw new Error("Training checkpoint is missing");
  return bytes;
}
