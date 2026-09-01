import { describe, expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { database } from "../db/client";
import { annotations } from "../db/schema";
import { recordInferenceOutcome } from "./inference-outcomes";
import {
  createAnnotationFromDetection,
  readAnnotation,
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
    const created = await createAnnotationFromDetection(ref, version.id);
    expect(created).toEqual({ ...documentFromDetection(result), revision: 0 });
    await expect(
      createAnnotationFromDetection(ref, version.id),
    ).rejects.toThrow(/already exists/);

    const updated = await updateAnnotation(ref, {
      ...created,
      source: { ...created.source, artifactDigest: "f".repeat(64) },
      instances: [],
    });
    expect(updated.revision).toBe(1);
    expect(updated.source).toEqual(created.source);
    expect((await readAnnotation(ref))?.instances).toEqual([]);
    await expect(updateAnnotation(ref, created)).rejects.toThrow(/stale/);
  });

  test("cannot start before the requested version succeeds", async () => {
    const { version } = await observeImages("annotation-missing-outcome", [
      "missing-outcome",
    ]);
    const ref = {
      digest: await imageDigest("missing-outcome"),
      modelId: version.modelId,
    };
    await expect(
      createAnnotationFromDetection(ref, version.id),
    ).rejects.toThrow(/has not detected/);
  });

  test("the database rejects an annotation without its successful inference", async () => {
    const { version } = await observeImages("annotation-db-outcome", [
      "db-outcome",
    ]);
    const digest = await imageDigest("db-outcome");
    const result = await resultFor(version, "db-outcome");

    await expect(
      (await database())
        .insert(annotations)
        .values({
          imageId: digest,
          modelId: version.modelId,
          document: documentFromDetection(result),
          updatedAt: new Date(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  test("the database rejects an annotation backed only by a failed inference", async () => {
    const { version } = await observeImages("annotation-db-failure", [
      "db-failure",
    ]);
    const digest = await imageDigest("db-failure");
    const successfulShape = await resultFor(version, "db-failure");
    await recordInferenceOutcome(
      { versionId: version.id, digest },
      {
        schemaVersion: 1,
        image: { digest },
        producer: successfulShape.producer,
        error: "runtime failed",
      },
      { runtimes: testHeartbeat("annotations-failure-worker").runtimes },
    );

    await expect(
      (await database())
        .insert(annotations)
        .values({
          imageId: digest,
          modelId: version.modelId,
          document: documentFromDetection(successfulShape),
          updatedAt: new Date(),
        })
        .execute(),
    ).rejects.toThrow();
  });
});
