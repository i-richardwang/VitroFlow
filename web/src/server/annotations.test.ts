import { describe, expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { recordInferenceOutcome } from "./inference-outcomes";
import { readAnnotation, saveAnnotation } from "./annotations";
import {
  imageDigest,
  observeImages,
  resultFor,
  testHeartbeat,
} from "./testing";

/** Uploads one image, detects it, and returns the review as the editor opens it. */
async function detected(name: string, worker: string) {
  const { version } = await observeImages(name, [name]);
  const digest = await imageDigest(name);
  const result = await resultFor(version, name);
  await recordInferenceOutcome({ versionId: version.id, digest }, result, {
    runtimes: testHeartbeat(worker).runtimes,
  });
  return {
    version,
    result,
    ref: { digest, modelId: version.modelId },
    opened: documentFromDetection(result),
  };
}

describe("annotations", () => {
  test("the first save stores the review the editor opened on", async () => {
    const { ref, opened } = await detected("lb-a", "annotations-worker");
    expect(await readAnnotation(ref)).toBeNull();

    const created = await saveAnnotation(ref, opened);
    expect(created).toEqual({ ...opened, revision: 1 });
    expect(await readAnnotation(ref)).toEqual(created);
    await expect(saveAnnotation(ref, opened)).rejects.toThrow(/stale/);

    const emptied = await saveAnnotation(ref, { ...created, instances: [] });
    expect(emptied.revision).toBe(2);
    expect((await readAnnotation(ref))?.instances).toEqual([]);
  });

  test("refuses a document that describes another image", async () => {
    const { ref, opened } = await detected("lb-b", "annotations-image-worker");
    await expect(
      saveAnnotation(ref, {
        ...opened,
        image: { ...opened.image, width: opened.image.width + 1 },
      }),
    ).rejects.toThrow(/describes/);
  });

  test("concurrent saves of the same revision store exactly one", async () => {
    const { ref, opened } = await detected(
      "concurrent",
      "annotations-concurrent-worker",
    );
    const started = await saveAnnotation(ref, opened);

    const outcomes = await Promise.allSettled([
      saveAnnotation(ref, { ...started, instances: [] }),
      saveAnnotation(ref, { ...started, status: "complete" }),
    ]);

    const stored = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(stored).toHaveLength(1);
    expect((await readAnnotation(ref))?.revision).toBe(started.revision + 1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(String(outcome.reason)).toContain("stale");
      }
    }
  });
});
