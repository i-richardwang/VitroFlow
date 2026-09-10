import { listObservationImageRefs } from "../testing/fixtures";
import { describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { instancesFromDetection } from "../../domain/annotation/detection";
import { database } from "../infra/db/client";
import { inferenceOutcomes } from "../infra/db/schema";

import type { Worker } from "../../domain/workers/schema";

import { addExperimentObservationImages } from "../datasets/memberships";
import { retryObservationImageAnalysis } from "../experiments/observation-images";

import { storeAnnotation } from "../annotations/documents";
import {
  DetectionConflictError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
} from "./outcomes";
import { seedInferenceOutcome } from "../testing/inference";
import { listImageRecords } from "../datasets/records";

import {
  testHeartbeat,
  observeImages,
  resultFor,
  traditionalVersion,
  uploadTexts,
} from "../testing/fixtures";

const worker: Worker = {
  ...testHeartbeat("worker"),
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function readImageRecord(ref: { dataset: string; digest: string }) {
  return (
    (await listImageRecords(ref.dataset)).find(
      (record) => record.image.digest === ref.digest,
    ) ?? null
  );
}

/** The succeeded outcome stored for one image-version pair, if any. */
async function storedDetection(target: { versionId: string; digest: string }) {
  const db = await database();
  const [row] = await db
    .select({ document: inferenceOutcomes.document })
    .from(inferenceOutcomes)
    .where(
      and(
        eq(inferenceOutcomes.imageId, target.digest),
        eq(inferenceOutcomes.modelVersionId, target.versionId),
        eq(inferenceOutcomes.status, "succeeded"),
      ),
    );
  return row?.document ?? null;
}

/** This file registers several versions, so it keeps a model of its own. */
const outcomeVersion = (slug: string, createdAt?: string) =>
  traditionalVersion("outcome-detector", slug, createdAt);

async function isReviewed(ref: { dataset: string; digest: string }) {
  const record = await readImageRecord(ref);
  if (!record) throw new Error(`missing image ${ref.digest}`);
  return record.annotation !== null;
}

describe("detections", () => {
  /** The digests this version has not recorded an outcome for yet. */
  async function pendingFor(versionId: string, digests: string[]) {
    const db = await database();
    const rows = await db
      .select({ digest: inferenceOutcomes.imageId })
      .from(inferenceOutcomes)
      .where(
        and(
          eq(inferenceOutcomes.modelVersionId, versionId),
          inArray(inferenceOutcomes.imageId, digests),
        ),
      );
    const recorded = new Set(rows.map((row) => row.digest));
    return digests.filter((digest) => !recorded.has(digest));
  }

  test("an experiment needs detections from the version that reads for it", async () => {
    const next = await outcomeVersion("pending-v2");
    const { experiment, version, digests } = await observeImages(
      "pending",
      ["pend-a", "pend-b"],
      next,
    );
    const [a, b] = digests as [string, string];
    const targetA = { versionId: version.id, digest: a };
    const targetB = { versionId: version.id, digest: b };
    expect(await pendingFor(version.id, [a, b])).toEqual(
      expect.arrayContaining([a, b]),
    );

    const original = await resultFor(version, "pend-b");
    await seedInferenceOutcome(
      targetA,
      await resultFor(version, "pend-a"),
      worker,
    );
    const failure = {
      schemaVersion: 1 as const,
      image: { digest: b },
      producer: original.producer,
      error: "boom",
    };
    await seedInferenceOutcome(targetB, failure, worker);
    expect(await pendingFor(version.id, [a, b])).toEqual([]);
    const cells = await listObservationImageRefs(experiment.id);
    await retryObservationImageAnalysis(cells.get("pend-b")!);
    expect(await pendingFor(version.id, [a, b])).toEqual([b]);
  });

  test("a detection is recorded once and a later failure defers to it", async () => {
    const { version, digests } = await observeImages("once", ["once"]);
    const digest = digests[0]!;
    const target = { versionId: version.id, digest };
    const result = await resultFor(version, "once");
    const failure = {
      schemaVersion: 1 as const,
      image: { digest },
      producer: result.producer,
      error: "first attempt",
    };
    expect(await seedInferenceOutcome(target, failure, worker)).toMatchObject({
      error: "first attempt",
    });

    expect(await seedInferenceOutcome(target, result, worker)).toEqual(result);
    expect(await seedInferenceOutcome(target, result, worker)).toEqual(result);
    await expect(
      seedInferenceOutcome(
        target,
        { ...result, quality: { status: "review_required", warnings: [] } },
        worker,
      ),
    ).rejects.toBeInstanceOf(DetectionConflictError);
    expect(await seedInferenceOutcome(target, failure, worker)).toEqual(result);
    expect(await storedDetection(target)).toEqual(result);
  });

  test("an outcome must describe its image and its producer", async () => {
    const { version, digests } = await observeImages("mismatch", ["mismatch"]);
    const digest = digests[0]!;
    const target = { versionId: version.id, digest };
    await expect(
      seedInferenceOutcome(
        target,
        await resultFor(version, "elsewhere"),
        worker,
      ),
    ).rejects.toThrow(/describes/);

    const result = await resultFor(version, "mismatch");
    await expect(
      seedInferenceOutcome(
        target,
        {
          ...result,
          instances: [
            {
              id: "unknown",
              class: "debris",
              bbox: { x: 1, y: 1, width: 5, height: 5 },
              score: 0.9,
            },
          ],
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(InvalidDetectionOutcomeError);
    await expect(
      seedInferenceOutcome(
        target,
        {
          ...result,
          image: { digest, width: 1, height: 1 },
          instances: [],
        },
        worker,
      ),
    ).rejects.toThrow(/1x1/);
    await expect(
      seedInferenceOutcome(
        {
          ...target,
          versionId: (await outcomeVersion("mismatch-v2")).id,
        },
        result,
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      seedInferenceOutcome(
        target,
        {
          ...result,
          producer: { ...result.producer, artifactDigest: "d".repeat(64) },
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      seedInferenceOutcome(target, result, {
        runtimes: [{ adapter: "ultralytics", fingerprint: "c".repeat(64) }],
      }),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    const wrongRuntime = {
      adapter: "ultralytics" as const,
      fingerprint: "c".repeat(64),
    };
    await expect(
      seedInferenceOutcome(
        target,
        { ...result, producer: { ...result.producer, runtime: wrongRuntime } },
        { runtimes: [wrongRuntime] },
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    expect(await storedDetection(target)).toBeNull();
  });

  test("a dataset shows the newest detection whether or not a review exists", async () => {
    const baseline = await outcomeVersion(
      "shown-v1",
      "2026-08-26T01:00:00.000Z",
    );
    const { version: next, digests } = await uploadTexts(
      "shown",
      ["shown"],
      await outcomeVersion("shown-v2", "2026-08-27T02:00:00.000Z"),
    );
    const digest = digests[0]!;
    const ref = { dataset: "shown", digest };
    expect(await isReviewed(ref)).toBe(false);
    expect((await readImageRecord(ref))?.detection).toBeNull();

    const original = await resultFor(baseline, "shown");
    await seedInferenceOutcome(
      { versionId: baseline.id, digest },
      original,
      worker,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(original);

    const newer = await resultFor(next, "shown");
    await seedInferenceOutcome({ versionId: next.id, digest }, newer, worker);
    expect((await readImageRecord(ref))?.detection).toEqual(newer);

    const failedVersion = await outcomeVersion(
      "shown-v3",
      "2026-08-27T03:00:00.000Z",
    );
    const failedShape = await resultFor(failedVersion, "shown");
    await seedInferenceOutcome(
      { versionId: failedVersion.id, digest },
      {
        schemaVersion: 1,
        image: { digest },
        producer: failedShape.producer,
        error: "runtime failed",
      },
      worker,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(newer);

    await storeAnnotation(
      { digest, modelId: baseline.modelId },
      instancesFromDetection(original),
      null,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(newer);
    expect(await isReviewed(ref)).toBe(true);
  });

  test("a review is one document per image and model, wherever it is opened", async () => {
    const { version, digests, images } = await uploadTexts("ctx-one", ["ctx"]);
    await addExperimentObservationImages({ dataset: "ctx-two", images });
    const digest = digests[0]!;
    const result = await resultFor(version, "ctx");
    await seedInferenceOutcome(
      { versionId: version.id, digest },
      result,
      worker,
    );
    const labelRef = { digest, modelId: version.modelId };
    await storeAnnotation(labelRef, instancesFromDetection(result), null);
    expect(await isReviewed({ dataset: "ctx-one", digest })).toBe(true);
    expect(await isReviewed({ dataset: "ctx-two", digest })).toBe(true);
  });
});
