import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AnnotationDocument } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { DATA_ROOT, LABELS_DIR } from "./paths";

const document: AnnotationDocument = {
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

  test("reads legacy provenance through the current annotation contract", () => {
    const directory = path.join(LABELS_DIR, "legacy");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "a.json"),
      JSON.stringify({
        ...document,
        source: {
          pipelineFingerprint: "a".repeat(64),
          modelFingerprint: "b".repeat(64),
        },
      }),
    );

    const migrated = readLabel({ dataset: "legacy", stem: "a" });
    expect(
      migrated?.source.prelabelerVersionId.startsWith("traditional-legacy-"),
    ).toBe(true);
    expect(migrated?.source.prelabelerFingerprint.length).toBe(64);
  });
});
