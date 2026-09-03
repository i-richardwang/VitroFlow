import { describe, expect, test } from "bun:test";

import type { InferenceWorkerRecord } from "../inference/workers";
import {
  blobExists,
  contentDigest,
  imageBlobKey,
  putImmutableBlob,
  requireBlob,
} from "./blobs";
import {
  addExperimentObservationImages,
  listDatasets,
  listDatasetsForModel,
  readDataset,
  removeDatasetImage,
} from "./datasets";
import { retryObservationImageAnalysis } from "./experiment-observation-images";
import { readExperimentGrid } from "./experiment-queries";
import {
  startAnnotationFromDetection,
  readAnnotation,
  updateAnnotation,
} from "./annotations";
import { registerModelVersion } from "./model-registry";
import {
  DetectionConflictError,
  InvalidDetectionOutcomeError,
  ProducerMismatchError,
  inferencePending,
  readDetection,
  recordInferenceOutcome,
} from "./inference-outcomes";
import { listImageRecords, summarize } from "./summaries";
import { collectImages } from "./image-collection";
import { canonicalize } from "./image-ingest";
import { storeImage } from "./image-store";
import {
  testHeartbeat,
  FIXTURE_EDGE,
  baselineVersion,
  imageBytes,
  imageDigest,
  observeImages,
  registerTestModel,
  registerTrainedVersion,
  resultFor,
  uploadTexts,
} from "./testing";

