import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  experimentObservationImages,
  experiments,
  images,
  inferenceJobs,
  inferenceOutcomes,
  inferenceWorkers,
  modelVersions,
} from "../db/schema";
import {
  isFailure,
  type DetectionResult,
  type InferenceOutcome,
} from "../detection/schema";
import {
  inferenceAssignmentSchema,
  inferenceModelManifest,
  type InferenceAssignment,
} from "../inference/assignments";
import { sameRuntimeDescriptor } from "../inference/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import { canonicalJson } from "../json/canonical";
import { assertInstanceClasses } from "../models/metrics";
import { supportsRuntime, type Model } from "../models/schema";
import { lockDetection } from "./detection-lock";
import { assertDocumentImage } from "./image-documents";
import { canExecute } from "./inference-worker-store";
import { readModel, toModelVersion } from "./model-registry";

/** One image under one model version: the pair a detection is recorded for. */
export interface DetectionTarget {
  versionId: string;
  digest: string;
}

/** Thrown when a version reports a different result for an image it already detected. */
export class DetectionConflictError extends Error {
  constructor({ versionId, digest }: DetectionTarget) {
    super(`${versionId} already detected ${digest} with a different result`);
  }
}

/** Thrown when an outcome is malformed or describes a different stored image. */
export class InvalidDetectionOutcomeError extends Error {}

/** Thrown when the path names an image that is not in the image store. */
export class DetectionImageNotFoundError extends Error {}

/** Thrown when an outcome's producer is not the version, artifact, and runtime it claims. */
export class ProducerMismatchError extends Error {}
export class InferenceClaimRejectedError extends Error {}

export async function readDetection(
  { versionId, digest }: DetectionTarget,
  db?: Executor,
): Promise<DetectionResult | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, digest),
        eq(inferenceOutcomes.modelVersionId, versionId),
        eq(inferenceOutcomes.status, "succeeded"),
      ),
    );
  return row && !isFailure(row.document) ? row.document : null;
}

