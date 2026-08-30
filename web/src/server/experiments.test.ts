import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { makeResult } from "../annotation/testing";
import { database } from "../db/client";
import { detectionFailures, experimentDishes, experiments } from "../db/schema";
import type { InferenceWorkerRecord } from "../inference/workers";
import type { ModelVersion } from "../models/schema";
import { blobExists, imageBlobKey } from "./blobs";
import { collectImages } from "./image-collection";
import { pendingAssignments, recordInferenceOutcome } from "./detections";
import {
  addRound,
  createExperiment,
  ExperimentPhotoAlreadyUsedError,
  listExperiments,
  readExperimentGrid,
  readExperimentPhoto,
  retryExperimentDetection,
  RoundRejectedError,
} from "./experiments";
import { SEED_DETECTOR_BASELINE_VERSION_ID } from "../models/builtins";
import { listAllModelVersions, registerModel } from "./model-registry";
import {
  FIXTURE_EDGE,
  ULTRALYTICS_RUNTIME,
  baselineVersion,
  imageDigest,
  registerTrainedVersion,
  storeTexts,
  testHeartbeat,
} from "./testing";

const CAPTURED_1 = "2026-08-01T09:00:00.000Z";
const CAPTURED_3 = "2026-08-03T09:00:00.000Z";
const CAPTURED_5 = "2026-08-05T09:00:00.000Z";

const worker: InferenceWorkerRecord = {
  ...testHeartbeat("ultralytics-worker"),
  runtimes: [ULTRALYTICS_RUNTIME],
  lastSeenAt: "2026-08-27T00:00:00.000Z",
};

async function trainedVersion(modelId: string): Promise<ModelVersion> {
  await registerModel({
    schemaVersion: 1,
    id: modelId,
    name: `${modelId} detector`,
    task: "object_detection",
    classes: ["seed"],
  });
  return registerTrainedVersion(modelId);
}