const worker: InferenceWorkerRecord = {
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

/** A later traditional version of the seed detector. */
function nextTraditionalVersion(slug: string) {
  return registerModelVersion({
    schemaVersion: 1,
    id: `seed-detector.${slug}`,
    modelId: "seed-detector",
    name: `Traditional vision ${slug}`,
    createdAt: "2026-08-27T01:00:00.000Z",
    source: { kind: "builtin", definition: slug },
    artifact: { kind: "traditional", digest: "c".repeat(64) },
  });
}

async function stateOf(ref: { dataset: string; digest: string }) {
  const record = await readImageRecord(ref);
  if (!record) throw new Error(`missing image ${ref.digest}`);
  return summarize(record).state;
}

describe("datasets", () => {
  test("a stored image belongs to nothing until an observation is submitted", async () => {
    const stored = await storeImage(await imageBytes("loose"));
    expect(stored).toEqual({
      digest: await imageDigest("loose"),
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      bytes: stored.bytes,
    });
    expect(await blobExists(imageBlobKey(stored.digest))).toBe(true);
    const { experiment } = await observeImages("loose images", ["loose-other"]);
    const missing = "11111111-1111-4111-8111-111111111111";
    await expect(
      addExperimentObservationImages({
        dataset: "loose",
        images: [{ experiment: experiment.id, observationImage: missing }],
      }),
    ).rejects.toThrow(
      `Not experiment observation images: ${experiment.id}/${missing}`,
    );
    expect(await readDataset("loose")).toBeNull();
  });

  test("adds experiment images under their source filenames", async () => {
    const { digests, images } = await observeImages("crop images", [
      "one",
      "two",
    ]);
    expect(
      await addExperimentObservationImages({ dataset: "crop", images }),
    ).toMatchObject({
      added: 2,
      existing: 0,
    });
    const listed = await listImageRecords("crop");
    expect(listed.map(({ image }) => image.digest).sort()).toEqual(
      [...digests].sort(),
    );
    expect(
      listed.find(({ image }) => image.filename === "two.jpg")?.image,
    ).toMatchObject({
      dataset: "crop",
      width: FIXTURE_EDGE,
      height: FIXTURE_EDGE,
      split: null,
    });
    expect((await listDatasets()).map((dataset) => dataset.id)).toContain(
      "crop",
    );
    expect(await readDataset("crop")).toEqual({
      id: "crop",
      modelId: "seed-detector",
    });
    expect(
      await addExperimentObservationImages({
        dataset: "crop",
        images: [images[0]!],
      }),
    ).toMatchObject({ added: 0, existing: 1 });
  });

  test("a dataset trains the model that analyzed its experiment images", async () => {
    const seed = await observeImages("model images", ["modelled"]);
    await addExperimentObservationImages({
      dataset: "one-model",
      images: seed.images,
    });
    await registerTestModel({
      schemaVersion: 1,
      id: "other-task",
      name: "Other task",
      task: "object_detection",
      classes: ["seed"],
      metrics: [
        { id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] },
      ],
    });
    const otherVersion = await registerTrainedVersion("other-task");
    const other = await observeImages(
      "other images",
      ["modelled-elsewhere"],
      otherVersion,
    );
    await expect(
      addExperimentObservationImages({
        dataset: "one-model",
        images: other.images,
      }),
    ).rejects.toThrow(/trains seed-detector, not other-task/);
    await addExperimentObservationImages({
      dataset: "other-model",
      images: other.images,
    });
    const seedDatasets = (await listDatasetsForModel("seed-detector")).map(
      ({ id }) => id,
    );
    expect(seedDatasets).toContain("one-model");
    expect(seedDatasets).not.toContain("other-model");
    expect(
      (await listDatasetsForModel("other-task")).map(({ id }) => id),
    ).toContain("other-model");
    await expect(
      addExperimentObservationImages({
        dataset: "mixed",
        images: [...seed.images, ...other.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDataset("mixed")).toBeNull();

    const sameSeed = await observeImages(
      "same seed content",
      ["same-content"],
      seed.version,
    );
    const sameOther = await observeImages(
      "same other content",
      ["same-content"],
      otherVersion,
    );
    expect(sameSeed.digests).toEqual(sameOther.digests);
    await expect(
      addExperimentObservationImages({
        dataset: "mixed-same-content",
        images: [...sameSeed.images, ...sameOther.images],
      }),
    ).rejects.toThrow(/different models/);
    expect(await readDataset("mixed-same-content")).toBeNull();

    await expect(
      addExperimentObservationImages({
        dataset: "not a name",
        images: seed.images,
      }),
    ).rejects.toThrow(/Dataset names/);
  });

  test("one image can belong to several datasets", async () => {
    const { digests, images } = await observeImages("shared images", [
      "shared",
    ]);
    for (const dataset of ["left", "right"]) {
      await addExperimentObservationImages({ dataset, images });
    }
    const digest = digests[0]!;
    expect(
      (await readImageRecord({ dataset: "left", digest }))?.image.filename,
    ).toBe("shared.jpg");
    expect(
      (await readImageRecord({ dataset: "right", digest }))?.image.filename,
    ).toBe("shared.jpg");
    expect(contentDigest(await requireBlob(imageBlobKey(digest)))).toBe(digest);
  });

  test("a source that is not an image is not stored", async () => {
    await expect(storeImage(new TextEncoder().encode("notes"))).rejects.toThrow(
      /JPEG, PNG, or TIFF/,
    );
    await expect(storeImage(new Uint8Array())).rejects.toThrow(/empty/);
  });

  test("serializes concurrent additions to a new dataset", async () => {
    const a = await observeImages("concurrent a", ["concurrent-a"]);
    const b = await observeImages("concurrent b", ["concurrent-b"]);
    const [first, second] = await Promise.all([
      addExperimentObservationImages({
        dataset: "concurrent",
        images: a.images,
      }),
      addExperimentObservationImages({
        dataset: "concurrent",
        images: b.images,
      }),
    ]);
    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    expect(await listImageRecords("concurrent")).toHaveLength(2);
  });
});

describe("collection", () => {
  /** A moment past the period an unclaimed image is kept for. */
  const later = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

  test("keeps unclaimed bytes while an observation is still being submitted", async () => {
    const { digest } = await storeImage(await imageBytes("waiting"));
    expect(await collectImages()).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });

  test("collects images no observation claimed", async () => {
    const { digest } = await storeImage(await imageBytes("abandoned"));
    expect(await collectImages(later())).toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(false);
  });

  test("an observation keeps its images", async () => {
    const { digests } = await observeImages("kept images", ["kept"]);
    expect(await collectImages(later())).not.toContain(digests[0]);
    expect(await blobExists(imageBlobKey(digests[0]!))).toBe(true);
  });

  test("collects an immutable object whose Image transaction never committed", async () => {
    const orphan = await canonicalize(await imageBytes("orphan"));
    await putImmutableBlob(imageBlobKey(orphan.digest), orphan.bytes);

    expect(await collectImages()).toContain(orphan.digest);
    expect(await blobExists(imageBlobKey(orphan.digest))).toBe(false);
  });
});

describe("detections", () => {
  async function pendingFor(versionId: string, digests: string[]) {
    const pending = await Promise.all(
      digests.map(async (digest) => ({
        digest,
        pending: await inferencePending({ versionId, digest }),
      })),
    );
    return pending.filter((entry) => entry.pending).map(({ digest }) => digest);
  }

  test("an experiment needs detections from its version only", async () => {
    const next = await nextTraditionalVersion("pending-v2");
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
    await recordInferenceOutcome(
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
    await recordInferenceOutcome(targetB, failure, worker);
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
    expect(await recordInferenceOutcome(target, failure, worker)).toMatchObject(
      {
        error: "first attempt",
      },
    );

    expect(await recordInferenceOutcome(target, result, worker)).toEqual(
      result,
    );
    expect(await recordInferenceOutcome(target, result, worker)).toEqual(
      result,
    );
    await expect(
      recordInferenceOutcome(
        target,
        { ...result, quality: { status: "review_required", warnings: [] } },
        worker,
      ),
    ).rejects.toBeInstanceOf(DetectionConflictError);
    expect(await recordInferenceOutcome(target, failure, worker)).toEqual(
      result,
    );
    expect(await readDetection(target)).toEqual(result);
  });

  test("an outcome must describe its image and its producer", async () => {
    const { version, digests } = await observeImages("mismatch", ["mismatch"]);
    const digest = digests[0]!;
    const target = { versionId: version.id, digest };
    await expect(
      recordInferenceOutcome(
        target,
        await resultFor(version, "elsewhere"),
        worker,
      ),
    ).rejects.toThrow(/describes/);

    const result = await resultFor(version, "mismatch");
    await expect(
      recordInferenceOutcome(
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
      recordInferenceOutcome(
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
      recordInferenceOutcome(
        {
          ...target,
          versionId: (await nextTraditionalVersion("mismatch-v2")).id,
        },
        result,
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      recordInferenceOutcome(
        target,
        {
          ...result,
          producer: { ...result.producer, artifactDigest: "d".repeat(64) },
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    await expect(
      recordInferenceOutcome(target, result, {
        runtimes: [{ adapter: "ultralytics", fingerprint: "c".repeat(64) }],
      }),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    const wrongRuntime = {
      adapter: "ultralytics" as const,
      fingerprint: "c".repeat(64),
    };
    await expect(
      recordInferenceOutcome(
        target,
        { ...result, producer: { ...result.producer, runtime: wrongRuntime } },
        { runtimes: [wrongRuntime] },
      ),
    ).rejects.toBeInstanceOf(ProducerMismatchError);
    expect(await readDetection(target)).toBeNull();
  });

  test("a dataset shows the newest detection whether or not a review exists", async () => {
    const baseline = await baselineVersion();
    const { version: next, digests } = await uploadTexts(
      "shown",
      ["shown"],
      await nextTraditionalVersion("shown-v2"),
    );
    const digest = digests[0]!;
    const ref = { dataset: "shown", digest };
    expect(await stateOf(ref)).toBe("unreviewed");
    expect((await readImageRecord(ref))?.detection).toBeNull();

    const original = await resultFor(baseline, "shown");
    await recordInferenceOutcome(
      { versionId: baseline.id, digest },
      original,
      worker,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(original);

    const newer = await resultFor(next, "shown");
    await recordInferenceOutcome({ versionId: next.id, digest }, newer, worker);
    expect((await readImageRecord(ref))?.detection).toEqual(newer);

    const failedVersion = await nextTraditionalVersion("shown-v3");
    const failedShape = await resultFor(failedVersion, "shown");
    await recordInferenceOutcome(
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

    await startAnnotationFromDetection(
      { digest, modelId: baseline.modelId },
      baseline.id,
    );
    expect((await readImageRecord(ref))?.detection).toEqual(newer);
    expect(await stateOf(ref)).toBe("in_progress");
  });

  test("a review is one document per image and model, wherever it is opened", async () => {
    const { version, digests, images } = await uploadTexts("ctx-one", ["ctx"]);
    await addExperimentObservationImages({ dataset: "ctx-two", images });
    const digest = digests[0]!;
    const result = await resultFor(version, "ctx");
    await recordInferenceOutcome(
      { versionId: version.id, digest },
      result,
      worker,
    );
    const labelRef = { digest, modelId: version.modelId };
    const started = await startAnnotationFromDetection(labelRef, version.id);
    await updateAnnotation(labelRef, { ...started, status: "complete" });
    expect(await stateOf({ dataset: "ctx-one", digest })).toBe("complete");
    expect(await stateOf({ dataset: "ctx-two", digest })).toBe("complete");
  });
});

describe("removal", () => {
  test("removes the membership; the review and the detection stay with the image", async () => {
    const { version, digests } = await uploadTexts("rm", ["rm-bytes"]);
    const digest = digests[0]!;
    const ref = { dataset: "rm", digest };
    const target = { versionId: version.id, digest };
    const result = await resultFor(version, "rm-bytes");
    await recordInferenceOutcome(target, result, worker);
    await startAnnotationFromDetection(
      { digest, modelId: version.modelId },
      version.id,
    );

    await removeDatasetImage(ref);
    expect(await readImageRecord(ref)).toBeNull();
    expect(
      await readAnnotation({ digest, modelId: version.modelId }),
    ).not.toBeNull();
    expect(await readDetection(target)).toEqual(result);
    await expect(removeDatasetImage(ref)).rejects.toThrow(/not in dataset/);
  });

  test("a review keeps the image alive after its last membership and observation are gone", async () => {
    const { digests, images } = await uploadTexts("share-a", ["shared-bytes"]);
    const digest = digests[0]!;
    await addExperimentObservationImages({ dataset: "share-b", images });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await removeDatasetImage({ dataset: "share-a", digest });
    expect(await collectImages(later)).not.toContain(digest);
    expect(
      await readImageRecord({ dataset: "share-b", digest }),
    ).not.toBeNull();
    await removeDatasetImage({ dataset: "share-b", digest });
    expect(await collectImages(later)).not.toContain(digest);
    expect(await blobExists(imageBlobKey(digest))).toBe(true);
  });
});

/** Experiment observation-image references, indexed by observation unit code. */
async function listObservationImageRefs(experimentId: string) {
  const grid = await readExperimentGrid(experimentId);
  if (!grid) throw new Error(`missing experiment ${experimentId}`);
  const codes = new Map(
    grid.observationUnits.map((observationUnit) => [
      observationUnit.id,
      observationUnit.code,
    ]),
  );
  return new Map(
    grid.images.map((image) => [
      codes.get(image.observationUnit)!,
      { experiment: experimentId, observationImage: image.id },
    ]),
  );
}
