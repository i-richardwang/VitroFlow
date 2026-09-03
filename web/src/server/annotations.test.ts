import { describe, expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { recordInferenceOutcome } from "./inference-outcomes";
import {
  readAnnotation,
  startAnnotationFromDetection,
  updateAnnotation,
} from "./annotations";
import {
  imageDigest,
  observeImages,
  resultFor,
  testHeartbeat,
} from "./testing";

describe("annotations", () => {
  test("starts from a successful inference and updates with revision checks", async () => {
    const { version } = await observeImages("annotations", ["lb-a"]);
    const digest = await imageDigest("lb-a");
    const result = await resultFor(version, "lb-a");
    await recordInferenceOutcome({ versionId: version.id, digest }, result, {
      runtimes: testHeartbeat("annotations-worker").runtimes,
    });
    const ref = { digest, modelId: version.modelId };

    expect(await readAnnotation(ref)).toBeNull();
    const created = await startAnnotationFromDetection(ref, version.id);
    expect(created).toEqual({ ...documentFromDetection(result), revision: 0 });

    const updated = await updateAnnotation(ref, {
      ...created,
      image: { ...created.image, width: 1 },
      instances: [],
    });
    expect(updated.revision).toBe(1);
    expect(updated.image).toEqual(created.image);
    expect((await readAnnotation(ref))?.instances).toEqual([]);
    await expect(updateAnnotation(ref, created)).rejects.toThrow(/stale/);
  });

  test("starting again restores the detection's boxes one revision later", async () => {
    const { version } = await observeImages("annotation-restart", ["restart"]);
    const digest = await imageDigest("restart");
    const result = await resultFor(version, "restart");
    await recordInferenceOutcome({ versionId: version.id, digest }, result, {
      runtimes: testHeartbeat("annotations-restart-worker").runtimes,
    });
    const ref = { digest, modelId: version.modelId };
    const started = await startAnnotationFromDetection(ref, version.id);
    const edited = await updateAnnotation(ref, {
      ...started,
      status: "complete",
      instances: [],
    });

    const restarted = await startAnnotationFromDetection(ref, version.id);
    expect(restarted).toEqual({
      ...documentFromDetection(result),
      revision: edited.revision + 1,
    });
    expect(await readAnnotation(ref)).toEqual(restarted);
    await expect(updateAnnotation(ref, edited)).rejects.toThrow(/stale/);
  });

  test("serializes a restart with an edit", async () => {
    const { version } = await observeImages("annotation-concurrent", [
      "concurrent",
    ]);
    const digest = await imageDigest("concurrent");
    const result = await resultFor(version, "concurrent");
    await recordInferenceOutcome({ versionId: version.id, digest }, result, {
      runtimes: testHeartbeat("annotations-concurrent-worker").runtimes,
    });
    const ref = { digest, modelId: version.modelId };
    const started = await startAnnotationFromDetection(ref, version.id);

    const outcomes = await Promise.allSettled([
      updateAnnotation(ref, { ...started, instances: [] }),
      startAnnotationFromDetection(ref, version.id),
    ]);
    const revisions = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? [outcome.value.revision] : [],
    );

    expect(new Set(revisions).size).toBe(revisions.length);
    expect((await readAnnotation(ref))?.revision).toBe(Math.max(...revisions));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(String(outcome.reason)).toContain("stale");
      }
    }
  });

  test("cannot start before the requested version succeeds", async () => {
    const { version } = await observeImages("annotation-missing-outcome", [
      "missing-outcome",
    ]);
    const ref = {
      digest: await imageDigest("missing-outcome"),
      modelId: version.modelId,
    };
    await expect(startAnnotationFromDetection(ref, version.id)).rejects.toThrow(
      /has not detected/,
    );
  });
});
