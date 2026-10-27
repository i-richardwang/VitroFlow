import { eq } from "drizzle-orm";

import { transaction } from "../infra/db/client";
import { trainingRuns } from "../infra/db/schema";
import { listBlobs, removeBlob } from "../infra/blobs/store";
import { checkpointBlobKey, parseCheckpointKey } from "./keys";

/** Checkpoints remain available for paused and failed tasks until explicitly restarted. */
export async function collectUnreferencedTrainingCheckpoints(): Promise<
  string[]
> {
  const collected: string[] = [];
  for (const key of await listBlobs("training-checkpoints/")) {
    const reference = parseCheckpointKey(key);
    if (!reference) continue;
    const { trainingRunId: runId, trainingAttempt: attempt } = reference;
    await transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(trainingRuns)
        .where(eq(trainingRuns.id, runId))
        .for("update");
      if (run?.status === "running" && run.attempt === attempt) return;
      if (
        run?.checkpoint &&
        !["cancelled", "succeeded"].includes(run.status) &&
        key === checkpointBlobKey(runId, run.checkpoint)
      )
        return;
      await removeBlob(key);
      collected.push(key);
    });
  }
  return collected;
}
