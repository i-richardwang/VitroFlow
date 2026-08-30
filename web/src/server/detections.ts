import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { database, transaction, type Executor } from "../db/client";
import {
  detectionFailures,
  detections,
  experimentPhotos,
  experiments,
  images,
  modelVersions,
} from "../db/schema";
import {
  inferenceOutcomeSchema,
  isFailure,
  type DetectionFailure,
  type DetectionResult,
  type InferenceOutcome,
} from "../detection/schema";
import {
  inferenceModelManifest,
  type InferenceModelManifest,
} from "../inference/assignments";
import { sameRuntimeDescriptor } from "../inference/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import { supportsRuntime } from "../models/schema";
import { lockDetection } from "./detection-lock";
import { assertDocumentImage } from "./image-documents";
import { canExecute } from "./inference-worker-store";
import { toModelVersion } from "./model-registry";

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

export async function readDetection(
  { versionId, digest }: DetectionTarget,
  db?: Executor,
): Promise<DetectionResult | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: detections.document })
    .from(detections)
    .where(
      and(
        eq(detections.imageId, digest),
        eq(detections.modelVersionId, versionId),
      ),
    );
  return row?.document ?? null;
}

export async function readDetectionFailure(
  { versionId, digest }: DetectionTarget,
  db?: Executor,
): Promise<DetectionFailure | null> {
  const [row] = await (db ?? (await database()))
    .select({ document: detectionFailures.document })
    .from(detectionFailures)
    .where(
      and(
        eq(detectionFailures.imageId, digest),
        eq(detectionFailures.modelVersionId, versionId),
      ),
    );
  return row?.document ?? null;
}

/** JSON with object keys sorted at every level, so storage cannot reorder it. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, field: unknown) =>
    field && typeof field === "object" && !Array.isArray(field)
      ? Object.fromEntries(
          Object.entries(field as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : field,
  );
}

function sameDocument(left: DetectionResult, right: DetectionResult): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function assertProducer(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<InferenceWorkerRecord, "runtimes">,
  tx: Executor,
): Promise<void> {
  const { producer } = outcome;
  if (producer.model_version_id !== target.versionId) {
    throw new ProducerMismatchError(
      `Outcome was produced by ${producer.model_version_id}, not ${target.versionId}`,
    );
  }
  const [version] = await tx
    .select({
      artifact: modelVersions.artifact,
      artifactDigest: modelVersions.artifactDigest,
    })
    .from(modelVersions)
    .where(eq(modelVersions.id, target.versionId));
  if (!version) {
    throw new ProducerMismatchError(
      `Unknown model version: ${target.versionId}`,
    );
  }
  if (version.artifactDigest !== producer.artifact_digest) {
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
}

/**
 * Records what a worker found for the pair. A detection is written once:
 * the same result resubmitted is accepted, a different one is refused, and
 * a failure arriving after a detection is ignored. A detection replaces any
 * failure recorded before it.
 */
export async function recordInferenceOutcome(
  target: DetectionTarget,
  document: unknown,
  worker: Pick<InferenceWorkerRecord, "runtimes">,
): Promise<InferenceOutcome> {
  const parsed = inferenceOutcomeSchema.safeParse(document);
  if (!parsed.success) {
    throw new InvalidDetectionOutcomeError(parsed.error.message);
  }
  const outcome = parsed.data;
  return transaction(async (tx) => {
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
    await assertProducer(target, outcome, worker, tx);
    const existing = await readDetection(target, tx);
    if (isFailure(outcome)) {
      if (existing) return existing;
      const row = { document: outcome, failedAt: new Date() };
      await tx
        .insert(detectionFailures)
        .values({
          imageId: target.digest,
          modelVersionId: target.versionId,
          ...row,
        })
        .onConflictDoUpdate({
          target: [detectionFailures.imageId, detectionFailures.modelVersionId],
          set: row,
        });
      return outcome;
    }
    if (existing) {
      if (!sameDocument(existing, outcome)) {
        throw new DetectionConflictError(target);
      }
      return existing;
    }
    await tx.insert(detections).values({
      imageId: target.digest,
      modelVersionId: target.versionId,
      document: outcome,
      createdAt: new Date(),
    });
    await tx
      .delete(detectionFailures)
      .where(
        and(
          eq(detectionFailures.imageId, target.digest),
          eq(detectionFailures.modelVersionId, target.versionId),
        ),
      );
    return outcome;
  });
}

/** Removes one failed attempt while holding the pair lock in the caller's transaction. */
export async function clearDetectionFailure(
  target: DetectionTarget,
  tx: Executor,
): Promise<void> {
  await lockDetection(target.digest, target.versionId, tx);
  await tx
    .delete(detectionFailures)
    .where(
      and(
        eq(detectionFailures.imageId, target.digest),
        eq(detectionFailures.modelVersionId, target.versionId),
      ),
    );
}

/** One version's share of the pending work, with the manifest to load it. */
export interface Assignment {
  manifest: InferenceModelManifest;
  images: string[];
}

/** Pairs experiments need: their photographs under the versions they count with, each once. */
function experimentDemand(db: Executor) {
  return db
    .selectDistinct({
      digest: experimentPhotos.imageId,
      versionId: experiments.modelVersionId,
    })
    .from(experimentPhotos)
    .innerJoin(experiments, eq(experiments.id, experimentPhotos.experimentId))
    .leftJoin(
      detections,
      and(
        eq(detections.imageId, experimentPhotos.imageId),
        eq(detections.modelVersionId, experiments.modelVersionId),
      ),
    )
    .leftJoin(
      detectionFailures,
      and(
        eq(detectionFailures.imageId, experimentPhotos.imageId),
        eq(detectionFailures.modelVersionId, experiments.modelVersionId),
      ),
    )
    .where(and(isNull(detections.imageId), isNull(detectionFailures.imageId)));
}

/**
 * Pairs that have neither a detection nor a failure. Experiments are the only
 * source of demand: a dataset reviews detections its images already have.
 */
export async function pendingAssignments(
  worker: Pick<InferenceWorkerRecord, "runtimes">,
): Promise<Assignment[]> {
  const db = await database();
  const pairs = await experimentDemand(db);
  if (pairs.length === 0) return [];
  const versionIds = [...new Set(pairs.map((pair) => pair.versionId))].sort();
  const versions = await db
    .select()
    .from(modelVersions)
    .where(inArray(modelVersions.id, versionIds))
    .orderBy(asc(modelVersions.id));
  const byVersion = new Map<string, string[]>();
  for (const { digest, versionId } of pairs) {
    const images = byVersion.get(versionId) ?? [];
    images.push(digest);
    byVersion.set(versionId, images);
  }
  const assignments: Assignment[] = [];
  for (const version of versions) {
    const modelVersion = toModelVersion(version);
    if (!canExecute(worker, modelVersion.artifact)) continue;
    assignments.push({
      manifest: inferenceModelManifest(modelVersion),
      images: byVersion.get(version.id)!.sort(),
    });
  }
  return assignments;
}
