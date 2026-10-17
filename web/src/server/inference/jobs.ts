import { and, asc, eq, gt, inArray, isNull, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { database, transaction, type Executor } from "../infra/db/client";
import {
  datasetSnapshotImages,
  experimentObservationImages,
  experimentObservations,
  inferenceJobs,
  inferenceOutcomes,
  modelVersions,
  models,
} from "../infra/db/schema";
import type { InferenceOutcome } from "../../domain/detection/schema";
import {
  inferenceAssignmentSchema,
  inferenceModelManifest,
  type InferenceAssignment,
} from "../../domain/inference/assignments";
import {
  supportsRuntime,
  type ModelArtifact,
} from "../../domain/models/schema";
import type { Worker, WorkerIdentity } from "../../domain/workers/schema";
import { readModel, toModelVersion } from "../models/public";
import {
  leaseIsHeld,
  lockWorkerSession,
  sessionIsCurrent,
} from "../workers/public";
import { storeInferenceOutcome, type DetectionTarget } from "./outcomes";
import { currentVersion } from "./queries";

export class InferenceClaimRejectedError extends Error {}

/** Complete only the task currently owned by this worker session. */
export async function completeInferenceClaim(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<Worker, "workerId" | "sessionId" | "runtimes">,
  at: Date = new Date(),
): Promise<InferenceOutcome> {
  return transaction(async (tx) => {
    const [consumed] = await tx
      .delete(inferenceJobs)
      .where(ownedActiveInferenceClaim(target, worker, at))
      .returning({ imageId: inferenceJobs.imageId });
    if (!consumed) {
      throw new InferenceClaimRejectedError(
        `${target.versionId}/${target.digest} has no active lease for ${worker.workerId}/${worker.sessionId}`,
      );
    }
    return storeInferenceOutcome(target, outcome, worker, tx);
  });
}

const CLAIM_CANDIDATE_LIMIT = 64;
export const INFERENCE_LEASE_SECONDS = 5 * 60;

function inferenceLeaseUntil(at: Date): Date {
  return new Date(at.getTime() + INFERENCE_LEASE_SECONDS * 1000);
}

function ownedActiveInferenceClaim(
  target: DetectionTarget,
  owner: Pick<Worker, "workerId" | "sessionId">,
  at: Date,
) {
  return and(
    eq(inferenceJobs.imageId, target.digest),
    eq(inferenceJobs.modelVersionId, target.versionId),
    eq(inferenceJobs.workerId, owner.workerId),
    eq(inferenceJobs.sessionId, owner.sessionId),
    gt(inferenceJobs.leaseExpiresAt, at),
    sessionIsCurrent(owner),
  );
}

/** Extend one live claim, but never revive an expired or superseded lease. */
export async function renewInferenceClaim(
  target: DetectionTarget,
  owner: Pick<Worker, "workerId" | "sessionId">,
  at: Date = new Date(),
): Promise<{ leaseExpiresAt: string }> {
  const db = await database();
  const leaseExpiresAt = inferenceLeaseUntil(at);
  const [renewed] = await db
    .update(inferenceJobs)
    .set({ leaseExpiresAt })
    .where(ownedActiveInferenceClaim(target, owner, at))
    .returning({ leaseExpiresAt: inferenceJobs.leaseExpiresAt });
  if (!renewed) {
    throw new InferenceClaimRejectedError(
      `${target.versionId}/${target.digest} has no active lease for ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return { leaseExpiresAt: renewed.leaseExpiresAt.toISOString() };
}

/**
 * Give back a claim the worker took ahead of time but will not start, so
 * another worker may take it now instead of when the lease would expire.
 * Releasing what is no longer held is not an error: the work moved on.
 */
export async function releaseInferenceClaim(
  target: DetectionTarget,
  owner: Pick<Worker, "workerId" | "sessionId">,
  at: Date = new Date(),
): Promise<void> {
  const db = await database();
  await db
    .delete(inferenceJobs)
    .where(ownedActiveInferenceClaim(target, owner, at));
}

/** Whether one of the worker's runtimes executes this artifact. */
function canExecute(
  worker: Pick<Worker, "runtimes">,
  artifact: ModelArtifact,
): boolean {
  return worker.runtimes.some((runtime) => supportsRuntime(artifact, runtime));
}

/** A bounded set of unclaimed or expired image-version demand. */
function claimableExperimentDemand(
  db: Executor,
  at: Date,
  artifactKinds: ("traditional" | "ultralytics")[],
) {
  return db
    .selectDistinct({
      digest: experimentObservationImages.imageId,
      versionId: modelVersions.id,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experimentObservations,
      and(
        eq(
          experimentObservations.experimentId,
          experimentObservationImages.experimentId,
        ),
        eq(
          experimentObservations.id,
          experimentObservationImages.observationId,
        ),
      ),
    )
    .innerJoin(
      modelVersions,
      eq(modelVersions.id, currentVersion(experimentObservations.modelId)),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
        eq(inferenceOutcomes.modelVersionId, modelVersions.id),
      ),
    )
    .leftJoin(
      inferenceJobs,
      and(
        eq(inferenceJobs.imageId, experimentObservationImages.imageId),
        eq(inferenceJobs.modelVersionId, modelVersions.id),
      ),
    )
    .where(
      and(
        isNull(inferenceOutcomes.imageId),
        inArray(sql`${modelVersions.artifact}->>'kind'`, artifactKinds),
        or(isNull(inferenceJobs.imageId), not(leaseIsHeld(inferenceJobs, at))),
      ),
    )
    .orderBy(asc(modelVersions.id), asc(experimentObservationImages.imageId))
    .limit(CLAIM_CANDIDATE_LIMIT);
}

/**
 * What a person needs to judge a candidate: every trained version that is not
 * current reads the validation images it was held out from, and so does the
 * current version, so both are compared on the same reviewed images.
 */
function claimableEvaluationDemand(
  db: Executor,
  at: Date,
  artifactKinds: ("traditional" | "ultralytics")[],
) {
  const candidate = alias(modelVersions, "candidate");
  return db
    .selectDistinct({
      digest: datasetSnapshotImages.imageId,
      versionId: modelVersions.id,
    })
    .from(candidate)
    .innerJoin(models, eq(models.id, candidate.modelId))
    .innerJoin(
      datasetSnapshotImages,
      and(
        eq(datasetSnapshotImages.snapshotId, candidate.sourceDatasetSnapshotId),
        eq(datasetSnapshotImages.split, "val"),
      ),
    )
    .innerJoin(
      modelVersions,
      or(
        eq(modelVersions.id, candidate.id),
        eq(modelVersions.id, models.currentVersionId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, datasetSnapshotImages.imageId),
        eq(inferenceOutcomes.modelVersionId, modelVersions.id),
      ),
    )
    .leftJoin(
      inferenceJobs,
      and(
        eq(inferenceJobs.imageId, datasetSnapshotImages.imageId),
        eq(inferenceJobs.modelVersionId, modelVersions.id),
      ),
    )
    .where(
      and(
        sql`${models.currentVersionId} is distinct from ${candidate.id}`,
        isNull(inferenceOutcomes.imageId),
        inArray(sql`${modelVersions.artifact}->>'kind'`, artifactKinds),
        or(isNull(inferenceJobs.imageId), not(leaseIsHeld(inferenceJobs, at))),
      ),
    )
    .orderBy(asc(modelVersions.id), asc(datasetSnapshotImages.imageId))
    .limit(CLAIM_CANDIDATE_LIMIT);
}

/**
 * Atomically claim one image-version pair for a worker's current session.
 * Experiments come first, then the comparison of candidates against the
 * current version; an expired task may be fenced to a new worker session.
 */
export async function claimInferenceAssignment(
  owner: WorkerIdentity,
  at: Date = new Date(),
): Promise<InferenceAssignment | null> {
  return transaction(async (tx) => {
    const worker = await lockWorkerSession(owner, tx);
    const artifactKinds = [
      ...new Set(worker.runtimes.map(({ adapter }) => adapter)),
    ];
    const pairs = [
      ...(await claimableExperimentDemand(tx, at, artifactKinds)),
      ...(await claimableEvaluationDemand(tx, at, artifactKinds)),
    ];
    if (pairs.length === 0) return null;
    const versionIds = [...new Set(pairs.map((pair) => pair.versionId))].sort();
    const versions = await tx
      .select()
      .from(modelVersions)
      .where(inArray(modelVersions.id, versionIds))
      .orderBy(asc(modelVersions.id));
    const byId = new Map(
      versions.map((row) => {
        const version = toModelVersion(row);
        return [version.id, version] as const;
      }),
    );
    const leaseExpiresAt = inferenceLeaseUntil(at);
    for (const pair of pairs) {
      const version = byId.get(pair.versionId);
      if (!version || !canExecute(worker, version.artifact)) continue;
      const values = {
        imageId: pair.digest,
        modelVersionId: pair.versionId,
        workerId: worker.workerId,
        sessionId: worker.sessionId,
        attempt: 1,
        leaseExpiresAt,
      };
      let [claimed] = await tx
        .insert(inferenceJobs)
        .values(values)
        .onConflictDoNothing()
        .returning({ imageId: inferenceJobs.imageId });
      if (!claimed) {
        [claimed] = await tx
          .update(inferenceJobs)
          .set({
            workerId: worker.workerId,
            sessionId: worker.sessionId,
            attempt: sql`${inferenceJobs.attempt} + 1`,
            leaseExpiresAt,
          })
          .where(
            and(
              eq(inferenceJobs.imageId, pair.digest),
              eq(inferenceJobs.modelVersionId, pair.versionId),
              not(leaseIsHeld(inferenceJobs, at)),
            ),
          )
          .returning({ imageId: inferenceJobs.imageId });
      }
      if (!claimed) continue;
      const model = await readModel(version.modelId, tx);
      if (!model) throw new Error(`Version ${version.id} has no model`);
      return inferenceAssignmentSchema.parse({
        manifest: inferenceModelManifest(version, model),
        image: pair.digest,
      });
    }
    return null;
  });
}