function resultFor(version: ModelVersion, digest: string, seeds: number) {
  return {
    ...makeResult(
      Array.from({ length: seeds }, (_, id) => ({
        id,
        x: 12 + id * 14,
        y: 12,
      })),
      { digest, dishRadius: 400, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
    ),
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
  };
}

function failureFor(version: ModelVersion, digest: string) {
  return {
    schema_version: 1 as const,
    image: { digest },
    producer: {
      model_version_id: version.id,
      artifact_digest: version.artifact.digest,
      runtime: ULTRALYTICS_RUNTIME,
    },
    error: "no dish found",
  };
}

async function round(
  experiment: string,
  label: string,
  capturedAt: string,
  names: Record<string, string>,
) {
  const entries = Object.entries(names);
  const digests = await storeTexts(entries.map(([, content]) => content));
  return addRound({
    experiment,
    label,
    capturedAt,
    photos: entries.map(([filename], index) => ({
      digest: digests[index]!,
      filename,
    })),
  });
}

describe("experiments", () => {
  test("start on a fresh deployment with the builtin seed detector", async () => {
    const offered = await listAllModelVersions();
    expect(offered.map((version) => version.id)).toContain(
      SEED_DETECTOR_BASELINE_VERSION_ID,
    );
    const experiment = await createExperiment({
      name: "Day one",
      modelVersionId: SEED_DETECTOR_BASELINE_VERSION_ID,
    });
    expect(experiment.modelVersionId).toBe(SEED_DETECTOR_BASELINE_VERSION_ID);
  });

  test("have server-owned identities, user-facing names, and one fixed version", async () => {
    const version = await trainedVersion("exp-kind");
    const first = await createExperiment({
      name: "  Germination A  ",
      modelVersionId: version.id,
    });
    const second = await createExperiment({
      name: "Germination A",
      modelVersionId: version.id,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.name).toBe("Germination A");
    expect(first.modelVersionId).toBe(version.id);

    const traditional = await baselineVersion();
    const baseline = await createExperiment({
      name: "Baseline",
      modelVersionId: traditional.id,
    });
    expect(baseline.modelVersionId).toBe(traditional.id);

    const unknownVersion = (async () => {
      await (await database()).insert(experiments).values({
        id: randomUUID(),
        name: "Bypass",
        modelVersionId: "nobody.v9",
        createdAt: new Date(),
      });
    })();
    await expect(unknownVersion).rejects.toThrow();

    const invalidDish = (async () => {
      await (await database()).insert(experimentDishes).values({
        experimentId: first.id,
        label: " A1 ",
        position: 1,
      });
    })();
    await expect(invalidDish).rejects.toThrow();
  });

  test("the first round names the dishes and captured time orders later rounds", async () => {
    const version = await trainedVersion("exp-grid");
    const experiment = await createExperiment({
      name: "Grid",
      modelVersionId: version.id,
    });

    const day1 = await round(experiment.id, "Day 1", CAPTURED_1, {
      "A10.jpg": "g-a10-1",
      "A2.jpg": "g-a2-1",
      "B1.png": "g-b1-1",
    });
    expect(day1.photos).toBe(3);
    expect(day1.round.label).toBe("Day 1");
    expect(day1.round.capturedAt).toBe(CAPTURED_1);

    await expect(
      round(experiment.id, "Day 2", CAPTURED_3, {
        "A2.jpg": "g-a2-2",
        "C7.jpg": "g-c7-2",
      }),
    ).rejects.toThrow("Not dishes of this experiment: C7");
    await expect(
      round(experiment.id, "Day 2", CAPTURED_3, {
        "A2.jpg": "g-a2-2",
        "A2.png": "g-a2-2b",
      }),
    ).rejects.toThrow("both photograph dish A2");

    const day5 = await round(experiment.id, "Day 5", CAPTURED_5, {
      "A2.jpg": "g-a2-5",
      "B1.jpg": "g-b1-5",
    });
    const day3 = await round(experiment.id, "Day 3", CAPTURED_3, {
      "A10.jpg": "g-a10-3",
    });
    const grid = await readExperimentGrid(experiment.id);

    expect(grid?.dishes.map((dish) => dish.label)).toEqual(["A2", "A10", "B1"]);
    expect(grid?.rounds.map(({ id, label }) => [id, label])).toEqual([
      [day1.round.id, "Day 1"],
      [day3.round.id, "Day 3"],
      [day5.round.id, "Day 5"],
    ]);
    expect(grid?.photos).toHaveLength(6);

    const summary = (await listExperiments()).find(
      ({ experiment: item }) => item.id === experiment.id,
    );
    expect(summary?.dishes).toBe(3);
    expect(summary?.rounds).toBe(3);
    expect(summary?.counts).toEqual({ pending: 6, failed: 0, counted: 0 });
  });

  test("rejects a photograph already used anywhere in the experiment", async () => {
    const version = await trainedVersion("exp-used");
    const experiment = await createExperiment({
      name: "Used photo",
      modelVersionId: version.id,
    });
    const first = await round(experiment.id, "Day 1", CAPTURED_1, {
      "A1.jpg": "used-photo",
    });
    const digest = await imageDigest("used-photo");

    try {
      await addRound({
        experiment: experiment.id,
        label: "Day 3",
        capturedAt: CAPTURED_3,
        photos: [{ digest, filename: "A1.jpg" }],
      });
      throw new Error("Expected reused photo to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ExperimentPhotoAlreadyUsedError);
      expect((error as ExperimentPhotoAlreadyUsedError).photos).toEqual([
        {
          digest,
          filename: "A1.jpg",
          dish: "A1",
          round: first.round.id,
          roundLabel: "Day 1",
        },
      ]);
    }
    expect((await readExperimentGrid(experiment.id))?.rounds).toHaveLength(1);
  });

  test("detects photos under the experiment version and exposes counts", async () => {
    const version = await trainedVersion("exp-count");
    const experiment = await createExperiment({
      name: "Count",
      modelVersionId: version.id,
    });
    const added = await round(experiment.id, "Day 1", CAPTURED_1, {
      "D1.jpg": "c-d1",
      "D2.jpg": "c-d2",
    });
    const d1 = await imageDigest("c-d1");
    const d2 = await imageDigest("c-d2");

    const assignment = (await pendingAssignments(worker)).find(
      (item) => item.manifest.modelVersionId === version.id,
    );
    expect(assignment?.images.sort()).toEqual([d1, d2].sort());
    expect(
      (
        await pendingAssignments({
          runtimes: testHeartbeat("traditional").runtimes,
        })
      ).some((item) => item.manifest.modelVersionId === version.id),
    ).toBeFalse();

    await recordInferenceOutcome(
      { versionId: version.id, digest: d1 },
      resultFor(version, d1, 3),
      worker,
    );
    await recordInferenceOutcome(
      { versionId: version.id, digest: d2 },
      failureFor(version, d2),
      worker,
    );
    const grid = await readExperimentGrid(experiment.id);
    expect(
      grid?.photos.map((photo) => [
        photo.dish,
        photo.state,
        photo.count,
        photo.error,
      ]),
    ).toEqual([
      ["D1", "counted", 3, null],
      ["D2", "failed", null, "no dish found"],
    ]);

    const ref = {
      experiment: experiment.id,
      dish: "D2",
      round: added.round.id,
    };
    await retryExperimentDetection(ref);
    expect(
      (await pendingAssignments(worker)).find(
        (item) => item.manifest.modelVersionId === version.id,
      )?.images,
    ).toEqual([d2]);
    expect((await readExperimentPhoto(ref))?.failure).toBeNull();
    expect((await readExperimentPhoto(ref))?.round.label).toBe("Day 1");
    expect(
      (
        await readExperimentPhoto({
          ...ref,
          dish: "D1",
        })
      )?.detection?.instances,
    ).toHaveLength(3);
  });

  test("two experiments counting one photograph with one version share one pair", async () => {
    const version = await trainedVersion("exp-shared");
    const [digest] = await storeTexts(["shared-photo"]);
    for (const name of ["Shared demand A", "Shared demand B"]) {
      const experiment = await createExperiment({
        name,
        modelVersionId: version.id,
      });
      await addRound({
        experiment: experiment.id,
        label: "Day 1",
        capturedAt: CAPTURED_1,
        photos: [{ digest: digest!, filename: "S1.jpg" }],
      });
    }

    const assignment = (await pendingAssignments(worker)).find(
      (item) => item.manifest.modelVersionId === version.id,
    );
    expect(assignment?.images).toEqual([digest]);
  });

  test("the database binds failure documents to the registered artifact", async () => {
    const version = await trainedVersion("exp-failure-fk");
    const [digest] = await storeTexts(["failure-fk"]);
    const failure = failureFor(version, digest!);

    const invalidFailure = (async () => {
      await (await database()).insert(detectionFailures).values({
        imageId: digest!,
        modelVersionId: version.id,
        document: {
          ...failure,
          producer: {
            ...failure.producer,
            artifact_digest: "f".repeat(64),
          },
        },
        failedAt: new Date(),
      });
    })();
    await expect(invalidFailure).rejects.toThrow();
  });

  test("an experiment photo is a garbage-collection root", async () => {
    const version = await trainedVersion("exp-gc");
    const experiment = await createExperiment({
      name: "GC",
      modelVersionId: version.id,
    });
    await round(experiment.id, "Day 1", CAPTURED_1, {
      "E1.jpg": "gc-e1",
    });
    const kept = await imageDigest("gc-e1");
    const [loose] = await storeTexts(["gc-loose"]);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const collected = await collectImages(later);

    expect(collected).toContain(loose!);
    expect(collected).not.toContain(kept);
    expect(await blobExists(imageBlobKey(kept))).toBeTrue();
  });

  test("one photograph cannot fill two cells in one round", async () => {
    const version = await trainedVersion("exp-dup");
    const experiment = await createExperiment({
      name: "Duplicate",
      modelVersionId: version.id,
    });
    const [digest] = await storeTexts(["dup-same"]);

    await expect(
      addRound({
        experiment: experiment.id,
        label: "Day 1",
        capturedAt: CAPTURED_1,
        photos: [
          { digest: digest!, filename: "F1.jpg" },
          { digest: digest!, filename: "F2.jpg" },
        ],
      }),
    ).rejects.toBeInstanceOf(RoundRejectedError);
  });
});
