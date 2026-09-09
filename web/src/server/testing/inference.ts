import { and, eq } from "drizzle-orm";
import type { InferenceOutcome } from "../../detection/schema";
import type { Worker } from "../../workers/schema";
import { transaction } from "../infra/db/client";
import { inferenceJobs } from "../infra/db/schema";
import {
  storeInferenceOutcome,
  type DetectionTarget,
} from "../inference/outcomes";

/** Seed a canonical outcome without acquiring a worker lease. */
export async function seedInferenceOutcome(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<Worker, "runtimes">,
): Promise<InferenceOutcome> {
  return transaction(async (tx) => {
    const stored = await storeInferenceOutcome(target, outcome, worker, tx);
    await tx
      .delete(inferenceJobs)
      .where(
        and(
          eq(inferenceJobs.imageId, target.digest),
          eq(inferenceJobs.modelVersionId, target.versionId),
        ),
      );
    return stored;
  });
}
