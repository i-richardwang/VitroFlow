import { and, eq } from "drizzle-orm";
import type { Executor } from "../infra/db/client";
import { images, inferenceOutcomes, modelVersions } from "../infra/db/schema";
import {
  isFailure,
  type DetectionResult,
  type InferenceOutcome,
} from "../../domain/detection/schema";
import { sameRuntimeDescriptor } from "../../domain/inference/schema";
import { canonicalJson } from "../../lib/json/canonical";
import { assertInstanceClasses } from "../../domain/models/classes";
import { supportsRuntime, type Model } from "../../domain/models/schema";
import type { Worker } from "../../domain/workers/schema";
import { lockDetection } from "./lock";
import { assertDocumentImage } from "../images/public";
import { readModel } from "../models/public";

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

function sameDocument(left: DetectionResult, right: DetectionResult): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function assertProducer(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<Worker, "runtimes">,
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
export async function storeInferenceOutcome(
  target: DetectionTarget,
  outcome: InferenceOutcome,
  worker: Pick<Worker, "runtimes">,
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
