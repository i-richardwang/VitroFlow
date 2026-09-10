import {
  resourceIdSchema,
  sha256Schema,
} from "../../domain/identifiers/schema";

export function modelWeightsBlobKey(
  trainingRunId: string,
  trainingAttempt: number,
  digest: string,
): string {
  return `model-weights/${trainingRunId}/${trainingAttempt}/${digest}`;
}

interface ModelWeightsRef {
  trainingRunId: string;
  trainingAttempt: number;
  digest: string;
}

export function parseModelWeightsKey(key: string): ModelWeightsRef | null {
  const [prefix, runIdValue, attemptValue, digestValue, extra] = key.split("/");
  const runId = resourceIdSchema.safeParse(runIdValue);
  const digest = sha256Schema.safeParse(digestValue);
  const trainingAttempt = Number(attemptValue);
  if (
    prefix !== "model-weights" ||
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
    modelWeightsBlobKey(
      reference.trainingRunId,
      reference.trainingAttempt,
      reference.digest,
    )
    ? reference
    : null;
}
