import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AnnotationDocument } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { DATA_ROOT } from "./paths";

const document: AnnotationDocument = {
  schemaVersion: 1,
  image: { path: "images/set/a.jpg", width: 100, height: 100 },
  source: {
    prelabelerVersionId: "traditional-test",
    prelabelerFingerprint: "b".repeat(64),
  },
  status: "in_progress",
  revision: 0,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

describe("labels", () => {
  test("creates, reads, and updates with revision checks", () => {
    const ref = { dataset: "set", stem: "a" };
    expect(readLabel(ref)).toBeNull();
    const created = createLabel(ref, { ...document, revision: 7 });
    expect(created.revision).toBe(0);
    expect(() => createLabel(ref, document)).toThrow(/already exists/);

    const updated = updateLabel(ref, { ...created, instances: [] });
    expect(updated.revision).toBe(1);
    expect(readLabel(ref)?.instances).toEqual([]);
    expect(() => updateLabel(ref, created)).toThrow(/stale/);
  });

  test("leaves no temporary file behind", () => {
    createLabel({ dataset: "set", stem: "b" }, document);
    expect(fs.readdirSync(path.join(DATA_ROOT, "labels", "set"))).toEqual([
      "a.json",
      "b.json",
    ]);
  });

  test("keeps label files inside the labels directory", () => {
    expect(() => readLabel({ dataset: "..", stem: "escape" })).toThrow();
  });

  test("rejects documents without an explicit schema version", () => {
    const filePath = path.join(DATA_ROOT, "labels", "invalid", "a.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const { schemaVersion: _, ...unversioned } = document;
    fs.writeFileSync(filePath, JSON.stringify(unversioned));

    expect(() => readLabel({ dataset: "invalid", stem: "a" })).toThrow();
  });
});
