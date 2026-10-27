import type { TrainingCheckpoint } from "../../domain/training/schema";
import {
  resourceIdSchema,
  sha256Schema,
} from "../../domain/identifiers/schema";

interface TrainingArtifactRef {
  trainingRunId: string;
  trainingAttempt: number;
  digest: string;
}

export function parseCheckpointKey(key: string): TrainingArtifactRef | null {
  return parseTrainingArtifactKey("training-checkpoints", key);
}

function parseTrainingArtifactKey(
  expectedPrefix: string,
  key: string,
): TrainingArtifactRef | null {
  const [prefix, runIdValue, attemptValue, digestValue, extra] = key.split("/");
  const runId = resourceIdSchema.safeParse(runIdValue);
  const digest = sha256Schema.safeParse(digestValue);
  const trainingAttempt = Number(attemptValue);
  if (
    prefix !== expectedPrefix ||
    extra !== undefined ||
    !runId.success ||
    !digest.success ||
    !Number.isSafeInteger(trainingAttempt) ||
    trainingAttempt < 1
  ) {
    return null;
  }
  const reference = {
    trainingRunId: runId.data,
    trainingAttempt,
    digest: digest.data,
  };
  return key ===
    `${expectedPrefix}/${reference.trainingRunId}/${reference.trainingAttempt}/${reference.digest}`
    ? reference
    : null;
}

export function checkpointBlobKey(
  runId: string,
  checkpoint: TrainingCheckpoint,
): string {
  return `training-checkpoints/${runId}/${checkpoint.attempt}/${checkpoint.digest}`;
}
