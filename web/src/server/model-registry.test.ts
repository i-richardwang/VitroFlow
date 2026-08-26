import { expect, test } from "bun:test";

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
  const prelabeler = {
    version_id: "registry-detector-v1",
    name: "Registry detector v1",
    kind: "yolo",
    fingerprint: "d".repeat(64),
  };
  const version = registerModelVersion(model.id, prelabeler);

  expect(listModels()).toContainEqual(model);
  expect(listModelVersions(model.id)).toEqual([version]);
  expect(readModelVersion(version.id)).toEqual(version);
  expect(() =>
    registerModelVersion(model.id, {
      ...prelabeler,
      fingerprint: "e".repeat(64),
    }),
  ).toThrow(/already registered with different contents/);
});
