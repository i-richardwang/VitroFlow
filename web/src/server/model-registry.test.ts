import { expect, test } from "bun:test";

import { modelVersionSchema, sameModelVersion } from "../models/schema";

import {
  listAllModelVersions,
  listModels,
  readModelVersion,
  registerModelVersion,
} from "./model-registry";
import { registerTestModel } from "./testing";

test("a version is registered once and its contents may not change", async () => {
  const model = await registerTestModel({
    schemaVersion: 1,
    id: "registry-detector",
    name: "Registry detector",
    task: "object_detection",
    classes: ["seed"],
    metrics: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
  });
  const candidate = {
    schemaVersion: 1 as const,
    id: "registry-detector-v1",
    modelId: model.id,
    name: "Registry detector v1",
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
      name: candidate.name,
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
  const model = await registerTestModel({
    schemaVersion: 1,
    id: "listing-detector",
    name: "Listing detector",
    task: "object_detection",
    classes: ["seed"],
    metrics: [{ id: "seeds", name: "Seeds", kind: "count", classes: ["seed"] }],
  });
  const version = (createdAt: string, suffix: string) => ({
    schemaVersion: 1 as const,
    id: `listing-detector-${suffix}`,
    modelId: model.id,
    name: `Listing detector ${suffix}`,
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
