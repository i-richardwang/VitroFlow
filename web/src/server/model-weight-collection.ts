import { eq } from "drizzle-orm";

import { transaction } from "../db/client";
import { trainingRuns } from "../db/schema";
import { fingerprintSchema, versionIdSchema } from "../inference/schema";
import { listBlobs, modelWeightsBlobKey, removeBlob } from "./blobs";
import { readModelVersion } from "./model-registry";

interface ModelWeightsRef {
  trainingRunId: string;
  trainingAttempt: number;
  digest: string;
}

function parseModelWeightsKey(key: string): ModelWeightsRef | null {
  const [prefix, runIdValue, attemptValue, digestValue, extra] = key.split("/");
  const runId = versionIdSchema.safeParse(runIdValue);
  const digest = fingerprintSchema.safeParse(digestValue);
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

/**
 * Removes weights that belong to neither an active training attempt nor its
 * published ModelVersion. The collector and publisher lock the same run row,
 * making those two roots exhaustive without a separate reservation model.
 */
export async function collectUnreferencedModelWeights(): Promise<string[]> {
  const collected: string[] = [];
  for (const key of await listBlobs("model-weights/")) {
    const reference = parseModelWeightsKey(key);
    if (!reference) continue;
    const removed = await transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(trainingRuns)
        .where(eq(trainingRuns.id, reference.trainingRunId))
        .for("update");
      if (
        run?.status === "running" &&
        run.attempt === reference.trainingAttempt
      ) {
        return false;
      }
      if (run?.status === "succeeded" && run.modelVersionId) {
        const version = await readModelVersion(run.modelVersionId, tx);
        if (
          version?.source.kind === "training_run" &&
          version.source.trainingRunId === reference.trainingRunId &&
          version.source.trainingAttempt === reference.trainingAttempt &&
          version.artifact.kind === "ultralytics" &&
          version.artifact.weights.digest === reference.digest
        ) {
          return false;
        }
      }
      await removeBlob(key);
      return true;
    });
    if (removed) collected.push(key);
  }
  return collected;
}
