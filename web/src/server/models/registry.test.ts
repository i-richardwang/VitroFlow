import { expect, test } from "bun:test";

import {
  modelVersionSchema,
  sameModelVersion,
} from "../../domain/models/schema";

import { SEED_DETECTOR_MODEL_ID } from "../../domain/models/builtins";
import {
  ModelInUseError,
  ModelIdTakenError,
  ModelNotFoundError,
} from "../../domain/models/errors";
import {
  createModel,
  deleteModel,
  listAllModelVersions,
  listModels,
  readModelVersion,
  registerModel,
  registerModelVersion,
} from "./registry";
import { storeAnnotation } from "../annotations/public";
import { deleteObservation } from "../experiments/public";
import { unassignObservationImage } from "../experiments/observation-images";
import { observeImagesForModel } from "../testing/fixtures";

test("a version is registered once and its contents may not change", async () => {
  const model = await registerModel({
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
    createdAt: "2026-08-27T00:00:00.000Z",
    source: {
      kind: "builtin" as const,
      definition: "registry-v1",
    },
    artifact: {
      kind: "traditional" as const,
      digest: "d".repeat(64),
    },
  };
  const version = await registerModelVersion(candidate);

  expect(await listModels()).toContainEqual(model);
  expect(await readModelVersion(version.id)).toEqual(version);
  expect(
    sameModelVersion(version, {
      artifact: candidate.artifact,
      source: candidate.source,
      createdAt: candidate.createdAt,
      modelId: candidate.modelId,
      id: candidate.id,
      schemaVersion: candidate.schemaVersion,
    }),
  ).toBeTrue();
  expect(
    modelVersionSchema.safeParse({
      ...candidate,
      artifact: {
        kind: "ultralytics",
        digest: "c".repeat(64),
        weights: { digest: "c".repeat(64), bytes: 10 },
      },
    }).success,
  ).toBeFalse();
  await expect(
    registerModelVersion({
      ...candidate,
      artifact: { ...candidate.artifact, digest: "e".repeat(64) },
    }),
  ).rejects.toThrow(/already registered with different contents/);
});

test("every registered version is listed newest first", async () => {
  const model = await registerModel({
    schemaVersion: 1,
    id: "listing-detector",
    name: "Listing detector",
    task: "object_detection",
    classes: ["seed"],
  });
  const version = (createdAt: string, suffix: string) => ({
    schemaVersion: 1 as const,
    id: `listing-detector-${suffix}`,
    modelId: model.id,
    createdAt,
    source: { kind: "builtin" as const, definition: `listing-${suffix}` },
    artifact: { kind: "traditional" as const, digest: "d".repeat(64) },
  });
  const older = await registerModelVersion(
    version("2026-08-27T00:00:00.000Z", "v1"),
  );
  const newer = await registerModelVersion(
    version("2026-08-28T00:00:00.000Z", "v2"),
  );

  const listed = (await listAllModelVersions()).map(({ id }) => id);
  expect(listed).toContain(older.id);
  expect(listed.indexOf(newer.id)).toBeLessThan(listed.indexOf(older.id));
});

test("a task exists as soon as it is named, before anything can answer it", async () => {
  const model = await createModel({
    id: "germination-detector",
    name: "Germination detector",
    classes: ["germinated"],
  });
  expect(model).toEqual({
    schemaVersion: 1,
    id: "germination-detector",
    name: "Germination detector",
    task: "object_detection",
    classes: ["germinated"],
  });
  expect((await listModels()).map(({ id }) => id)).toContain(
    "germination-detector",
  );
  expect(
    (await listAllModelVersions()).filter(
      ({ modelId }) => modelId === "germination-detector",
    ),
  ).toEqual([]);

  await expect(
    createModel({
      id: "germination-detector",
      name: "Something else",
      classes: ["seed"],
    }),
  ).rejects.toBeInstanceOf(ModelIdTakenError);
});

test("a task nothing records against can be withdrawn", async () => {
  await createModel({
    id: "withdrawn-detector",
    name: "Withdrawn detector",
    classes: ["seed"],
  });
  await deleteModel({ model: "withdrawn-detector" });
  expect((await listModels()).map(({ id }) => id)).not.toContain(
    "withdrawn-detector",
  );

  await expect(
    deleteModel({ model: "withdrawn-detector" }),
  ).rejects.toBeInstanceOf(ModelNotFoundError);
  await expect(
    deleteModel({ model: SEED_DETECTOR_MODEL_ID }),
  ).rejects.toBeInstanceOf(ModelInUseError);
});

test("a review outliving its observation still holds its model", async () => {
  const modelId = "reviewed-detector";
  await createModel({
    id: modelId,
    name: "Reviewed detector",
    classes: ["seed"],
  });
  const observed = await observeImagesForModel(
    "Reviewed images",
    ["reviewed"],
    modelId,
  );
  await storeAnnotation({ digest: observed.digests[0]!, modelId }, [], null);
  await unassignObservationImage(observed.images[0]!);
  await deleteObservation({
    experiment: observed.experiment.id,
    observation: observed.observation.id,
  });

  await expect(deleteModel({ model: modelId })).rejects.toBeInstanceOf(
    ModelInUseError,
  );
});
