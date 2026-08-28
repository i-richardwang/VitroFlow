import { describe, expect, test } from "bun:test";

import type { AnnotationDocument } from "../annotation/schema";
import { createLabel, readLabel, updateLabel } from "./labels";
import { FIXTURE_EDGE, imageDigest, imageSource } from "./testing";
import { addImage } from "./upload";

const digest = await imageDigest("a");

const document: AnnotationDocument = {
  schemaVersion: 1,
  image: { digest, width: FIXTURE_EDGE, height: FIXTURE_EDGE },
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
    await addImage("set", await imageSource("a", "a.jpg"));
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
    await addImage("set", await imageSource("b", "b.jpg"));
    const other = await imageDigest("b");
    await expect(
      createLabel({ dataset: "set", digest: other }, document),
    ).rejects.toThrow();
  });

  test("uses the canonical image dimensions", async () => {
    await addImage("dimensions", await imageSource("dimensions"));
    const image = await imageDigest("dimensions");
    await expect(
      createLabel(
        { dataset: "dimensions", digest: image },
        {
          ...document,
          image: { digest: image, width: 1, height: 1 },
          instances: [],
        },
      ),
    ).rejects.toThrow(/1x1/);
  });
});
