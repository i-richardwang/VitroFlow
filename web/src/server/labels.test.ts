import { describe, expect, test } from "bun:test";

import type { AnnotationDocument } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { imageDigest, imageFile } from "./testing";
import { addImages } from "./upload";

const digest = imageDigest("a");

const document: AnnotationDocument = {
  schemaVersion: 1,
  image: { digest, width: 100, height: 100 },
  source: {
    modelVersionId: "set.traditional-v1",
    artifactDigest: "a".repeat(64),
    runtime: { adapter: "traditional", fingerprint: "b".repeat(64) },
  },
  status: "in_progress",
  revision: 0,
  instances: [
    { id: "one", class: "seed", bbox: { x: 1, y: 1, width: 5, height: 5 } },
  ],
};

describe("labels", () => {
  test("creates, reads, and updates with revision checks", async () => {
    await addImages("set", [imageFile("a", "a.jpg")]);
    const ref = { dataset: "set", digest };
    expect(await readLabel(ref)).toBeNull();
    const created = await createLabel(ref, { ...document, revision: 7 });
    expect(created.revision).toBe(0);
    await expect(createLabel(ref, document)).rejects.toThrow(/already exists/);

    const updated = await updateLabel(ref, { ...created, instances: [] });
    expect(updated.revision).toBe(1);
    expect((await readLabel(ref))?.instances).toEqual([]);
    await expect(updateLabel(ref, created)).rejects.toThrow(/stale/);
  });

  test("belongs to an image in the dataset", async () => {
    await expect(
      createLabel({ dataset: "set", digest: "0".repeat(64) }, document),
    ).rejects.toThrow(/not in dataset/);
  });

  test("describes the image it is stored under", async () => {
    await addImages("set", [imageFile("b", "b.jpg")]);
    const other = imageDigest("b");
    await expect(
      createLabel({ dataset: "set", digest: other }, document),
    ).rejects.toThrow();
  });
});
