import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { database } from "../db/client";
import { datasetSnapshotImages, modelVersions } from "../db/schema";
import { recordInferenceOutcome } from "./inference-outcomes";
import {
  imageDigest,
  photographObservation,
  registerTestModel,
  registerTrainedVersion,
  resultFor,
  testHeartbeat,
} from "./testing";

test("the database rejects a trained version without its provenance", async () => {
  const suffix = randomUUID();
  const valid = await registerTrainedVersion(
    "seed-detector",
    `provenance-${suffix}`,
  );
  if (valid.source.kind !== "training_run") {
    throw new Error("expected a trained model version");
  }

  await expect(
    (await database())
      .insert(modelVersions)
      .values({
        id: `seed-detector.orphan-${suffix}`,
        modelId: valid.modelId,
        name: "Orphan provenance",
        createdAt: new Date(valid.createdAt),
        source: {
          ...valid.source,
          trainingRunId: `missing-${suffix}`,
        },
        artifact: valid.artifact,
      })
      .execute(),
  ).rejects.toThrow();
});

test("the database binds snapshot annotations to the snapshot model", async () => {
  const suffix = randomUUID();
  const modelId = `snapshot-other-${suffix}`;
  await registerTestModel({
    schemaVersion: 1,
    id: modelId,
    name: "Snapshot other model",
    task: "object_detection",
    classes: ["seed"],
    readings: [
      { id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] },
    ],
  });
  const other = await registerTrainedVersion(
    modelId,
    `snapshot-source-${suffix}`,
  );
  if (other.source.kind !== "training_run") {
    throw new Error("expected a trained model version");
  }
  const { version } = await photographObservation("snapshot-invariant", [
    "snapshot-invariant-image",
  ]);
  const digest = await imageDigest("snapshot-invariant-image");
  const result = await resultFor(version, "snapshot-invariant-image");
  await recordInferenceOutcome({ versionId: version.id, digest }, result, {
    runtimes: testHeartbeat("snapshot-invariant-worker").runtimes,
  });

  await expect(
    (await database())
      .insert(datasetSnapshotImages)
      .values({
        snapshotId: other.source.datasetSnapshotId,
        modelId: other.modelId,
        imageId: digest,
        split: "train",
        annotation: {
          ...documentFromDetection(result),
          status: "complete",
        },
      })
      .execute(),
  ).rejects.toThrow();
});
