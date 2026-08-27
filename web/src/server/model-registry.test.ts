import { expect, test } from "bun:test";

import { YOLO26_SEED_SMALL_RECIPE } from "../training/recipes";

import {
  listModels,
  listModelVersions,
  readModelVersion,
  registerModel,
  registerModelVersion,
} from "./model-registry";

test("registry lists immutable versions under their logical model", () => {
  const model = registerModel({
    schemaVersion: 1,
    id: "registry-detector",
    name: "Registry detector",
    task: "object_detection",
    classes: ["seed"],
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
      datasetSnapshotId: "snapshot-registry",
    },
    artifact: {
      kind: "ultralytics" as const,
      digest: "d".repeat(64),
      bytes: 10,
      path: "model-artifacts/registry-detector-v1/weights/best.pt",
      inference: {
        confidence: 0.4,
        imageSize: 768,
        maxDetections: 500,
        endToEnd: false,
      },
      validation: { map50: 0.8 },
      training: YOLO26_SEED_SMALL_RECIPE,
    },
  };
  const version = registerModelVersion(candidate);

  expect(listModels()).toContainEqual(model);
  expect(listModelVersions(model.id)).toEqual([version]);
  expect(readModelVersion(version.id)).toEqual(version);
  expect(() =>
    registerModelVersion({
      ...candidate,
      artifact: { ...candidate.artifact, digest: "e".repeat(64) },
    }),
  ).toThrow(/already registered with different contents/);
});
