import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AnnotationDocument } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { DATA_ROOT, imageKey } from "./paths";

const document: AnnotationDocument = {
  image: { path: "images/set/a.jpg", width: 100, height: 100 },
  source: {
    runId: "r",
    pipelineFingerprint: "a".repeat(64),
    modelFingerprint: "b".repeat(64),
  },
  status: "in_progress",
  revision: 0,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

describe("imageKey", () => {
  test("strips the images directory and the extension", () => {
    expect(imageKey("images/set/a.jpg")).toBe("set/a");
    expect(imageKey("images/set/nested/b.JPG")).toBe("set/nested/b");
  });

  test("rejects sources outside the images directory", () => {
    expect(() => imageKey("runs/r/a.jpg")).toThrow();
    expect(() => imageKey("images/../secret.jpg")).toThrow();
    expect(() => imageKey("/etc/passwd")).toThrow();
  });
});

describe("labels", () => {
  test("creates, reads, and updates with revision checks", () => {
    const key = "set/a";
    expect(readLabel(key)).toBeNull();
    const created = createLabel(key, { ...document, revision: 7 });
    expect(created.revision).toBe(0);
    expect(() => createLabel(key, document)).toThrow(/already exists/);

    const updated = updateLabel(key, { ...created, instances: [] });
    expect(updated.revision).toBe(1);
    expect(readLabel(key)?.instances).toEqual([]);
    expect(() => updateLabel(key, created)).toThrow(/stale/);
  });

  test("leaves no temporary file behind", () => {
    createLabel("set/b", document);
    expect(fs.readdirSync(path.join(DATA_ROOT, "labels", "set"))).toEqual([
      "a.json",
      "b.json",
    ]);
  });

  test("keeps label files inside the labels directory", () => {
    expect(() => readLabel("../escape")).toThrow();
  });
});
