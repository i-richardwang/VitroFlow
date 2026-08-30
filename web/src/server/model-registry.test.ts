import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";
import { modelVersionSchema, sameModelVersion } from "../models/schema";

import {
  listModels,
  listModelVersions,
  readModelVersion,
  registerModel,
  registerModelVersion,
} from "./model-registry";

test("registry lists immutable versions under their logical model", async () => {
  const model = await registerModel({
    schemaVersion: 1,
    id: "registry-detector",
    name: "Registry detector",
    task: "object_detection",
    classes: ["seed"],
    readings: [
      { id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] },
    ],
  });
  const candidate = {
    schemaVersion: 1 as const,
    id: "registry-detector-v1",
    modelId: model.id,
    name: "Registry detector v1",
    createdAt: "2026-08-27T00:00:00.000Z",
    source: {
      kind: "training_run" as const,
      trainingRunId: "train-registry",
      trainingAttempt: 1,
      datasetSnapshotId: "snapshot-registry",
    },
    artifact: {
      kind: "ultralytics" as const,
      digest: "d".repeat(64),
      weights: { digest: "c".repeat(64), bytes: 10 },
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: {
        precision: 0.6,
        recall: 0.5,
        map50: 0.8,
        map50_95: 0.4,
        fitness: 0.44,
      },
      training: YOLO26_SEED_SMALL_RECIPE,
    },
  };
  const version = await registerModelVersion(candidate);

  expect(await listModels()).toContainEqual(model);
  expect(await listModelVersions(model.id)).toEqual([version]);
  expect(await readModelVersion(version.id)).toEqual(version);
  expect(
    sameModelVersion(version, {
      artifact: candidate.artifact,
      source: candidate.source,
      createdAt: candidate.createdAt,
      name: candidate.name,
      modelId: candidate.modelId,
      id: candidate.id,
      schemaVersion: candidate.schemaVersion,
    }),
  ).toBeTrue();
  expect(
    modelVersionSchema.safeParse({
      ...candidate,
      artifact: { kind: "traditional", digest: "c".repeat(64) },
    }).success,
  ).toBeFalse();
  await expect(
    registerModelVersion({
      ...candidate,
      artifact: { ...candidate.artifact, digest: "e".repeat(64) },
    }),
  ).rejects.toThrow(/already registered with different contents/);
});
