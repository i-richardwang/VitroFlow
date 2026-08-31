import { describe, expect, test } from "bun:test";

import { documentFromDetection } from "../annotation/detection";
import { database } from "../db/client";
import { labels } from "../db/schema";
import { recordInferenceOutcome } from "./inference-outcomes";
import { createLabelFromDetection, readLabel, updateLabel } from "./labels";
import {
  imageDigest,
  photographRound,
  resultFor,
  testHeartbeat,
} from "./testing";

describe("labels", () => {
  test("starts from a successful inference and updates with revision checks", async () => {
    const { version } = await photographRound("labels", ["lb-a"]);
    const digest = await imageDigest("lb-a");
    const result = await resultFor(version, "lb-a");
    await recordInferenceOutcome({ versionId: version.id, digest }, result, {
      runtimes: testHeartbeat("labels-worker").runtimes,
    });
    const ref = { digest, model: version.modelId };

    expect(await readLabel(ref)).toBeNull();
    const created = await createLabelFromDetection(ref, version.id);
    expect(created).toEqual({ ...documentFromDetection(result), revision: 0 });
    await expect(createLabelFromDetection(ref, version.id)).rejects.toThrow(
      /already exists/,
    );

    const updated = await updateLabel(ref, {
      ...created,
      source: { ...created.source, artifactDigest: "f".repeat(64) },
      instances: [],
    });
    expect(updated.revision).toBe(1);
    expect(updated.source).toEqual(created.source);
    expect((await readLabel(ref))?.instances).toEqual([]);
    await expect(updateLabel(ref, created)).rejects.toThrow(/stale/);
  });

  test("cannot start before the requested version succeeds", async () => {
    const { version } = await photographRound("label-missing-outcome", [
      "missing-outcome",
    ]);
    const ref = {
      digest: await imageDigest("missing-outcome"),
      model: version.modelId,
    };
    await expect(createLabelFromDetection(ref, version.id)).rejects.toThrow(
      /has not detected/,
    );
  });

  test("the database rejects a label without its successful inference", async () => {
    const { version } = await photographRound("label-db-outcome", [
      "db-outcome",
    ]);
    const digest = await imageDigest("db-outcome");
    const result = await resultFor(version, "db-outcome");

    await expect(
      (await database())
        .insert(labels)
        .values({
          imageId: digest,
          modelId: version.modelId,
          document: documentFromDetection(result),
          updatedAt: new Date(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  test("the database rejects a label backed only by a failed inference", async () => {
    const { version } = await photographRound("label-db-failure", [
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
      { runtimes: testHeartbeat("labels-failure-worker").runtimes },
    );

    await expect(
      (await database())
        .insert(labels)
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