/** Whether an experiment still requires this image-version outcome. */
export async function inferencePending(
  target: DetectionTarget,
  db?: Executor,
): Promise<boolean> {
  const [row] = await (db ?? (await database()))
    .select({ digest: experimentObservationImages.imageId })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      and(
        eq(experiments.id, experimentObservationImages.experimentId),
        eq(experiments.modelVersionId, target.versionId),
      ),
    )
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(
      and(
        eq(experimentObservationImages.imageId, target.digest),
        isNull(inferenceOutcomes.imageId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

function sameDocument(left: DetectionResult, right: DetectionResult): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function assertProducer(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<InferenceWorkerRecord, "runtimes">,
  tx: Executor,
): Promise<Model> {
  const { producer } = outcome;
  if (producer.modelVersionId !== target.versionId) {
    throw new ProducerMismatchError(
      `Outcome was produced by ${producer.modelVersionId}, not ${target.versionId}`,
    );
  }
  const [version] = await tx
    .select({
      artifact: modelVersions.artifact,
      artifactDigest: modelVersions.artifactDigest,
      modelId: modelVersions.modelId,
    })
    .from(modelVersions)
    .where(eq(modelVersions.id, target.versionId));
  if (!version) {
    throw new ProducerMismatchError(
      `Unknown model version: ${target.versionId}`,
    );
  }
  if (version.artifactDigest !== producer.artifactDigest) {
    throw new ProducerMismatchError(
      `Outcome was produced by an artifact ${target.versionId} does not have`,
    );
  }
  if (!supportsRuntime(version.artifact, producer.runtime)) {
    throw new ProducerMismatchError(
      `Runtime ${producer.runtime.adapter} cannot execute ${version.artifact.kind} artifacts`,
    );
  }
  if (
    !worker.runtimes.some((runtime) =>
      sameRuntimeDescriptor(runtime, producer.runtime),
    )
  ) {
    throw new ProducerMismatchError(
      "Outcome was produced by a runtime the worker does not advertise",
    );
  }
  const model = await readModel(version.modelId, tx);
  if (!model) {
    throw new ProducerMismatchError(`Unknown model: ${version.modelId}`);
  }
  return model;
}

/**
 * Records what a worker found for the pair. A detection is written once:
 * the same result resubmitted is accepted, a different one is refused, and
 * a failure arriving after a detection is ignored. A detection replaces any
 * failure recorded before it.
 */
async function storeInferenceOutcome(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<InferenceWorkerRecord, "runtimes">,
  tx: Executor,
): Promise<InferenceOutcome> {
  await lockDetection(target.digest, target.versionId, tx);
  const [image] = await tx
    .select({ digest: images.id, width: images.width, height: images.height })
    .from(images)
    .where(eq(images.id, target.digest));
  if (!image) {
    throw new DetectionImageNotFoundError(
      `Image ${target.digest} is not stored`,
    );
  }
  try {
    assertDocumentImage("Outcome", outcome.image, image);
  } catch (error) {
    throw new InvalidDetectionOutcomeError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const model = await assertProducer(target, outcome, worker, tx);
  if (!isFailure(outcome)) {
    try {
      assertInstanceClasses(model.classes, outcome.instances, "Outcome");
    } catch (error) {
      throw new InvalidDetectionOutcomeError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const [stored] = await tx
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
      ),
    );
  const existing = stored?.document;
  if (isFailure(outcome)) {
    if (existing && !isFailure(existing)) return existing;
    const row = { document: outcome, recordedAt: new Date() };
    await tx
      .insert(inferenceOutcomes)
      .values({
        imageId: target.digest,
        modelVersionId: target.versionId,
        ...row,
      })
      .onConflictDoUpdate({
        target: [inferenceOutcomes.imageId, inferenceOutcomes.modelVersionId],
        set: row,
      });
    return outcome;
  }
  if (existing && !isFailure(existing)) {
    if (!sameDocument(existing, outcome)) {
      throw new DetectionConflictError(target);
    }
    return existing;
  }
  const row = { document: outcome, recordedAt: new Date() };
  await tx
    .insert(inferenceOutcomes)
    .values({
      imageId: target.digest,
      modelVersionId: target.versionId,
      ...row,
    })
    .onConflictDoUpdate({
      target: [inferenceOutcomes.imageId, inferenceOutcomes.modelVersionId],
      set: row,
    });
  return outcome;
}

/** Store an outcome supplied by a trusted in-process caller. */
export async function recordInferenceOutcome(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<InferenceWorkerRecord, "runtimes">,
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

/** Complete only the task currently owned by this worker session. */
export async function completeInferenceClaim(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<InferenceWorkerRecord, "workerId" | "sessionId" | "runtimes">,
  at: Date = new Date(),
): Promise<InferenceOutcome> {
  return transaction(async (tx) => {
    const [consumed] = await tx
      .delete(inferenceJobs)
      .where(ownedActiveInferenceClaim(tx, target, worker, at))
      .returning({ imageId: inferenceJobs.imageId });
    if (!consumed) {
      throw new InferenceClaimRejectedError(
        `${target.versionId}/${target.digest} has no active lease for ${worker.workerId}/${worker.sessionId}`,
      );
    }
    return storeInferenceOutcome(target, outcome, worker, tx);
  });
}

/** Removes one failed attempt while holding the pair lock in the caller's transaction. */
export async function clearDetectionFailure(
  target: DetectionTarget,
  tx: Executor,
): Promise<void> {
  await lockDetection(target.digest, target.versionId, tx);
  await tx
    .delete(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
        eq(inferenceOutcomes.status, "failed"),
      ),
    );
}

const CLAIM_CANDIDATE_LIMIT = 64;
export const INFERENCE_LEASE_SECONDS = 5 * 60;

function inferenceLeaseUntil(at: Date): Date {
  return new Date(at.getTime() + INFERENCE_LEASE_SECONDS * 1000);
}

function ownedActiveInferenceClaim(
  db: Executor,
  target: DetectionTarget,
  owner: Pick<InferenceWorkerRecord, "workerId" | "sessionId">,
  at: Date,
) {
  return and(
    eq(inferenceJobs.imageId, target.digest),
    eq(inferenceJobs.modelVersionId, target.versionId),
    eq(inferenceJobs.workerId, owner.workerId),
    eq(inferenceJobs.sessionId, owner.sessionId),
    gt(inferenceJobs.leaseExpiresAt, at),
    exists(
      db
        .select({ workerId: inferenceWorkers.id })
        .from(inferenceWorkers)
        .where(
          and(
            eq(inferenceWorkers.id, owner.workerId),
            eq(inferenceWorkers.sessionId, owner.sessionId),
          ),
        ),
    ),
  );
}

/** Extend one live claim, but never revive an expired or superseded lease. */
export async function renewInferenceClaim(
  target: DetectionTarget,
  owner: Pick<InferenceWorkerRecord, "workerId" | "sessionId">,
  at: Date = new Date(),
): Promise<{ leaseExpiresAt: string }> {
  const db = await database();
  const leaseExpiresAt = inferenceLeaseUntil(at);
  const [renewed] = await db
    .update(inferenceJobs)
    .set({ leaseExpiresAt })
    .where(ownedActiveInferenceClaim(db, target, owner, at))
    .returning({ leaseExpiresAt: inferenceJobs.leaseExpiresAt });
  if (!renewed) {
    throw new InferenceClaimRejectedError(
      `${target.versionId}/${target.digest} has no active lease for ${owner.workerId}/${owner.sessionId}`,
    );
  }
  return { leaseExpiresAt: renewed.leaseExpiresAt.toISOString() };
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
      versionId: experiments.modelVersionId,
    })
    .from(experimentObservationImages)
    .innerJoin(
      experiments,
      eq(experiments.id, experimentObservationImages.experimentId),
    )
    .innerJoin(modelVersions, eq(modelVersions.id, experiments.modelVersionId))
    .leftJoin(
      inferenceOutcomes,
      and(
        eq(inferenceOutcomes.imageId, experimentObservationImages.imageId),
        eq(inferenceOutcomes.modelVersionId, experiments.modelVersionId),
      ),
    )
    .leftJoin(
      inferenceJobs,
      and(
        eq(inferenceJobs.imageId, experimentObservationImages.imageId),
        eq(inferenceJobs.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(
      and(
        isNull(inferenceOutcomes.imageId),
        inArray(sql`${modelVersions.artifact}->>'kind'`, artifactKinds),
        or(
          isNull(inferenceJobs.imageId),
          lte(inferenceJobs.leaseExpiresAt, at),
        ),
      ),
    )
    .orderBy(
      asc(experiments.modelVersionId),
      asc(experimentObservationImages.imageId),
    )
    .limit(CLAIM_CANDIDATE_LIMIT);
}

/**
 * Atomically claim one image-version pair. Experiments are the only source of
 * demand; an expired task may be fenced to a new worker session.
 */
export async function claimInferenceAssignment(
  worker: Pick<InferenceWorkerRecord, "workerId" | "sessionId" | "runtimes">,
  at: Date = new Date(),
): Promise<InferenceAssignment | null> {
  return transaction(async (tx) => {
    const artifactKinds = [
      ...new Set(worker.runtimes.map(({ adapter }) => adapter)),
    ];
    const pairs = await claimableExperimentDemand(tx, at, artifactKinds);
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
              lte(inferenceJobs.leaseExpiresAt, at),
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
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      });
    }
    return null;
  });
}
